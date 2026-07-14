from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LINFORM_", env_file=".env")

    # Service-to-service auth. Empty means auth is disabled (dev mode only).
    api_token: str = ""

    # SQLite file by default so the service runs with zero configuration;
    # docker-compose overrides this with PostgreSQL.
    database_url: str = "sqlite+aiosqlite:///./linform.db"

    # Rendering
    render_timeout_seconds: float = 30.0
    render_max_workers: int = 2

    # Strict mode: fail the render when the payload is missing a placeholder,
    # instead of silently rendering an empty value.
    strict_placeholders: bool = True

    # URL fetching policy for external resources referenced by templates
    # (images, stylesheets). Off by default: a template is untrusted input,
    # letting it fetch arbitrary URLs from the server is an SSRF vector.
    allow_external_urls: bool = False
    allowed_url_hosts: list[str] = []


@lru_cache
def get_settings() -> Settings:
    return Settings()
