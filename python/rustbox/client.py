from __future__ import annotations

import asyncio
import uuid
from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Final
from urllib.parse import quote

import httpx

from .config import MAX_RETRIES, REGIONS, TIMEOUT_SECS, ClientConfig
from .errors import TRANSIENT_ERRORS, RustboxConfigError, RustboxStillRunningError
from .constants import (
    GET,
    HEADER_API_KEY,
    HEADER_USER_AGENT,
    MS_PER_SEC,
    PATH_HEALTH,
    PATH_JUDGE,
    PATH_LANGUAGES,
    PATH_READY,
    PATH_RESULT,
    PATH_SUBMIT,
    POST,
    QUERY_WAIT,
    USER_AGENT,
    UUID_PATTERN,
    WAIT_FALSE,
    WAIT_TRUE,
)
from .models import (
    Accepted,
    Execution,
    HealthStatus,
    JudgeBody,
    JudgeCase,
    JudgeResult,
    RunBody,
    parse_health,
    parse_languages,
    parse_pending_id,
)
from .regions import RegionSelector
from .transport import Request, Transport, expect, json_body

WAIT_FOR_RESULT: Final[Mapping[str, str]] = MappingProxyType({QUERY_WAIT: WAIT_TRUE})
QUEUE_ONLY: Final[Mapping[str, str]] = MappingProxyType({QUERY_WAIT: WAIT_FALSE})
NO_SAFE_CHARS: Final = ""


def _result_path(run_id: str) -> str:
    return PATH_RESULT.format(id=quote(run_id, safe=NO_SAFE_CHARS))


class Rustbox:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str | None = None,
        region: str | None = None,
        regions: Mapping[str, str] = REGIONS,
        timeout_secs: float = TIMEOUT_SECS,
        max_retries: int = MAX_RETRIES,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._config = ClientConfig.load(
            api_key,
            base_url=base_url,
            region=region,
            regions=regions,
            timeout_secs=timeout_secs,
            max_retries=max_retries,
        )
        self._transport = Transport(
            httpx.AsyncClient(
                headers={HEADER_API_KEY: self._config.api_key, HEADER_USER_AGENT: USER_AGENT},
                timeout=self._config.timeout_secs,
                transport=transport,
            ),
            self._config.retry,
        )
        self._regions = RegionSelector(self._config.region, self._config.pinned_base_url, self._probe)

    async def __aenter__(self) -> Rustbox:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def base_url(self) -> str:
        return await self._regions.current()

    async def _probe(self, base: str) -> float | None:
        return await self._transport.probe(
            f"{base}{PATH_HEALTH}", self._config.region.probe_timeout_ms / MS_PER_SEC
        )

    async def _send(self, base: str, request: Request) -> httpx.Response:
        try:
            return await self._transport.send(base, request)
        except TRANSIENT_ERRORS:
            self._regions.report_failure(base)
            raise

    async def _call(self, request: Request) -> httpx.Response:
        return await self._send(await self._regions.current(), request)

    async def submit(
        self, language: str, code: str, stdin: str = "", *, idempotency_key: str | None = None
    ) -> Accepted:
        if idempotency_key is not None and not UUID_PATTERN.fullmatch(idempotency_key):
            raise RustboxConfigError(f"idempotency_key must be a UUID, got {idempotency_key!r}")
        body = RunBody(language=language, code=code, stdin=stdin)
        response = await self._call(Request(POST, PATH_SUBMIT, QUEUE_ONLY, body, idempotency_key))
        return Accepted.parse(expect(response, httpx.codes.ACCEPTED))

    async def run(self, language: str, code: str, stdin: str = "") -> Execution:
        base = await self._regions.current()
        body = RunBody(language=language, code=code, stdin=stdin)
        response = await self._send(base, Request(POST, PATH_SUBMIT, WAIT_FOR_RESULT, body, str(uuid.uuid4())))
        if response.status_code == httpx.codes.OK:
            return Execution.parse(json_body(response))
        pending = expect(response, httpx.codes.ACCEPTED, httpx.codes.REQUEST_TIMEOUT)
        return await self._poll(base, parse_pending_id(pending))

    async def _poll(self, base: str, run_id: str) -> Execution:
        for delay_secs in self._config.poll.delays_secs():
            await asyncio.sleep(delay_secs)
            execution = await self._fetch(base, run_id)
            if execution.done:
                return execution
        raise RustboxStillRunningError(run_id)

    async def _fetch(self, base: str, run_id: str) -> Execution:
        response = await self._send(base, Request(GET, _result_path(run_id)))
        return Execution.parse(expect(response, httpx.codes.OK))

    async def get_result(self, run_id: str) -> Execution:
        return await self._fetch(await self._regions.current(), run_id)

    async def judge(self, language: str, code: str, cases: Sequence[JudgeCase]) -> JudgeResult:
        body = JudgeBody(language=language, code=code, cases=[case.to_json() for case in cases])
        response = await self._call(Request(POST, PATH_JUDGE, body=body))
        return JudgeResult.parse(expect(response, httpx.codes.OK))

    async def get_languages(self) -> list[str]:
        response = await self._call(Request(GET, PATH_LANGUAGES))
        return parse_languages(expect(response, httpx.codes.OK))

    async def get_health(self) -> HealthStatus:
        response = await self._call(Request(GET, PATH_HEALTH))
        return parse_health(expect(response, httpx.codes.OK))

    async def get_ready(self) -> HealthStatus:
        response = await self._call(Request(GET, PATH_READY))
        return parse_health(expect(response, httpx.codes.OK))
