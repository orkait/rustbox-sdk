from __future__ import annotations

import os
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from .constants import MS_PER_SEC
from .errors import RustboxConfigError

ENV_BASE_URL: Final = "RUSTBOX_BASE_URL"
ENV_REGION: Final = "RUSTBOX_REGION"
URL_SCHEMES: Final = ("http://", "https://")
API_KEY_PATTERN: Final = re.compile(r"[\x21-\x7e]+")

REGIONS: Final[Mapping[str, str]] = MappingProxyType({"in": "https://api.rustbox.sh"})
DEFAULT_REGION: Final = "in"
PROBE_TIMEOUT_MS: Final = 1500
REGION_CACHE_TTL_SECS: Final = 21_600
FAILOVER_PENALTY_SECS: Final = 300

TIMEOUT_SECS: Final = 65.0
MAX_RETRIES: Final = 2
BACKOFF_BASE_MS: Final = 100
BACKOFF_CAP_MS: Final = 5000

POLL_MAX: Final = 45
POLL_FIRST_DELAY_MS: Final = 40
POLL_GROWTH: Final = 1.5
POLL_CAP_MS: Final = 600


def _url(value: str, what: str) -> str:
    if not value.startswith(URL_SCHEMES):
        raise RustboxConfigError(f"{what} must start with http:// or https://, got {value!r}")
    return value.rstrip("/")


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    max_retries: int = MAX_RETRIES
    backoff_base_ms: int = BACKOFF_BASE_MS
    backoff_cap_ms: int = BACKOFF_CAP_MS

    def delay_secs(self, attempt: int) -> float:
        return min(self.backoff_base_ms << attempt, self.backoff_cap_ms) / MS_PER_SEC


@dataclass(frozen=True, slots=True)
class PollPolicy:
    max_polls: int = POLL_MAX
    first_delay_ms: int = POLL_FIRST_DELAY_MS
    growth: float = POLL_GROWTH
    cap_ms: int = POLL_CAP_MS

    def delays_secs(self) -> Iterator[float]:
        delay_ms = float(self.first_delay_ms)
        for _ in range(self.max_polls):
            yield delay_ms / MS_PER_SEC
            delay_ms = min(delay_ms * self.growth, self.cap_ms)


@dataclass(frozen=True, slots=True)
class RegionPolicy:
    regions: Mapping[str, str] = REGIONS
    default_region: str = DEFAULT_REGION
    probe_timeout_ms: int = PROBE_TIMEOUT_MS
    cache_ttl_secs: int = REGION_CACHE_TTL_SECS
    failover_penalty_secs: int = FAILOVER_PENALTY_SECS


def pinned_base_url(
    base_url: str | None, region: str | None, env: Mapping[str, str], regions: Mapping[str, str]
) -> str | None:
    if base_url is not None:
        return _url(base_url, "base_url")
    env_base_url = env.get(ENV_BASE_URL, "")
    if env_base_url:
        return _url(env_base_url, ENV_BASE_URL)
    chosen = region if region is not None else env.get(ENV_REGION, "")
    if region is None and not chosen:
        return None
    if chosen not in regions:
        raise RustboxConfigError(f"unknown region {chosen!r}; known regions: {', '.join(regions)}")
    return regions[chosen]


@dataclass(frozen=True, slots=True)
class ClientConfig:
    api_key: str
    pinned_base_url: str | None
    timeout_secs: float
    retry: RetryPolicy
    poll: PollPolicy
    region: RegionPolicy

    @classmethod
    def load(
        cls,
        api_key: str,
        *,
        base_url: str | None = None,
        region: str | None = None,
        regions: Mapping[str, str] = REGIONS,
        timeout_secs: float = TIMEOUT_SECS,
        max_retries: int = MAX_RETRIES,
        env: Mapping[str, str] | None = None,
    ) -> ClientConfig:
        if not API_KEY_PATTERN.fullmatch(api_key):
            raise RustboxConfigError("api_key is required and must be visible ASCII without spaces")
        if max_retries < 0:
            raise RustboxConfigError(f"max_retries must not be negative, got {max_retries}")
        if timeout_secs <= 0:
            raise RustboxConfigError(f"timeout_secs must be positive, got {timeout_secs}")
        if not regions:
            raise RustboxConfigError("regions must not be empty")
        checked = MappingProxyType({name: _url(url, f"region {name}") for name, url in regions.items()})
        return cls(
            api_key=api_key,
            pinned_base_url=pinned_base_url(base_url, region, os.environ if env is None else env, checked),
            timeout_secs=timeout_secs,
            retry=RetryPolicy(max_retries=max_retries),
            poll=PollPolicy(),
            region=RegionPolicy(regions=checked),
        )
