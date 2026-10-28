from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Final

from .config import RegionPolicy

Probe = Callable[[str], Awaitable[float | None]]


@dataclass
class _ProcessRegions:
    picked: dict[str, tuple[str, float]] = field(default_factory=dict)
    penalised_at: dict[str, float] = field(default_factory=dict)


_PROCESS: Final = _ProcessRegions()


class RegionSelector:
    def __init__(self, policy: RegionPolicy, pinned: str | None, probe: Probe) -> None:
        self._policy = policy
        self._pinned = pinned
        self._probe = probe
        self._lock = asyncio.Lock()
        self._key = ",".join(f"{name}={url}" for name, url in sorted(policy.regions.items()))

    async def current(self) -> str:
        if self._pinned is not None:
            return self._pinned
        async with self._lock:
            return await self._select()

    def report_failure(self, base: str) -> None:
        if self._pinned is not None:
            return
        _PROCESS.penalised_at[base] = time.monotonic()
        _PROCESS.picked.pop(self._key, None)

    def _healthy(self, base: str, now: float) -> bool:
        since = _PROCESS.penalised_at.get(base)
        return since is None or now - since > self._policy.failover_penalty_secs

    async def _select(self) -> str:
        now = time.monotonic()
        everyone = list(self._policy.regions.values())
        candidates = [base for base in everyone if self._healthy(base, now)] or everyone
        if len(candidates) == 1:
            return candidates[0]
        cached = _PROCESS.picked.get(self._key)
        if cached is not None and cached[0] in candidates and now - cached[1] < self._policy.cache_ttl_secs:
            return cached[0]
        timings = await asyncio.gather(*(self._probe(base) for base in candidates))
        healthy = sorted((elapsed, base) for base, elapsed in zip(candidates, timings) if elapsed is not None)
        default = self._policy.regions.get(self._policy.default_region)
        fallback = default if default in candidates else candidates[0]
        chosen = healthy[0][1] if healthy else fallback
        _PROCESS.picked[self._key] = (chosen, now)
        return chosen
