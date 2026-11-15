"""Sliding-window rate limit, held in memory.

Counts are per process. With more than one Cloud Run instance the effective
limit is the per-instance limit times the instance count.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable

SIGNED_IN_PER_MINUTE = 30
GUEST_PER_MINUTE = 10
WINDOW_S = 60.0


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int) -> tuple[bool, int]:
        """(allowed, seconds until the next request would be allowed)."""
        now = self._clock()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= WINDOW_S:
                hits.popleft()
            if len(hits) >= limit:
                return False, max(1, int(WINDOW_S - (now - hits[0])) + 1)
            hits.append(now)
            if len(self._hits) > 10_000:  # drop idle keys so the map cannot grow forever
                for stale in [k for k, v in self._hits.items() if not v or now - v[-1] >= WINDOW_S]:
                    del self._hits[stale]
            return True, 0
