"""Two-tier service auth.

- render token  — render endpoints only: what consuming applications get.
- admin token   — everything: the editor, analysts, integrations that manage
  templates. A leaked render token must not be able to change templates.
- legacy LINFORM_API_TOKEN keeps working and counts as both.

No tokens configured at all = auth disabled (dev mode), same as before.
If only a render token is configured, admin endpoints reject everything:
exposing render-only is an explicit deployment choice, not a fallback.
"""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


def _provided(credentials: HTTPAuthorizationCredentials | None) -> str | None:
    return credentials.credentials if credentials else None


def _configured(settings: Settings) -> bool:
    return bool(settings.render_token or settings.admin_token or settings.api_token)


def check_render_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    if not _configured(settings):
        return
    allowed = {t for t in (settings.render_token, settings.admin_token, settings.api_token) if t}
    if _provided(credentials) not in allowed:
        raise HTTPException(status_code=401, detail="Invalid or missing token")


def check_admin_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    if not _configured(settings):
        return
    token = _provided(credentials)
    allowed = {t for t in (settings.admin_token, settings.api_token) if t}
    if token in allowed and token is not None:
        return
    if token and token == settings.render_token:
        raise HTTPException(status_code=403, detail="Render token cannot manage templates")
    raise HTTPException(status_code=401, detail="Invalid or missing token")
