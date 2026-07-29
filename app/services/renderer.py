"""PDF rendering behind the PdfRenderer interface.

WeasyPrint is CPU-bound and blocking, so rendering runs in a process pool:
the event loop stays responsive, parallelism is capped, and a hung render
can't take the service down with it.

The URL fetcher enforces the resource policy. A template is untrusted input:
without a fetcher it could make the server fetch internal URLs (SSRF) or
local files. Default policy: data: URIs only.
"""

import asyncio
import logging
import time
from concurrent.futures import BrokenExecutor, ProcessPoolExecutor
from typing import Protocol
from urllib.parse import urlsplit

log = logging.getLogger("linform.render")


class RenderError(Exception):
    """Render failed; message is safe to show the client."""


class RenderTimeout(RenderError):
    pass


class RenderBusy(RenderError):
    """Too many renders already in flight — shed load with 429 instead of
    queueing unboundedly. Rendering is deliberately synchronous with a hard
    ceiling; bulk generation is the calling application's job."""


class ConcurrencyLimiter:
    """A non-blocking in-flight counter. The event loop is single-threaded, so
    try_acquire/release never race between awaits — no lock needed. Unlike an
    asyncio.Semaphore, a full limiter refuses immediately rather than waiting,
    which is exactly the backpressure we want to surface as 429."""

    def __init__(self, limit: int):
        self.limit = limit
        self.inflight = 0

    def try_acquire(self) -> bool:
        if self.inflight >= self.limit:
            return False
        self.inflight += 1
        return True

    def release(self) -> None:
        self.inflight -= 1


class PdfRenderer(Protocol):
    async def render_pdf(self, html: str) -> bytes: ...


def _fetch_url(url: str, allow_external: bool, allowed_hosts: list[str]):
    scheme = urlsplit(url).scheme.lower()
    if scheme == "data":
        import weasyprint

        return weasyprint.default_url_fetcher(url)
    if scheme in ("http", "https"):
        host = urlsplit(url).hostname or ""
        if allow_external and (not allowed_hosts or host in allowed_hosts):
            import weasyprint

            return weasyprint.default_url_fetcher(url)
        raise ValueError(
            f"External URL blocked by policy: {url!r}. "
            "Embed resources as data: URIs, or allow the host explicitly."
        )
    # file://, ftp://, anything else — never.
    raise ValueError(f"URL scheme not allowed: {url!r}")


def _render_worker(html: str, allow_external: bool, allowed_hosts: list[str]) -> bytes:
    # Runs in a worker process; import here so the parent process never
    # pays WeasyPrint's import cost (or its native-library requirements).
    import weasyprint

    document = weasyprint.HTML(
        string=html,
        url_fetcher=lambda url: _fetch_url(url, allow_external, allowed_hosts),
    )
    return document.write_pdf()


class WeasyPrintRenderer:
    def __init__(
        self,
        *,
        max_workers: int,
        timeout_seconds: float,
        allow_external_urls: bool,
        allowed_url_hosts: list[str],
        max_concurrency: int = 0,
    ):
        self._pool = ProcessPoolExecutor(max_workers=max_workers)
        self._timeout = timeout_seconds
        self._allow_external = allow_external_urls
        self._allowed_hosts = allowed_url_hosts
        # 0 = derive: a small queue over the pool absorbs bursts without letting
        # the backlog grow without bound.
        limit = max_concurrency if max_concurrency > 0 else max_workers * 2
        self._limiter = ConcurrencyLimiter(limit)
        # Cleared when the process pool breaks; readiness reports it so an
        # orchestrator can replace a pod that can no longer render anything.
        self.healthy = True

    async def render_pdf(self, html: str) -> bytes:
        if not self._limiter.try_acquire():
            raise RenderBusy(
                f"Server is at capacity ({self._limiter.limit} renders in flight). "
                "Retry shortly."
            )
        try:
            return await self._render(html)
        finally:
            self._limiter.release()

    async def _render(self, html: str) -> bytes:
        loop = asyncio.get_running_loop()
        started = time.monotonic()
        try:
            # Submission is inside the try on purpose: when the pool is ALREADY
            # broken, submit() raises BrokenExecutor synchronously — outside the
            # try that would escape as a 500 and never mark the instance
            # unready. A pool that breaks mid-render fails on the await instead.
            future = loop.run_in_executor(
                self._pool, _render_worker, html, self._allow_external, self._allowed_hosts
            )
            pdf = await asyncio.wait_for(future, timeout=self._timeout)
        except asyncio.TimeoutError:
            raise RenderTimeout(f"Render exceeded {self._timeout:.0f}s timeout")
        except BrokenExecutor:
            # A broken pool never recovers on its own — every later render fails
            # the same way. Mark the instance unready rather than keep taking
            # traffic and returning errors.
            self.healthy = False
            log.error("render pool is broken; instance marked unready")
            raise RenderError("Render worker crashed")
        except ValueError as exc:
            # Blocked URL policy violations surface as ValueError from the fetcher.
            raise RenderError(str(exc))
        except Exception as exc:
            # The engine can fail on CSS it does not fully support, and those
            # failures arrive as arbitrary internal exceptions. Letting one
            # through means the caller gets "Internal Server Error" for what is
            # really a template it can fix, and the editor's "Fix with AI" has
            # nothing to work with. Report it as a template problem, keep the
            # detail in the log where it belongs.
            log.exception("render failed on %dB of html", len(html))
            raise RenderError(
                f"The rendering engine could not handle this template "
                f"({type(exc).__name__}: {exc}). This usually means CSS it does "
                f"not support — check recently changed styles."
            )
        # Timed so a slow template is a number in the log rather than a feeling.
        log.info(
            "rendered %dB html -> %dB pdf in %.2fs",
            len(html),
            len(pdf),
            time.monotonic() - started,
        )
        return pdf

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
