"""A minimal sliding-window rate limiter for the login endpoint.

In-process and therefore per-replica: with N replicas the effective allowance is
N times the configured rate. That is accepted deliberately — this layer exists
to blunt the cheap attack (guessing usernames, where no account exists to lock
and the server still burns PBKDF2 CPU), while the durable per-account lockout
lives in the database and is shared by every replica.

No dependency is pulled in for this: the whole mechanism is a deque of
timestamps per key, and a third-party limiter would bring middleware, storage
backends and configuration this service does not need.
"""

import time
from collections import defaultdict, deque


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> int | None:
        """Record an attempt. Returns None when allowed, or the number of
        seconds to wait when the key is over its limit."""
        if self.limit <= 0:
            return None
        now = time.monotonic()
        cutoff = now - self.window
        hits = self._hits[key]
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= self.limit:
            return int(hits[0] + self.window - now) + 1
        hits.append(now)
        self._sweep(cutoff)
        return None

    def _sweep(self, cutoff: float) -> None:
        """Drop keys whose attempts have all aged out. Without this the map
        keeps one entry per address ever seen — a slow leak an attacker could
        drive with spoofed X-Forwarded-For values. Only runs once the map is
        big enough to matter, so the common path stays O(1)."""
        if len(self._hits) < 1024:
            return
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]:
            del self._hits[key]

    def reset(self) -> None:
        self._hits.clear()
