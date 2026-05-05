import httpx
import asyncio
from typing import Dict, Any, List, Literal, Optional
from .errors import RustboxAuthError, RustboxRateLimitError, RustboxServerError, RustboxError

DEFAULT_BASE_URL = "https://rustbox-api.orkait.com"

Profile = Literal["judge", "agent"]


class Rustbox:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL):
        if not api_key:
            raise ValueError("api_key required")
        if not base_url:
            raise ValueError("base_url cannot be empty")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"X-API-Key": api_key, "Content-Type": "application/json"},
        )

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

    async def submit(
        self,
        language: str,
        code: str,
        stdin: str = "",
        profile: Optional[Profile] = None,
        wait: bool = False,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"language": language, "code": code, "stdin": stdin}
        if profile is not None:
            body["profile"] = profile
        resp = await self.client.post(
            "/api/submit",
            params={"wait": str(wait).lower()},
            json=body,
        )
        self._handle_error(resp)
        return resp.json()

    async def get_result(self, job_id: str) -> Dict[str, Any]:
        resp = await self.client.get(f"/api/result/{job_id}")
        self._handle_error(resp)
        return resp.json()

    async def get_languages(self) -> List[str]:
        resp = await self.client.get("/api/languages")
        self._handle_error(resp)
        return resp.json()

    async def get_health(self) -> Dict[str, Any]:
        resp = await self.client.get("/api/health")
        self._handle_error(resp)
        return resp.json()

    async def get_ready(self) -> Dict[str, Any]:
        resp = await self.client.get("/api/health/ready")
        self._handle_error(resp)
        return resp.json()

    async def run(
        self,
        language: str,
        code: str,
        stdin: str = "",
        profile: Optional[Profile] = None,
    ) -> Dict[str, Any]:
        res = await self.submit(language, code, stdin, profile=profile, wait=True)
        if res.get("verdict"):
            return res

        job_id = res["id"]
        for i in range(45):
            await asyncio.sleep(min(0.04 * (1.5 ** i), 0.6))
            data = await self.get_result(job_id)
            if data.get("verdict"):
                return data
        return res
