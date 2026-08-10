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
    demo_assets,
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


@ops.get("/api/capabilities")
async def capabilities(request: Request) -> dict:
    """What this instance offers, for the interface in front of it.

    The editor has to know which of its parts exist here before it draws them.
    A demo node has no templates to list and nothing to sign in to; a tab that
    opens onto an error is worse than a tab that is not there, and a login
    screen in front of a service with no accounts is worse than either.

    The tabs are named here rather than derived from the role in the browser:
    which routers a role mounts is decided in create_app(), and a second copy of
    that mapping in the frontend would be a second copy to get wrong.
    """
    role = getattr(request.app.state, "role", "all")
    demo = role == "demo"
    return {
        "role": role,
        # A demo is the examples gallery and the editor behind it. Nothing else
        # is reachable, so nothing else is offered.
        "tabs": ["examples"] if demo else ["templates", "examples", "settings"],
        # The editor's own panels, a separate question from the tabs. Assets
        # exist everywhere but the render role — on a demo they are a scratch
        # space of their own, one visitor's and gone within the hour.
        "assets": role in ("all", "editor", "demo"),
        # Whether there is any authentication here at all. Without this the
        # editor asks who it is talking to, gets a 404, and concludes the
        # session expired.
        "accounts": not demo,
    }


@ops.api_route(
    "/api/{rest:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    include_in_schema=False,
)
async def api_not_found(rest: str) -> Response:
    """Anything under /api that no router claimed is a 404 from the API.

    Without this the editor bundle answers instead: the SPA is mounted at "/",
    so an unmatched request falls through to a static file server that knows
    only GET and HEAD, and a consuming application pointed at an editor node
    gets `405 Method Not Allowed` for a render — a reply that describes the file
    server rather than the service. Registered after every router and before the
    mount, so it can only ever catch what nothing else wanted.
    """
    raise HTTPException(status_code=404, detail="Not Found")


def create_app(settings: Settings | None = None, static_dir: Path | None = None) -> FastAPI:
    """Build the application for one deployment role.

    Which routes exist is decided here rather than by a permission check layered
    on top. A render node does not refuse the management API — it does not have
    one, so there is nothing to misconfigure and nothing for a stolen credential
    to reach.
    """
    settings = settings or get_settings()
    app = FastAPI(title="Linform", version="0.2.0", lifespan=lifespan)
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
        app.include_router(admin.router)
    if settings.role in ("all", "editor"):
        app.include_router(auth.router)
    if settings.role == "demo":
        # Same paths as the permanent asset API and a different store behind
        # them: scoped to one visitor and swept within the hour, because a
        # public upload box that keeps things is somebody else's content on
        # your domain. An instance never has both.
        app.include_router(demo_assets.router)
    if settings.role in ("all", "editor", "demo"):
        app.include_router(examples.router)
    app.include_router(ops)

    # Editor SPA (built by the Dockerfile's node stage). Mounted last so API
    # routes take precedence; absent in dev where Vite serves the frontend, and
    # on a render node, which has no management API for it to call.
    #
    # The path is a parameter so a test can mount one: locally app/static does
    # not exist, so without it every test runs against a shape the container
    # never has — which is exactly how the 405 above reached CI.
    static_dir = static_dir or Path(__file__).parent / "static"
    if settings.role in ("all", "editor", "demo") and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    return app


app = create_app()
