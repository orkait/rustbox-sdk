import pytest
import respx
from httpx import Response
from rustbox import Rustbox
from rustbox.client import DEFAULT_BASE_URL

CUSTOM_BASE = "https://custom.example.com"


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
    respx.post(f"{DEFAULT_BASE_URL}/api/submit").mock(
        return_value=Response(200, json={"id": "1", "verdict": "AC"})
    )
    rb = Rustbox("k")
    res = await rb.run("python", "print(1)")
    assert res["verdict"] == "AC"


@pytest.mark.asyncio
@respx.mock
async def test_run_uses_override_base_url():
    respx.post(f"{CUSTOM_BASE}/api/submit").mock(
        return_value=Response(200, json={"id": "1", "verdict": "AC"})
    )
    rb = Rustbox("k", CUSTOM_BASE)
    res = await rb.run("python", "print(1)")
    assert res["verdict"] == "AC"


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
