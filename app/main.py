from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.db import get_session_factory
from app.routers import admin, assets, assistant, auth, examples, render, templates
from app.services import accounts
from app.services.renderer import WeasyPrintRenderer


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.renderer = WeasyPrintRenderer(
        max_workers=settings.render_max_workers,
        timeout_seconds=settings.render_timeout_seconds,
        allow_external_urls=settings.allow_external_urls,
        allowed_url_hosts=settings.allowed_url_hosts,
        max_concurrency=settings.render_max_concurrency,
    )
    # Sync the env-defined superuser into the database (no-op if unset).
    async with get_session_factory()() as session:
        await accounts.ensure_superuser(session, settings)
    yield
    app.state.renderer.shutdown()


app = FastAPI(title="Linform", version="0.1.0", lifespan=lifespan)
app.include_router(render.router)
app.include_router(templates.router)
app.include_router(assets.router)
app.include_router(assistant.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(examples.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# Editor SPA (built by the Dockerfile's node stage). Mounted last so API
# routes take precedence; absent in dev where Vite serves the frontend.
_static_dir = Path(__file__).parent / "static"
if _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="ui")
