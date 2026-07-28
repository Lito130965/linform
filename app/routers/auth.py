"""Session auth for the editor UI: password login in, opaque token out.

Consuming applications do not use these endpoints — they send a render API key
(or the static render token) straight to /api/render. This is only the human
sign-in that the SPA drives.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Principal, _auth_enabled, get_principal
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.models.schemas import LoginRequest, MeResponse
from app.services import accounts

router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


@router.post("/login")
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    user = await accounts.authenticate(session, body.username, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = await accounts.open_session(session, user, settings.session_ttl_hours)
    return {"token": token, "username": user.username, "role": user.role.value}


@router.post("/logout", status_code=204)
async def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> None:
    if credentials:
        await accounts.close_session(session, credentials.credentials)


@router.get("/me", response_model=MeResponse)
async def me(
    principal: Principal | None = Depends(get_principal),
    settings: Settings = Depends(get_settings),
) -> MeResponse:
    """The UI calls this on load to decide what to show: a login screen, the
    full editor, or (dev mode) everything open."""
    enabled = _auth_enabled(settings)
    if principal is None:
        return MeResponse(authenticated=False, auth_enabled=enabled)
    return MeResponse(
        authenticated=True,
        auth_enabled=enabled,
        username=principal.name,
        role=principal.role,
    )
