import pytest
import respx
from httpx import Response
from rustbox import (
    Rustbox,
    RustboxAuthError,
    RustboxRateLimitError,
    RustboxServerError,
    __version__,
)
from rustbox.client import DEFAULT_BASE_URL


def test_constructor_should_default_base_url_to_production():
    rb = Rustbox("k")
    assert rb.base_url == DEFAULT_BASE_URL


def test_constructor_should_reject_empty_base_url():
    with pytest.raises(ValueError):
        Rustbox("k", "")


def test_constructor_should_reject_empty_api_key():
    with pytest.raises(ValueError):
        Rustbox("")


@pytest.mark.asyncio
@respx.mock
async def test_run_success_fast():
    route = respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(
        return_value=Response(200, json={"id": "1", "verdict": "AC"})
    )
    rb = Rustbox("k")
    res = await rb.run("python", "print(1)")
    assert res["verdict"] == "AC"
    assert route.called
    assert route.calls.last.request.headers["User-Agent"] == f"rustbox-sdk-py/{__version__}"


@pytest.mark.asyncio
@respx.mock
async def test_run_auto_generates_idempotency_key():
    route = respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(
        return_value=Response(200, json={"id": "1", "verdict": "AC"})
    )
    rb = Rustbox("k")
    await rb.run("python", "print(1)")
    key = route.calls.last.request.headers.get("idempotency-key")
    assert key is not None
    assert len(key) > 8


@pytest.mark.asyncio
@respx.mock
async def test_submit_includes_profile_when_set():
    captured = {}

    def handler(request):
        if request.content:
            import json as _json
            captured.update(_json.loads(request.content))
        return Response(200, json={"id": "1", "verdict": "AC"})

    respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(side_effect=handler)
    rb = Rustbox("k")
    await rb.submit("python", "print(1)", profile="agent")
    assert captured.get("profile") == "agent"


@pytest.mark.asyncio
@respx.mock
async def test_submit_retries_on_503_then_succeeds():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 2:
            return Response(503, text="upstream")
        return Response(200, json={"id": "1", "verdict": "AC"})

    respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(side_effect=handler)
    rb = Rustbox("k")
    res = await rb.submit("python", "print(1)")
    assert res["verdict"] == "AC"
    assert calls["n"] == 2


@pytest.mark.asyncio
@respx.mock
async def test_submit_does_not_retry_on_401():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return Response(401, text="nope")

    respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(side_effect=handler)
    rb = Rustbox("k")
    with pytest.raises(RustboxAuthError):
        await rb.submit("python", "print(1)")
    assert calls["n"] == 1


@pytest.mark.asyncio
@respx.mock
async def test_submit_throws_rate_limit_on_429():
    respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(return_value=Response(429))
    rb = Rustbox("k")
    with pytest.raises(RustboxRateLimitError):
        await rb.submit("python", "print(1)")


@pytest.mark.asyncio
@respx.mock
async def test_submit_throws_server_error_after_retries():
    respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(return_value=Response(503))
    rb = Rustbox("k", max_retries=1)
    with pytest.raises(RustboxServerError):
        await rb.submit("python", "print(1)")


@pytest.mark.asyncio
@respx.mock
async def test_run_polling():
    respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(
        return_value=Response(408, json={"id": "1"})
    )
    respx.get(f"{DEFAULT_BASE_URL}/api/result/1").mock(
        return_value=Response(200, json={"id": "1", "verdict": "TLE"})
    )
    rb = Rustbox("k")
    res = await rb.run("python", "while True: pass")
    assert res["verdict"] == "TLE"


@pytest.mark.asyncio
async def test_aclose_can_be_called_explicitly():
    rb = Rustbox("k")
    await rb.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_async_context_manager():
    respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(
        return_value=Response(200, json={"id": "1", "verdict": "AC"})
    )
    async with Rustbox("k") as rb:
        res = await rb.run("python", "print(1)")
        assert res["verdict"] == "AC"
