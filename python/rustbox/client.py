import asyncio
import os
import time
import uuid
from typing import Any, Dict, List, Literal, Optional

import httpx
from .errors import RustboxAuthError, RustboxRateLimitError, RustboxServerError, RustboxError, RustboxTimeoutError

VERSION = "0.1.0"

# Known regions. Add new entries here when a region launches; the SDK's
# auto-probe iterates every value and picks the fastest. Module-level so
# callers can monkey-patch in tests or for staging environments.
REGIONS: Dict[str, str] = {
    "eu": "https://rustbox-eu.orkait.com",
    "us": "https://rustbox-us.orkait.com",
}

DEFAULT_TIMEOUT_SECS = 65.0
DEFAULT_MAX_RETRIES = 2
PROBE_TIMEOUT_SECS = 1.5
PICK_CACHE_TTL_SECS = 60 * 60        # 1 h
FAILOVER_PENALTY_SECS = 5 * 60       # 5 min
USER_AGENT = f"rustbox-sdk-py/{VERSION}"

Profile = Literal["judge", "agent"]

# Module-level caches shared across instances in the same process.
_pick_cache: Dict[str, tuple] = {}                 # regions_key -> (base, picked_at)
_unhealthy_since: Dict[str, float] = {}            # base -> ts

def _regions_key(regions: Dict[str, str]) -> str:
    return ",".join(f"{k}={v}" for k, v in sorted(regions.items()))


async def _probe(base: str) -> Optional[float]:
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECS) as c:
            resp = await c.get(f"{base}/api/health")
            if resp.status_code >= 400:
                return None
        return time.monotonic() - start
    except Exception:
        return None


async def pick_fastest_region(regions: Dict[str, str] = REGIONS) -> str:
    """Probe every region in parallel, return the fastest reachable base.

    Result cached for 1h per regions-set. Falls back to the first listed
    region if all probes fail (never raises)."""
    key = _regions_key(regions)
    cached = _pick_cache.get(key)
    if cached and time.monotonic() - cached[1] < PICK_CACHE_TTL_SECS:
        return cached[0]
    bases = list(regions.values())
    results = await asyncio.gather(*(_probe(b) for b in bases))
    pairs = [(b, ms) for b, ms in zip(bases, results) if ms is not None]
    base = min(pairs, key=lambda p: p[1])[0] if pairs else bases[0]
    _pick_cache[key] = (base, time.monotonic())
    return base


class Rustbox:
    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        *,
        region: Optional[str] = None,
        regions: Optional[Dict[str, str]] = None,
        timeout_secs: float = DEFAULT_TIMEOUT_SECS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        failover_across_regions: bool = True,
    ):
        if not api_key:
            raise ValueError("api_key required")
        self.api_key = api_key
        self.max_retries = max_retries
        self.timeout_secs = timeout_secs
        self.regions = regions or REGIONS
        self.failover_across_regions = failover_across_regions

        # Priority: explicit base_url > env baseUrl > explicit region >
        # env RUSTBOX_REGION > deferred auto-probe.
        explicit_base = base_url or os.environ.get("RUSTBOX_BASE_URL")
        explicit_region = region or os.environ.get("RUSTBOX_REGION")
        if explicit_base:
            self._base_url: Optional[str] = explicit_base.rstrip("/")
        elif explicit_region and explicit_region in self.regions:
            self._base_url = self.regions[explicit_region]
        else:
            self._base_url = None  # resolved on first request

        self.client = httpx.AsyncClient(
            headers={
                "X-API-Key": api_key,
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
            timeout=timeout_secs if timeout_secs > 0 else None,
        )

    async def base(self) -> str:
        if self._base_url is None:
            self._base_url = await pick_fastest_region(self.regions)
        return self._base_url

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

    def _alternates(self, current: str) -> List[str]:
        now = time.monotonic()
        out = []
        for b in self.regions.values():
            if b == current:
                continue
            since = _unhealthy_since.get(b)
            if not since or now - since > FAILOVER_PENALTY_SECS:
                out.append(b)
        return out

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        current = await self.base()
        tried: set = set()
        last_exc: Optional[BaseException] = None
        while True:
            tried.add(current)
            try:
                return await self._request_one(current, method, path, **kwargs)
            except (RustboxServerError, RustboxTimeoutError, httpx.NetworkError) as e:
                last_exc = e
                if not self.failover_across_regions:
                    raise
                _unhealthy_since[current] = time.monotonic()
                # Pick a not-yet-tried alternate region.
                next_base = next((b for b in self._alternates(current) if b not in tried), None)
                if not next_base:
                    raise
                current = next_base
                self._base_url = current
                _pick_cache.pop(_regions_key(self.regions), None)

    async def _request_one(self, base: str, method: str, path: str, **kwargs: Any) -> httpx.Response:
        url = f"{base}{path}"
        for attempt in range(self.max_retries + 1):
            try:
                resp = await self.client.request(method, url, **kwargs)
                if resp.status_code >= 500 and attempt < self.max_retries:
                    await asyncio.sleep(self._backoff_delay(attempt))
                    continue
                if resp.status_code >= 500:
                    raise RustboxServerError(f"Server error: {resp.status_code}")
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
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"language": language, "code": code, "stdin": stdin}
        if profile is not None:
            body["profile"] = profile
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
