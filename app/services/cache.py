"""In-process caches for the render path.

Two kinds of thing are cached here, and they are deliberately not cached the
same way.

**Content-addressed entities can be cached forever.** An asset is keyed by the
sha256 of its bytes; a compiled template by the hash of its source. The key *is*
the content, so a hit cannot be wrong — not after a rollback, not after the
database is restored from a backup, not ever.

**Identity-addressed entities cannot.** "Whichever version `invoice` serves
right now" is a pointer, and pointers move: publishing, rolling back and
archiving all change what a code resolves to. Those entries carry a short TTL,
so a process that did not perform the change follows within seconds — and the
process that *did* perform it drops the entry immediately, which is why the
shipped container (one uvicorn process) is never stale at all.

Everything is bounded by BYTES rather than by entry count. The count bound this
replaces looked safe and was not: 64 assets of up to 10 MB, base64-inflated, is
850 MB of strings per process — and at twenty replicas that is the memory of the
whole deployment spent on caching logos.

Eviction is least-recently-used. FIFO is one line shorter and evicts exactly the
wrong thing: the entry a template hits on every render is also the oldest.

No locks: every caller runs on the single-threaded event loop, and nothing here
awaits, so a get/put pair cannot interleave with another. Two concurrent misses
can both fetch and both store — harmless, since they store the same value.
"""

import sys
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Hashable

from prometheus_client import Counter, Gauge

from app.core.metrics import REGISTRY

cache_hits_total = Counter(
    "linform_cache_hits_total",
    "Cache lookups served from memory.",
    labelnames=("cache",),
    registry=REGISTRY,
)

cache_misses_total = Counter(
    "linform_cache_misses_total",
    "Cache lookups that had to go to the database. Includes entries dropped "
    "for age: a TTL expiry is a miss, which is what makes the hit ratio an "
    "honest reading of how much work the cache actually saves.",
    labelnames=("cache",),
    registry=REGISTRY,
)

cache_evictions_total = Counter(
    "linform_cache_evictions_total",
    "Entries dropped to stay inside the size budget. Climbing steadily means "
    "the budget is too small for the working set, and the hit ratio is paying "
    "for it.",
    labelnames=("cache",),
    registry=REGISTRY,
)

cache_bytes = Gauge(
    "linform_cache_bytes",
    "Bytes currently held.",
    labelnames=("cache",),
    registry=REGISTRY,
)

cache_entries = Gauge(
    "linform_cache_entries",
    "Entries currently held.",
    labelnames=("cache",),
    registry=REGISTRY,
)


@dataclass(slots=True)
class _Entry:
    value: Any
    size: int
    stored_at: float


class Cache:
    """An LRU cache bounded by bytes, entries, or both, with an optional TTL.

    `ttl_seconds=None` means entries never expire, and is only correct for a
    content-addressed key. Anything else must state how stale it may get.
    """

    def __init__(
        self,
        name: str,
        *,
        max_bytes: int | None = None,
        max_entries: int | None = None,
        ttl_seconds: float | None = None,
    ):
        if max_bytes is None and max_entries is None:
            raise ValueError("a cache without a bound is a memory leak with a nice name")
        self.name = name
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        # A zero budget or a zero TTL is how an operator switches a cache off.
        # Make that exact rather than "expires so fast it almost always misses":
        # the monotonic clock ticks in milliseconds on some platforms, and
        # "almost always" is not a property anyone can operate against.
        self.disabled = (ttl_seconds is not None and ttl_seconds <= 0) or (
            max_bytes is not None and max_bytes <= 0
        )
        self._entries: OrderedDict[Hashable, _Entry] = OrderedDict()
        self._bytes = 0
        _REGISTERED.append(self)
        self._publish()

    # --- reading -----------------------------------------------------------

    def get(self, key: Hashable) -> Any | None:
        if self.disabled:
            cache_misses_total.labels(cache=self.name).inc()
            return None
        entry = self._entries.get(key)
        if entry is None:
            cache_misses_total.labels(cache=self.name).inc()
            return None
        if self.ttl_seconds is not None and time.monotonic() - entry.stored_at > self.ttl_seconds:
            self._drop(key)
            cache_misses_total.labels(cache=self.name).inc()
            return None
        self._entries.move_to_end(key)
        cache_hits_total.labels(cache=self.name).inc()
        return entry.value

    # --- writing -----------------------------------------------------------

    def put(self, key: Hashable, value: Any, *, size: int | None = None) -> None:
        """Store `value`. `size` is its weight in bytes; without one the value's
        own footprint is used, which is right for a str or bytes and wrong for
        anything holding a reference to something larger — so callers holding a
        wrapper pass the size of what it wraps."""
        if self.disabled:
            return
        if size is None:
            size = sys.getsizeof(value)
        # A single value larger than the whole budget would evict everything and
        # then not fit: skip it rather than empty the cache on its behalf.
        if self.max_bytes is not None and size > self.max_bytes:
            return
        self._drop(key)
        self._entries[key] = _Entry(value=value, size=size, stored_at=time.monotonic())
        self._bytes += size
        self._evict_to_fit()
        self._publish()

    def invalidate(self, key: Hashable) -> None:
        self._drop(key)
        self._publish()

    def clear(self) -> None:
        self._entries.clear()
        self._bytes = 0
        self._publish()

    # --- internals ---------------------------------------------------------

    def _drop(self, key: Hashable) -> None:
        entry = self._entries.pop(key, None)
        if entry is not None:
            self._bytes -= entry.size

    def _evict_to_fit(self) -> None:
        while self._entries and (
            (self.max_bytes is not None and self._bytes > self.max_bytes)
            or (self.max_entries is not None and len(self._entries) > self.max_entries)
        ):
            oldest = next(iter(self._entries))
            self._drop(oldest)
            cache_evictions_total.labels(cache=self.name).inc()

    def _publish(self) -> None:
        cache_bytes.labels(cache=self.name).set(self._bytes)
        cache_entries.labels(cache=self.name).set(len(self._entries))

    # --- introspection, for tests and for the readiness of a human ---------

    @property
    def nbytes(self) -> int:
        return self._bytes

    def __len__(self) -> int:
        return len(self._entries)


_REGISTERED: list[Cache] = []


# --- the render path's three caches ----------------------------------------
#
# Declared together because the interesting thing about them is the contrast:
# the first two are keyed by content and the third by a name that moves.

# Assets resolved to data: URIs, keyed by the sha256 of the bytes. Immutable by
# construction — "updating a logo" is new bytes under a new hash — so no TTL.
# The bound is bytes because base64 of a 10 MB asset is 13 MB of string.
ASSETS = Cache("assets", max_bytes=64 * 1024 * 1024)

# Compiled Jinja templates, keyed by version id, strict mode AND a hash of the
# source. The hash is what makes the id safe to use: an id is a primary key of
# one particular database, and a process can outlive the database it was talking
# to. Bounded by entries — a compiled template's real footprint is not
# something Python will tell us.
COMPILED = Cache("compiled_templates", max_entries=256)

# What a template code resolves to right now. This one is a pointer, so it gets
# a TTL: publishing, rolling back and archiving all move it. Short, because the
# number is how long another replica may keep serving the previous version after
# a rollback — the operation you perform when something is already wrong.
TARGETS = Cache("render_targets", max_bytes=32 * 1024 * 1024, ttl_seconds=2.0)


def configure(settings) -> None:
    """Apply configured budgets. Called once from the application lifespan;
    the defaults above are what the module does without it, which is what a
    test or a script importing the service gets."""
    ASSETS.max_bytes = settings.asset_cache_mb * 1024 * 1024
    ASSETS.disabled = settings.asset_cache_mb <= 0
    TARGETS.max_bytes = settings.template_cache_mb * 1024 * 1024
    TARGETS.ttl_seconds = settings.template_cache_ttl_seconds
    TARGETS.disabled = (
        settings.template_cache_ttl_seconds <= 0 or settings.template_cache_mb <= 0
    )
    clear_all()


def clear_all() -> None:
    """Empty every cache. Production never needs this — a process talks to one
    database for its whole life. Tests do: they share one process across many
    databases, where template code `invoice` is a different template each time.
    """
    for cache in _REGISTERED:
        cache.clear()
