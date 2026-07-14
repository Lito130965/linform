from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.routers import render
from app.services.renderer import WeasyPrintRenderer


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.renderer = WeasyPrintRenderer(
        max_workers=settings.render_max_workers,
        timeout_seconds=settings.render_timeout_seconds,
        allow_external_urls=settings.allow_external_urls,
        allowed_url_hosts=settings.allowed_url_hosts,
    )
    yield
    app.state.renderer.shutdown()


app = FastAPI(title="Linform", version="0.1.0", lifespan=lifespan)
app.include_router(render.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
