import asyncio
import uuid
from typing import Any, Dict, List, Literal, Optional

import httpx
from .errors import RustboxAuthError, RustboxRateLimitError, RustboxServerError, RustboxError, RustboxTimeoutError

VERSION = "0.1.0"

DEFAULT_BASE_URL = "https://rustbox-api.orkait.com"
DEFAULT_TIMEOUT_SECS = 65.0
DEFAULT_MAX_RETRIES = 2
USER_AGENT = f"rustbox-sdk-py/{VERSION}"

Profile = Literal["judge", "agent"]


class Rustbox:
    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout_secs: float = DEFAULT_TIMEOUT_SECS,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ):
        if not api_key:
            raise ValueError("api_key required")
        if not base_url:
            raise ValueError("base_url cannot be empty")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.max_retries = max_retries
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "X-API-Key": api_key,
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
            timeout=timeout_secs if timeout_secs > 0 else None,
        )

    async def __aenter__(self) -> "Rustbox":
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self.client.aclose()

    def _handle_error(self, response: httpx.Response):
        if response.is_success or response.status_code == 408:
            return
        if response.status_code in (401, 403):
            raise RustboxAuthError("Invalid API key")
        if response.status_code == 429:
            raise RustboxRateLimitError("Rate limit exceeded")
        if response.status_code >= 500:
            raise RustboxServerError(f"Server error: {response.status_code}")
        raise RustboxError(f"API Error: {response.status_code} - {response.text}")

    def _backoff_delay(self, attempt: int) -> float:
        return min(0.1 * (2 ** attempt), 5.0)

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        for attempt in range(self.max_retries + 1):
            try:
                resp = await self.client.request(method, path, **kwargs)
                if resp.status_code >= 500 and attempt < self.max_retries:
                    await asyncio.sleep(self._backoff_delay(attempt))
                    continue
                return resp
            except httpx.TimeoutException as e:
                if attempt >= self.max_retries:
                    raise RustboxTimeoutError(str(e)) from e
                await asyncio.sleep(self._backoff_delay(attempt))
            except httpx.NetworkError:
                if attempt >= self.max_retries:
                    raise
                await asyncio.sleep(self._backoff_delay(attempt))
        raise RustboxError("retry exhausted")  # unreachable

    async def submit(
        self,
        language: str,
        code: str,
        stdin: str = "",
        profile: Optional[Profile] = None,
        wait: bool = False,
        idempotency_key: Optional[str] = None,
        webhook_url: Optional[str] = None,
        webhook_secret: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"language": language, "code": code, "stdin": stdin}
        if profile is not None:
            body["profile"] = profile
        if webhook_url is not None:
            body["webhook_url"] = webhook_url
        if webhook_secret is not None:
            body["webhook_secret"] = webhook_secret
        headers: Dict[str, str] = {}
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        resp = await self._request(
            "POST",
            "/api/submit",
            params={"wait": str(wait).lower()},
            json=body,
            headers=headers or None,
        )
        self._handle_error(resp)
        return resp.json()

    async def get_result(self, job_id: str) -> Dict[str, Any]:
        resp = await self._request("GET", f"/api/result/{job_id}")
        self._handle_error(resp)
        return resp.json()

    async def get_languages(self) -> List[str]:
        resp = await self._request("GET", "/api/languages")
        self._handle_error(resp)
        return resp.json()

    async def get_health(self) -> Dict[str, Any]:
        resp = await self._request("GET", "/api/health")
        self._handle_error(resp)
        return resp.json()

    async def get_ready(self) -> Dict[str, Any]:
        resp = await self._request("GET", "/api/health/ready")
        self._handle_error(resp)
        return resp.json()

    async def run(
        self,
        language: str,
        code: str,
        stdin: str = "",
        profile: Optional[Profile] = None,
    ) -> Dict[str, Any]:
        # Auto-generated idempotency key makes the underlying POST safe to retry.
        res = await self.submit(
            language, code, stdin,
            profile=profile, wait=True, idempotency_key=str(uuid.uuid4()),
        )
        if res.get("verdict"):
            return res

        job_id = res["id"]
        for i in range(45):
            await asyncio.sleep(min(0.04 * (1.5 ** i), 0.6))
            data = await self.get_result(job_id)
            if data.get("verdict"):
                return data
        return res
