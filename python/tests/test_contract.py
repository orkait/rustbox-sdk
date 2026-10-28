from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable, Iterator, Mapping
from importlib.metadata import version
from pathlib import Path
from typing import Final

import httpx
import pytest

from rustbox import (
    Accepted,
    Execution,
    HealthStatus,
    JudgeCase,
    JudgeResult,
    Rustbox,
    RustboxApiError,
    RustboxAuthError,
    RustboxConfigError,
    RustboxDecodeError,
    RustboxError,
    RustboxRateLimitError,
    RustboxServerError,
    RustboxStillRunningError,
    RustboxTimeoutError,
    RustboxTransportError,
    Status,
    Verdict,
    config,
    constants,
)
from rustbox.config import ClientConfig, RegionPolicy, pinned_base_url
from rustbox.models import TERMINAL_STATUSES
from rustbox.regions import RegionSelector

CONTRACT_DIR: Final = Path(__file__).resolve().parents[2] / "contract"
CONTRACT: Final = json.loads((CONTRACT_DIR / "contract.json").read_text())
SCENARIOS: Final = json.loads((CONTRACT_DIR / "scenarios.json").read_text())["scenarios"]
PACKAGE: Final = "rustbox"
LANG: Final = "py"
API_KEY: Final = "rb_contract_test"
BASE_URL: Final = "https://sdk.test"
QUERY_SEPARATOR: Final = "?"

ERROR_KINDS: Final[Mapping[type[RustboxError], str]] = {
    RustboxConfigError: "config",
    RustboxAuthError: "auth",
    RustboxRateLimitError: "rate_limit",
    RustboxServerError: "server",
    RustboxTimeoutError: "timeout",
    RustboxStillRunningError: "still_running",
    RustboxApiError: "api",
    RustboxTransportError: "transport",
    RustboxDecodeError: "decode",
}

BINDINGS: Final[Mapping[str, object]] = {
    "version": constants.VERSION,
    "regions": dict(config.REGIONS),
    "default_region": config.DEFAULT_REGION,
    "region_selection": {
        "probe_path": constants.PATH_HEALTH,
        "probe_timeout_ms": config.PROBE_TIMEOUT_MS,
        "cache_ttl_secs": config.REGION_CACHE_TTL_SECS,
        "failover_penalty_secs": config.FAILOVER_PENALTY_SECS,
    },
    "env": {"base_url": config.ENV_BASE_URL, "region": config.ENV_REGION},
    "headers": {
        "api_key": constants.HEADER_API_KEY,
        "user_agent": constants.HEADER_USER_AGENT,
        "idempotency_key": constants.HEADER_IDEMPOTENCY_KEY,
        "retry_after": constants.HEADER_RETRY_AFTER,
    },
    "timeout_secs": config.TIMEOUT_SECS,
    "retry": {
        "max_retries": config.MAX_RETRIES,
        "backoff_base_ms": config.BACKOFF_BASE_MS,
        "backoff_cap_ms": config.BACKOFF_CAP_MS,
    },
    "poll": {
        "max_polls": config.POLL_MAX,
        "first_delay_ms": config.POLL_FIRST_DELAY_MS,
        "growth": config.POLL_GROWTH,
        "cap_ms": config.POLL_CAP_MS,
    },
    "paths": {
        "submit": constants.PATH_SUBMIT,
        "result": constants.PATH_RESULT,
        "judge": constants.PATH_JUDGE,
        "languages": constants.PATH_LANGUAGES,
        "health": constants.PATH_HEALTH,
        "ready": constants.PATH_READY,
    },
    "verdicts": [v.value for v in Verdict if v is not Verdict.UNKNOWN],
    "statuses": [s.value for s in Status if s is not Status.UNKNOWN],
    "terminal_statuses": [s.value for s in Status if s in TERMINAL_STATUSES],
    "health_statuses": [h.value for h in HealthStatus if h is not HealthStatus.UNKNOWN],
    "unknown": constants.UNKNOWN,
    "errors": list(ERROR_KINDS.values()),
}


def arg(call: object, key: str) -> str:
    assert isinstance(call, dict)
    value = call[key]
    assert isinstance(value, str)
    return value


def optional_arg(call: Mapping[str, object], key: str) -> str | None:
    return arg(call, key) if call.get(key) is not None else None


def judge_cases(call: Mapping[str, object]) -> list[JudgeCase]:
    raw = call["cases"]
    assert isinstance(raw, list)
    return [JudgeCase(arg(case, "stdin"), arg(case, "expected")) for case in raw]


Call = Callable[[Rustbox, Mapping[str, object]], Awaitable[object]]

OPS: Final[Mapping[str, Call]] = {
    "submit": lambda c, call: c.submit(
        arg(call, "language"), arg(call, "code"), arg(call, "stdin"),
        idempotency_key=optional_arg(call, "idempotency_key"),
    ),
    "run": lambda c, call: c.run(arg(call, "language"), arg(call, "code"), arg(call, "stdin")),
    "get_result": lambda c, call: c.get_result(arg(call, "id")),
    "judge": lambda c, call: c.judge(arg(call, "language"), arg(call, "code"), judge_cases(call)),
    "languages": lambda c, call: c.get_languages(),
    "health": lambda c, call: c.get_health(),
    "ready": lambda c, call: c.get_ready(),
}


@pytest.fixture(autouse=True)
def no_region_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(config.ENV_BASE_URL, raising=False)
    monkeypatch.delenv(config.ENV_REGION, raising=False)
    yield


def observe(value: object) -> dict[str, object]:
    if isinstance(value, Execution):
        return {"result": {
            "id": value.id,
            "status": value.status.value,
            "verdict": None if value.result.verdict is None else value.result.verdict.value,
            "stdout": value.output.stdout,
            "exit_code": value.result.exit_code,
        }}
    if isinstance(value, Accepted):
        return {"accepted": {"id": value.id, "status": value.status.value}}
    if isinstance(value, JudgeResult):
        return {"judge": {
            "all_passed": value.all_passed,
            "verdicts": [None if r.verdict is None else r.verdict.value for r in value.results],
            "passed": [r.passed for r in value.results],
        }}
    if isinstance(value, HealthStatus):
        return {"health": value.value}
    return {"languages": value}


async def outcome(client: Rustbox, call: Mapping[str, object], expect: Mapping[str, object]) -> dict[str, object]:
    try:
        return observe(await OPS[arg(call, "op")](client, call))
    except RustboxError as error:
        wanted = expect.get("error")
        assert isinstance(wanted, dict), f"unexpected {error!r}"
        seen = {
            "kind": ERROR_KINDS[type(error)],
            "status": getattr(error, "status", None),
            "retry_after_secs": getattr(error, "retry_after_secs", None),
            "message": getattr(error, "message", None),
            "run_id": getattr(error, "run_id", None),
        }
        return {"error": {key: seen[key] for key in wanted}}


class Replay:
    def __init__(self, exchanges: list[dict[str, dict[str, object]]]) -> None:
        self.exchanges = exchanges
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert len(self.requests) <= len(self.exchanges), f"extra request {request.method} {request.url}"
        canned = self.exchanges[len(self.requests) - 1]["response"]
        headers = canned.get("headers", {})
        assert isinstance(headers, dict)
        return httpx.Response(int(str(canned["status"])), json=canned["body"], headers=headers)


def check_request(request: httpx.Request, expected: dict[str, object], previous_key: str | None) -> str | None:
    assert request.method == expected["method"]
    assert request.url.raw_path.decode().partition(QUERY_SEPARATOR)[0] == expected["path"]
    assert dict(request.url.params) == expected.get("query", {})
    assert request.headers[constants.HEADER_API_KEY] == API_KEY
    assert request.headers[constants.HEADER_USER_AGENT] == constants.USER_AGENT
    if "body" in expected:
        assert json.loads(request.content) == expected["body"]
    else:
        assert request.content == b""
    key = request.headers.get(constants.HEADER_IDEMPOTENCY_KEY)
    match expected.get("idempotency_key", "absent"):
        case "absent":
            assert key is None
        case "uuid":
            assert key is not None and str(uuid.UUID(key)) == key
        case "repeat":
            assert key is not None and key == previous_key
        case literal:
            assert key == literal
    return key


@pytest.mark.parametrize("key", BINDINGS)
def test_sdk_matches_the_contract(key: str) -> None:
    assert BINDINGS[key] == CONTRACT[key]


def test_version_and_user_agent_match_the_package() -> None:
    assert version(PACKAGE) == constants.VERSION
    assert constants.USER_AGENT == CONTRACT["user_agent"].format(lang=LANG, version=constants.VERSION)


def test_every_contract_operation_is_implemented_and_exercised() -> None:
    assert set(OPS) == set(CONTRACT["operations"])
    assert {s["call"]["op"] for s in SCENARIOS} == set(CONTRACT["operations"])


@pytest.mark.parametrize("case", CONTRACT["config_cases"], ids=lambda case: case["name"])
def test_client_config(case: dict[str, object]) -> None:
    regions = case.get("regions", config.REGIONS)
    timeout_secs = case.get("timeout_secs", config.TIMEOUT_SECS)
    max_retries = case.get("max_retries", config.MAX_RETRIES)
    assert isinstance(regions, Mapping) and isinstance(timeout_secs, (int, float)) and isinstance(max_retries, int)

    def load() -> ClientConfig:
        return ClientConfig.load(
            arg(case, "api_key"),
            regions=regions,
            timeout_secs=float(timeout_secs),
            max_retries=max_retries,
            env={},
        )

    if "expect_error" in case:
        with pytest.raises(RustboxConfigError):
            load()
    else:
        load()


@pytest.mark.parametrize("case", CONTRACT["resolution"], ids=lambda case: case["name"])
def test_base_url_resolution(case: dict[str, str]) -> None:
    env = {config.ENV_BASE_URL: case.get("env_base_url", ""), config.ENV_REGION: case.get("env_region", "")}

    def resolve() -> str:
        pinned = pinned_base_url(case.get("base_url"), case.get("region"), env, config.REGIONS)
        return pinned or config.REGIONS[config.DEFAULT_REGION]

    if "expect_error" in case:
        with pytest.raises(RustboxConfigError):
            resolve()
    else:
        assert resolve() == case["expect"]


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda scenario: scenario["name"])
async def test_scenario(scenario: dict[str, object]) -> None:
    listed = scenario["exchanges"]
    expect = scenario["expect"]
    call = scenario["call"]
    assert isinstance(listed, list) and isinstance(expect, dict) and isinstance(call, dict)
    exchanges = [exchange for exchange in listed for _ in range(exchange.get("times", 1))]
    replay = Replay(exchanges)
    async with Rustbox(API_KEY, base_url=BASE_URL, transport=httpx.MockTransport(replay)) as client:
        assert await outcome(client, call, expect) == expect
    assert len(replay.requests) == len(exchanges)
    key: str | None = None
    for request, exchange in zip(replay.requests, exchanges):
        key = check_request(request, exchange["request"], key)


@pytest.mark.parametrize("case", CONTRACT["region_cases"], ids=lambda case: case["name"])
async def test_region_selection(case: dict[str, object]) -> None:
    specs = case["regions"]
    steps = case["expect"]
    assert isinstance(specs, dict) and isinstance(steps, list)
    run = uuid.uuid4().hex
    regions = {name: f"https://{name}.{run}.test" for name in specs}
    names = {f"{name}.{run}.test": name for name in specs}
    calls = {name: {"health": 0, "languages": 0} for name in specs}

    async def handler(request: httpx.Request) -> httpx.Response:
        name = names[request.url.host]
        spec = specs[name]
        if request.url.path == constants.PATH_HEALTH:
            calls[name]["health"] += 1
            await asyncio.sleep(spec["health"]["delay_ms"] / constants.MS_PER_SEC)
            return httpx.Response(spec["health"]["status"], json={"status": HealthStatus.OK.value})
        calls[name]["languages"] += 1
        return httpx.Response(spec["languages"]["status"], json=spec["languages"]["body"])

    pin = case["pin"]
    for expect in steps:
        async with Rustbox(
            API_KEY,
            region=None if pin is None else str(pin),
            regions=regions,
            transport=httpx.MockTransport(handler),
        ) as client:
            assert await outcome(client, {"op": "languages"}, expect) == expect
    assert calls == case["calls"]


async def test_an_expired_pick_is_probed_again() -> None:
    run = uuid.uuid4().hex
    regions = {name: f"https://{name}.{run}.test" for name in ("a", "b")}
    probed: list[str] = []

    async def probe(base: str) -> float | None:
        probed.append(base)
        return 0.0

    selector = RegionSelector(RegionPolicy(regions=regions, cache_ttl_secs=0), None, probe)
    for _ in range(2):
        await selector.current()
    assert sorted(probed) == sorted([*regions.values()] * 2)


async def test_a_closed_client_is_a_config_error() -> None:
    client = Rustbox(API_KEY, base_url=BASE_URL, transport=httpx.MockTransport(Replay([])))
    await client.aclose()
    with pytest.raises(RustboxConfigError):
        await client.get_languages()
