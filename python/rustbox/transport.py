from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from dataclasses import dataclass

import httpx

from .config import RetryPolicy
from .constants import ERROR_FIELD, GET, HEADER_IDEMPOTENCY_KEY, HEADER_RETRY_AFTER, Method
from .errors import (
    RustboxApiError,
    RustboxAuthError,
    RustboxConfigError,
    RustboxDecodeError,
    RustboxError,
    RustboxRateLimitError,
    RustboxServerError,
    RustboxTimeoutError,
    RustboxTransportError,
)
from .models import JudgeBody, RunBody


@dataclass(frozen=True, slots=True)
class Request:
    method: Method
    path: str
    params: Mapping[str, str] | None = None
    body: RunBody | JudgeBody | None = None
    idempotency_key: str | None = None

    @property
    def retryable(self) -> bool:
        return self.method == GET or bool(self.idempotency_key)


class Transport:
    def __init__(self, client: httpx.AsyncClient, retry: RetryPolicy) -> None:
        self._client = client
        self._retry = retry

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send(self, base: str, request: Request) -> httpx.Response:
        if self._client.is_closed:
            raise RustboxConfigError("the client is closed")
        headers = {HEADER_IDEMPOTENCY_KEY: request.idempotency_key} if request.idempotency_key else {}
        retries = self._retry.max_retries if request.retryable else 0
        attempt = 0
        while True:
            final = attempt >= retries
            try:
                response = await self._client.request(
                    request.method,
                    f"{base}{request.path}",
                    params=request.params,
                    json=request.body,
                    headers=headers,
                )
            except httpx.TimeoutException as e:
                if final:
                    raise RustboxTimeoutError(str(e)) from e
            except httpx.TransportError as e:
                if final:
                    raise RustboxTransportError(str(e)) from e
            else:
                if response.status_code < httpx.codes.INTERNAL_SERVER_ERROR:
                    return response
                if final:
                    raise RustboxServerError(response.status_code)
            await asyncio.sleep(self._retry.delay_secs(attempt))
            attempt += 1

    async def probe(self, url: str, timeout_secs: float) -> float | None:
        if self._client.is_closed:
            return None
        started = time.monotonic()
        try:
            response = await self._client.get(url, timeout=timeout_secs)
        except httpx.HTTPError:
            return None
        return time.monotonic() - started if response.is_success else None


def _retry_after_secs(response: httpx.Response) -> int | None:
    raw = response.headers.get(HEADER_RETRY_AFTER, "")
    return int(raw) if raw.isdigit() else None


def _message(response: httpx.Response) -> str:
    try:
        body: object = response.json()
    except ValueError:
        return response.text
    if isinstance(body, dict) and isinstance(body.get(ERROR_FIELD), str):
        return str(body[ERROR_FIELD])
    return response.text


def _error(response: httpx.Response) -> RustboxError:
    status = response.status_code
    if status in (httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN):
        return RustboxAuthError(status)
    if status == httpx.codes.TOO_MANY_REQUESTS:
        return RustboxRateLimitError(_retry_after_secs(response))
    return RustboxApiError(status, _message(response))


def json_body(response: httpx.Response) -> object:
    try:
        body: object = response.json()
    except ValueError as e:
        raise RustboxDecodeError(f"response is not JSON: {e}") from e
    return body


def expect(response: httpx.Response, *statuses: int) -> object:
    if response.status_code not in statuses:
        raise _error(response)
    return json_body(response)
