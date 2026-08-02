import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.core import metrics
from app.core.auth import require_render
from app.core.config import Settings, get_settings
from app.core.db import get_session_factory
from app.core.headers import SecurityHeadersMiddleware
from app.core.logging import RequestLogMiddleware, configure_logging
from app.routers import (
    admin,
    assets,
    assistant,
    auth,
    directories,
    examples,
    render,
    templates,
)
from app.services import accounts, cache
from app.services.renderer import WeasyPrintRenderer

log = logging.getLogger("linform.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(json_logs=settings.json_logs, level=settings.log_level)
    cache.configure(settings)
    app.state.renderer = WeasyPrintRenderer(
        max_workers=settings.render_max_workers,
        timeout_seconds=settings.render_timeout_seconds,
        allow_external_urls=settings.allow_external_urls,
        allowed_url_hosts=settings.allowed_url_hosts,
        max_concurrency=settings.render_max_concurrency,
    )
    # Read at scrape time rather than tracked on every render: the limiter
    # already holds the number, and a callback cannot drift from it. getattr
    # with a default because this callback runs inside the scrape — raising
    # here would fail the whole /metrics response, losing every other series
    # to report one missing number.
    metrics.render_inflight.set_function(
        lambda: getattr(getattr(app.state, "renderer", None), "inflight", 0)
    )
    metrics.render_concurrency_limit.set_function(
        lambda: getattr(getattr(app.state, "renderer", None), "concurrency_limit", 0)
    )
    # Sync the env-defined superuser into the database (no-op if unset). A
    # render node has no login to bootstrap and no admin API to reach it with.
    if getattr(app.state, "role", "all") != "render":
        async with get_session_factory()() as session:
            await accounts.ensure_superuser(session, settings)
    log.info("serving role %r", getattr(app.state, "role", "all"))
    yield
    app.state.renderer.shutdown()


# Operational endpoints: every node has them, whatever it is for. An
# orchestrator should not have to know a container's role to probe it.
ops = APIRouter()


@ops.get("/health")
async def health() -> dict:
    """Liveness: is this process running? Deliberately checks NOTHING external —
    a health probe that fails when the database blips would have the
    orchestrator restart perfectly good containers, which turns a brief
    dependency outage into a restart storm. Readiness is /ready."""
    return {"status": "ok"}


@ops.get("/ready")
async def ready(response: Response, request: Request) -> dict:
    """Readiness: can this instance actually serve a request right now? Checks
    the database and the render pool, and answers 503 when either is gone so a
    load balancer stops sending it traffic (without restarting it)."""
    checks: dict[str, str] = {}

    try:
        async with get_session_factory()() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        log.warning("readiness: database check failed: %s", exc)
        checks["database"] = "unavailable"

    renderer = getattr(request.app.state, "renderer", None)
    # A broken process pool never recovers, so this stays failed until restart.
    checks["renderer"] = "ok" if renderer is not None and getattr(renderer, "healthy", True) else "broken"

    ok = all(v == "ok" for v in checks.values())
    if not ok:
        response.status_code = 503
    return {"status": "ready" if ok else "not ready", "checks": checks}


@ops.get("/metrics")
async def prometheus_metrics(
    settings=Depends(get_settings), _=Depends(require_render)
) -> Response:
    """Prometheus exposition.

    Behind the render role and off unless enabled: the series are labelled by
    template code, so an open /metrics tells anyone who asks which forms this
    deployment runs. 404 rather than 403 when disabled — an endpoint that is
    not turned on should not advertise that it exists.
    """
    if not settings.metrics_enabled:
        raise HTTPException(status_code=404, detail="Not Found")
    payload, content_type = metrics.render_output()
    return Response(content=payload, media_type=content_type)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application for one deployment role.

    Which routes exist is decided here rather than by a permission check layered
    on top. A render node does not refuse the management API — it does not have
    one, so there is nothing to misconfigure and nothing for a stolen credential
    to reach.
    """
    settings = settings or get_settings()
    app = FastAPI(title="Linform", version="0.1.0", lifespan=lifespan)
    app.state.role = settings.role
    # Order matters: the request-id middleware is added last so it runs FIRST,
    # and every log line produced while serving — including one written by the
    # security middleware — carries the id.
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLogMiddleware)

    # Rendering markup the caller is already holding: the editor's live preview,
    # and a perfectly reasonable way to use the service without storing anything.
    app.include_router(render.router)
    if settings.role in ("all", "render"):
        # The integration surface: a stable code, a payload, a PDF.
        app.include_router(render.stored_router)
    if settings.role in ("all", "editor"):
        app.include_router(templates.router)
        app.include_router(directories.router)
        app.include_router(assets.router)
        app.include_router(assistant.router)
        app.include_router(auth.router)
        app.include_router(admin.router)
        app.include_router(examples.router)
    app.include_router(ops)

    # Editor SPA (built by the Dockerfile's node stage). Mounted last so API
    # routes take precedence; absent in dev where Vite serves the frontend, and
    # on a render node, which has no management API for it to call.
    static_dir = Path(__file__).parent / "static"
    if settings.role in ("all", "editor") and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    return app


app = create_app()
