"""Account management — superuser only. Create the editor users who design
templates and mint the render API keys consuming applications authenticate with.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Principal, require_superuser
from app.core.db import get_session
from app.models.schemas import (
    ActiveUpdate,
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyOut,
    PasswordUpdate,
    UserCreate,
    UserOut,
)
from app.services import accounts
from app.services.accounts import AccountError

router = APIRouter(
    prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_superuser)]
)


# --- users -----------------------------------------------------------------

@router.get("/users", response_model=list[UserOut])
async def list_users(
    response: Response,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    rows, total = await accounts.list_users(session, limit=limit, offset=offset)
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, session: AsyncSession = Depends(get_session)):
    try:
        return await accounts.create_user(session, body.username, body.password, body.role)
    except AccountError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.put("/users/{user_id}/password", status_code=204)
async def set_password(
    user_id: int, body: PasswordUpdate, session: AsyncSession = Depends(get_session)
):
    user = await accounts.get_user(session, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such user")
    try:
        await accounts.set_password(session, user, body.password)
    except AccountError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.put("/users/{user_id}/active", response_model=UserOut)
async def set_active(
    user_id: int, body: ActiveUpdate, session: AsyncSession = Depends(get_session)
):
    user = await accounts.get_user(session, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such user")
    await accounts.set_active(session, user, body.is_active)
    return user


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    principal: Principal = Depends(require_superuser),
):
    user = await accounts.get_user(session, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such user")
    if user.username == principal.name:
        raise HTTPException(status_code=409, detail="You cannot delete your own account")
    try:
        await accounts.delete_user(session, user)
    except AccountError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# --- render API keys -------------------------------------------------------

@router.get("/keys", response_model=list[ApiKeyOut])
async def list_keys(
    response: Response,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    rows, total = await accounts.list_api_keys(session, limit=limit, offset=offset)
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.post("/keys", response_model=ApiKeyCreated, status_code=201)
async def create_key(
    body: ApiKeyCreate,
    session: AsyncSession = Depends(get_session),
    principal: Principal = Depends(require_superuser),
):
    try:
        clear, row = await accounts.create_api_key(session, body.name, principal.name)
    except AccountError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return ApiKeyCreated(
        id=row.id,
        name=row.name,
        prefix=row.prefix,
        created_by=row.created_by,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
        key=clear,
    )


@router.delete("/keys/{key_id}", status_code=204)
async def delete_key(key_id: int, session: AsyncSession = Depends(get_session)):
    if not await accounts.delete_api_key(session, key_id):
        raise HTTPException(status_code=404, detail="No such key")
