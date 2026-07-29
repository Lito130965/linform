"""Structured logging with a request id that follows the request.

The question this exists to answer is "why were forms slow at 14:00 yesterday",
and answering it needs three things: one line per request carrying its own
timing, a correlation id that ties that line to everything logged while serving
it, and machine-readable output so a log tool can aggregate rather than a human
grepping.

What is deliberately NOT logged: the request body. Payloads are the consuming
application's business data — the service renders them and forgets them, which
is a promise made in the README. A log file is the easiest place to break that
promise by accident, so no code path here ever touches the body.
"""

import json
import logging
import time
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# The id of the request being served on this task. A contextvar rather than a
# thread local: the service is async, and many requests share a thread.
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

REQUEST_ID_HEADER = "x-request-id"

# Fields the stdlib puts on every record. Anything outside this set was added by
# the caller (`log.info(..., extra={...})`) and belongs in the JSON output.
_STANDARD_FIELDS = frozenset(
    logging.LogRecord("", 0, "", 0, "", (), None).__dict__
) | {"message", "asctime", "taskName"}


def get_request_id() -> str | None:
    return _request_id.get()


def set_request_id(value: str | None) -> None:
    _request_id.set(value)


class RequestIdFilter(logging.Filter):
    """Attach the current request id to every record, including records from
    libraries that know nothing about it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Extras passed by the caller are merged in, so
    a call site can add `duration_ms` or `template_code` without a schema
    change here."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key not in _STANDARD_FIELDS and key != "request_id":
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        # default=str so an unexpected object degrades to its repr instead of
        # throwing inside the logger and losing the line entirely.
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(json_logs: bool, level: str = "INFO") -> None:
    """Install the formatter and the request-id filter on the root handler.

    Plain text stays the default for local work, where a human is reading the
    terminal; JSON is for a deployment with a log collector in front of it.
    """
    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    handler.setFormatter(
        JsonFormatter()
        if json_logs
        else logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    )
    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level.upper())
    # uvicorn installs its own handlers; let its records flow to ours instead so
    # every line in the output has the same shape.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    # uvicorn.access duplicates what RequestLogMiddleware records, without the
    # request id or the principal.
    logging.getLogger("uvicorn.access").disabled = True


class RequestLogMiddleware:
    """Assign a request id, time the request, log one line when it finishes.

    Pure ASGI rather than BaseHTTPMiddleware: the render endpoints stream PDF
    bytes and the assistant streams SSE, and a request/response middleware
    buffers those.
    """

    def __init__(self, app: ASGIApp):
        self.app = app
        self.log = logging.getLogger("linform.request")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = _header(scope, REQUEST_ID_HEADER)
        # Honour an id from a caller or a proxy so one trace spans both sides,
        # but bound its length — it is echoed back into a response header.
        request_id = (incoming or uuid.uuid4().hex)[:64]
        _request_id.set(request_id)
        scope["request_id"] = request_id

        started = time.perf_counter()
        status_holder: dict[str, int] = {}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = message.setdefault("headers", [])
                headers.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            self.log.info(
                "%s %s", scope.get("method", "?"), scope.get("path", "?"),
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status_holder.get("status"),
                    "duration_ms": duration_ms,
                    # Who, by name — never the credential they presented.
                    "principal": scope.get("principal_name"),
                },
            )


def _header(scope: Scope, name: str) -> str | None:
    wanted = name.encode()
    for key, value in scope.get("headers", []):
        if key.lower() == wanted:
            return value.decode("latin-1")
    return None
