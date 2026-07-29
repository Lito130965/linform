"""Security response headers.

The editor loads arbitrary user-authored HTML into a same-origin iframe (it has
to: the editor reads the iframe's `contentDocument`, which `sandbox` would
forbid). Input is sanitized before it reaches the canvas, and this policy is the
second line: even if something slips through, `script-src 'self'` means it does
not run.
"""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Three directives are widened on purpose, each for a feature that is the
# product rather than an oversight:
#  - style-src 'unsafe-inline': templates carry inline CSS, and a print form IS
#    styling. Inline styles are not comparable to inline scripts, which stay
#    forbidden — that is the directive that actually matters here.
#  - img-src data:: QR codes and barcodes are generated as data URIs.
#  - frame-src blob:: the live preview renders the PDF from a Blob URL
#    (PreviewPane). Without this the preview pane silently goes blank — the
#    canvas iframe itself needs nothing, it has no src and inherits the origin.
CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
    ]
)

HEADERS = {
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "x-frame-options": "DENY",
}


class SecurityHeadersMiddleware:
    """Pure ASGI rather than BaseHTTPMiddleware: the render endpoints stream
    PDF bytes and the assistant streams SSE, and wrapping those in a
    request/response middleware buffers them."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                present = {k.decode("latin-1").lower() for k, _ in headers}
                for name, value in HEADERS.items():
                    if name not in present:
                        headers.append((name.encode("latin-1"), value.encode("latin-1")))
            await send(message)

        await self.app(scope, receive, send_with_headers)
