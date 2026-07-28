"""Request authorization: resolve a Bearer credential to a principal, then gate
endpoints by capability.

Three principal kinds converge here:
  - login session  — a human signed into the editor (superuser or editor role);
  - API key        — a consuming application, always render-scoped;
  - static token   — the env-configured render/admin tokens, kept for backward
                     compatibility. admin/legacy count as superuser, render as
                     render.

Capabilities form a ladder — superuser ⊃ editor ⊃ render:
  - require_render     renders and previews (everyone);
  - require_editor     manages templates, assets, the assistant (editor, super);
  - require_superuser  manages users and API keys (superuser only).

Auth is OFF when nothing is configured — no superuser and no static tokens.
That keeps `git clone && run` open for local dev, exactly as before. The moment
a superuser or any token is set, every endpoint demands a matching credential.
"""

from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.database import Role
from app.services import accounts

_bearer = HTTPBearer(auto_error=False)

# Role → rank; a guard passes when the principal's rank meets its floor.
_RANK = {"render": 0, "editor": 1, "superuser": 2}


@dataclass(frozen=True)
class Principal:
    kind: Literal["user", "apikey", "static", "dev"]
    role: Literal["render", "editor", "superuser"]
    name: str

    def can(self, floor: str) -> bool:
        return _RANK[self.role] >= _RANK[floor]


def _auth_enabled(settings: Settings) -> bool:
    return bool(
        settings.superuser
        or settings.render_token
        or settings.admin_token
        or settings.api_token
    )


def _static_principal(token: str, settings: Settings) -> Principal | None:
    if token and token in {settings.admin_token, settings.api_token}:
        return Principal(kind="static", role="superuser", name="admin-token")
    if token and token == settings.render_token:
        return Principal(kind="static", role="render", name="render-token")
    return None


async def get_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
) -> Principal | None:
    """Resolve the caller, or None when auth is enabled and nothing matches.
    Returns a synthetic superuser in dev mode (auth disabled)."""
    if not _auth_enabled(settings):
        return Principal(kind="dev", role="superuser", name="dev")
    token = credentials.credentials if credentials else None
    if not token:
        return None
    # Static tokens first: a pure DB-free deployment never touches the session.
    static = _static_principal(token, settings)
    if static is not None:
        return static
    user = await accounts.resolve_session(session, token)
    if user is not None:
        return Principal(kind="user", role=user.role.value, name=user.username)
    key = await accounts.resolve_api_key(session, token)
    if key is not None:
        return Principal(kind="apikey", role="render", name=key.name)
    return None


def _require(floor: str):
    async def guard(principal: Principal | None = Depends(get_principal)) -> Principal:
        if principal is None:
            raise HTTPException(status_code=401, detail="Invalid or missing token")
        if not principal.can(floor):
            raise HTTPException(
                status_code=403,
                detail=f"This action requires {floor} rights",
            )
        return principal

    return guard


require_render = _require("render")
require_editor = _require("editor")
require_superuser = _require("superuser")
