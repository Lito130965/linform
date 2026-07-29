"""Session auth for the editor UI: password login in, opaque token out.

Consuming applications do not use these endpoints — they send a render API key
(or the static render token) straight to /api/render. This is only the human
sign-in that the SPA drives.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import metrics
from app.core.auth import Principal, _auth_enabled, get_principal
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.ratelimit import SlidingWindowLimiter
from app.models.schemas import LoginRequest, MeResponse
from app.services import accounts

router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

# Built on first use so the configured rate applies (settings are read at
# request time, not import time).
_login_limiter: SlidingWindowLimiter | None = None


def _limiter(settings: Settings) -> SlidingWindowLimiter:
    global _login_limiter
    if _login_limiter is None or _login_limiter.limit != settings.login_rate_per_minute:
        _login_limiter = SlidingWindowLimiter(settings.login_rate_per_minute)
    return _login_limiter


# One message for every failure mode. Which of "no such user" / "wrong
# password" / "locked" happened is not the caller's business — telling them
# turns the endpoint into an account enumerator.
_DENIED = "Invalid username or password"


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    # Address limit first: it is the only guard on the path where no account
    # exists, which would otherwise still cost a full PBKDF2 verification.
    client = request.client.host if request.client else "unknown"
    wait = _limiter(settings).check(client)
    if wait is not None:
        metrics.login_failed_total.labels(reason="rate_limited").inc()
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again shortly.",
            headers={"Retry-After": str(wait)},
        )

    result = await accounts.authenticate(session, body.username, body.password, settings)
    if result.user is None:
        # The reason is a metric label, never part of the response: the caller
        # still gets one indistinguishable 401.
        metrics.login_failed_total.labels(
            reason="locked" if result.retry_after else "bad_credentials"
        ).inc()
        headers = {"Retry-After": str(result.retry_after)} if result.retry_after else None
        raise HTTPException(status_code=401, detail=_DENIED, headers=headers)
    token = await accounts.open_session(session, result.user, settings.session_ttl_hours)
    return {"token": token, "username": result.user.username, "role": result.user.role.value}


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
