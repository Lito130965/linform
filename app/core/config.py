from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LINFORM_", env_file=".env")

    # Service auth (empty everywhere = auth disabled, dev mode only).
    # api_token is the legacy single token and counts as both roles.
    api_token: str = ""
    # Render endpoints only — what consuming applications get.
    render_token: str = ""
    # Everything, including template/asset management — the editor side.
    admin_token: str = ""

    # SQLite file by default so the service runs with zero configuration;
    # docker-compose overrides this with PostgreSQL.
    database_url: str = "sqlite+aiosqlite:///./linform.db"

    # Rendering
    render_timeout_seconds: float = 30.0
    render_max_workers: int = 2

    # Strict mode: fail the render when the payload is missing a placeholder,
    # instead of silently rendering an empty value.
    strict_placeholders: bool = True

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
