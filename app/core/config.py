from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LINFORM_", env_file=".env")

    # What this process is for. One box runs "all" and nothing changes; a split
    # deployment runs editor nodes for people and render nodes for consuming
    # applications, and each carries only the routes its audience needs. A
    # render node has no management API to reach, whatever credential leaks.
    # Typo'd values fail at startup rather than quietly serving everything.
    role: Literal["all", "editor", "render"] = "all"

    # Service auth (empty everywhere = auth disabled, dev mode only).
    # api_token is the legacy single token and counts as both roles.
    api_token: str = ""
    # Render endpoints only — what consuming applications get.
    render_token: str = ""
    # Everything, including template/asset management — the editor side.
    admin_token: str = ""

    # Bootstrap account. Set both to enable user auth: on startup this user is
    # upserted with the superuser role and this password's hash, so the env file
    # stays the single source of truth for the one account that can never be
    # locked out. The superuser then creates editor users and render API keys
    # from the UI. Leave empty (and no static tokens) for open dev mode.
    superuser: str = ""
    superuser_password: str = ""
    # How long a browser login stays valid before re-authentication.
    session_ttl_hours: int = 24 * 7

    # Login throttling. Verifying a password is deliberately expensive
    # (PBKDF2, ~0.3s of CPU), so an unthrottled login endpoint is both a
    # brute-force target and a CPU exhaustion vector that starves PDF rendering.
    # Per account: lock after this many consecutive failures.
    max_login_failures: int = 5
    login_lockout_minutes: int = 15
    # Per client address, per minute — the layer that protects the paths where
    # no account exists to lock (username guessing). 0 disables it.
    login_rate_per_minute: int = 20

    # SQLite file by default so the service runs with zero configuration;
    # docker-compose overrides this with PostgreSQL.
    database_url: str = "sqlite+aiosqlite:///./linform.db"

    # Where the built-in showcase examples live. Empty = the examples/ folder
    # shipped alongside the app; override only for an unusual layout.
    examples_dir: str = ""

    # Observability.
    # JSON logs for a deployment with a log collector; plain text stays the
    # default for local work, where a human reads the terminal.
    json_logs: bool = False
    log_level: str = "INFO"
    # /metrics is off unless asked for: the series are labelled by template
    # code, so scraping reveals which forms a deployment runs. When on, it sits
    # behind the render role like every other endpoint.
    metrics_enabled: bool = False

    # Rendering
    render_timeout_seconds: float = 30.0
    render_max_workers: int = 2
    # Backpressure ceiling: once this many renders are in flight, further
    # requests are shed with 429 instead of queueing without bound. 0 derives
    # it as render_max_workers * 2 (the pool plus a small burst buffer).
    render_max_concurrency: int = 0

    # Strict mode: fail the render when the payload is missing a placeholder,
    # instead of silently rendering an empty value.
    strict_placeholders: bool = True

    # Caching (app/services/cache.py explains what may be cached and why).
    # How long a process may keep serving the version a template code resolved
    # to before re-reading it. The process that publishes or rolls back drops
    # its own entry at once, so this is only the lag seen by OTHER processes —
    # and the container runs one. 0 turns the cache off and every render
    # resolves against the database.
    template_cache_ttl_seconds: float = 2.0
    template_cache_mb: int = 32
    # Assets are content-addressed and never expire; this is purely a memory
    # budget. 0 turns the cache off.
    asset_cache_mb: int = 64

    # AI assistant (BYOK). Empty key = feature off and hidden in the UI.
    # OpenAI-compatible chat completions API — one client covers Gemini's
    # compat endpoint, OpenAI, Anthropic, Mistral, OpenRouter, Ollama, vLLM.
    ai_base_url: str = "https://api.openai.com/v1/"
    ai_api_key: str = ""
    ai_model: str = "gpt-4o-mini"
    # Privacy: test data may contain personal data, so the LLM never sees it
    # unless the installation owner opts in.
    ai_send_test_data: bool = False
    ai_timeout_seconds: float = 60.0

    # URL fetching policy for external resources referenced by templates
    # (images, stylesheets). Off by default: a template is untrusted input,
    # letting it fetch arbitrary URLs from the server is an SSRF vector.
    allow_external_urls: bool = False
    allowed_url_hosts: list[str] = []


@lru_cache
def get_settings() -> Settings:
    return Settings()
