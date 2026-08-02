"""Accounts: users, render API keys and login sessions.

The store behind the auth layer. Everything that touches a password or a token
goes through app.core.security, so this module only ever handles digests and
already-hashed values — except at the two moments a secret is born (login,
key creation), where the clear value is returned to the caller exactly once.
"""

from datetime import datetime, timedelta, timezone
from typing import NamedTuple

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import (
    generate_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.database import ApiKey, LoginSession, Role, User


class AccountError(Exception):
    """A management operation the caller can fix (duplicate name, last admin)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- superuser bootstrap ---------------------------------------------------

async def ensure_superuser(session: AsyncSession, settings: Settings) -> None:
    """Idempotently sync the env-defined superuser into the users table. The
    env file is authoritative: the password hash is refreshed on every boot, so
    changing LINFORM_SUPERUSER_PASSWORD and restarting rotates it, and the one
    account that governs all the others can never be deleted into lockout."""
    if not settings.superuser or not settings.superuser_password:
        return
    row = (
        await session.execute(select(User).where(User.username == settings.superuser))
    ).scalar_one_or_none()
    pw_hash = hash_password(settings.superuser_password)
    if row is None:
        session.add(
            User(
                username=settings.superuser,
                password_hash=pw_hash,
                role=Role.superuser,
                is_active=True,
            )
        )
    else:
        row.password_hash = pw_hash
        row.role = Role.superuser
        row.is_active = True
    await session.commit()


# --- users -----------------------------------------------------------------

async def list_users(
    session: AsyncSession, *, limit: int | None = None, offset: int = 0
) -> tuple[list[User], int]:
    total = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    query = select(User).order_by(User.username).offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return list((await session.execute(query)).scalars()), total


async def get_user(session: AsyncSession, user_id: int) -> User | None:
    return await session.get(User, user_id)


async def create_user(
    session: AsyncSession, username: str, password: str, role: Role
) -> User:
    username = username.strip()
    if not username:
        raise AccountError("Username must not be empty")
    if len(password) < 8:
        raise AccountError("Password must be at least 8 characters")
    user = User(username=username, password_hash=hash_password(password), role=role)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise AccountError(f"A user named {username!r} already exists")
    await session.refresh(user)
    return user


async def set_password(session: AsyncSession, user: User, password: str) -> None:
    if len(password) < 8:
        raise AccountError("Password must be at least 8 characters")
    user.password_hash = hash_password(password)
    # A password change closes every open session for that user.
    await session.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    await session.commit()


async def set_active(session: AsyncSession, user: User, active: bool) -> None:
    user.is_active = active
    if not active:
        await session.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    await session.commit()


async def delete_user(session: AsyncSession, user: User) -> None:
    """Remove a user. Refuses to delete the last superuser so the deployment
    can never be left with no one who can manage it."""
    if user.role == Role.superuser:
        remaining = (
            await session.execute(
                select(User).where(User.role == Role.superuser, User.id != user.id)
            )
        ).first()
        if remaining is None:
            raise AccountError("Refusing to delete the last superuser")
    await session.delete(user)
    await session.commit()


# --- login sessions --------------------------------------------------------

class AuthResult(NamedTuple):
    """Outcome of a login attempt. `retry_after` is set only when the account is
    locked; the caller still answers a uniform 401 so the response never reveals
    which of "no such user" / "wrong password" / "locked" happened."""

    user: User | None
    retry_after: int | None = None


async def authenticate(
    session: AsyncSession, username: str, password: str, settings: Settings | None = None
) -> AuthResult:
    settings = settings or Settings()
    user = (
        await session.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        # Still spend the hash work so a missing user and a wrong password take
        # the same time — no username oracle from response latency. This is also
        # why a per-address rate limit guards the endpoint: this branch has no
        # account to lock, so it is the cheap way to burn server CPU.
        verify_password(password, hash_password("dummy"))
        return AuthResult(None)

    locked_for = _lock_remaining(user)
    if locked_for is not None:
        # Refuse BEFORE verifying: computing PBKDF2 for an account already known
        # to be locked is exactly the CPU exhaustion this throttle exists to
        # prevent — the render workers compete for the same cores.
        return AuthResult(None, retry_after=locked_for)

    if not verify_password(password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= settings.max_login_failures:
            user.locked_until = _now() + timedelta(minutes=settings.login_lockout_minutes)
        await session.commit()
        return AuthResult(None)

    if user.failed_logins or user.locked_until:
        user.failed_logins = 0
        user.locked_until = None
        await session.commit()
    return AuthResult(user)


def _lock_remaining(user: User) -> int | None:
    """Seconds left on an active lock, or None when the account is not locked.
    An expired lock is treated as unlocked (the counter is reset on next
    success), so no sweeper job is needed."""
    if user.locked_until is None:
        return None
    until = user.locked_until
    if until.tzinfo is None:  # SQLite hands back naive datetimes.
        until = until.replace(tzinfo=timezone.utc)
    remaining = (until - _now()).total_seconds()
    return int(remaining) + 1 if remaining > 0 else None


async def open_session(
    session: AsyncSession, user: User, ttl_hours: int
) -> str:
    """Create a login session and return its clear token (shown to the browser
    once, then only its digest lives in the database)."""
    token = generate_token()
    session.add(
        LoginSession(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=_now() + timedelta(hours=ttl_hours),
        )
    )
    await session.commit()
    return token


async def resolve_session(session: AsyncSession, token: str) -> User | None:
    row = (
        await session.execute(
            select(LoginSession).where(LoginSession.token_hash == hash_token(token))
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:  # SQLite hands back naive datetimes.
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < _now():
        await session.delete(row)
        await session.commit()
        return None
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    return user


async def close_session(session: AsyncSession, token: str) -> None:
    await session.execute(
        delete(LoginSession).where(LoginSession.token_hash == hash_token(token))
    )
    await session.commit()


# --- API keys (render) -----------------------------------------------------

async def list_api_keys(
    session: AsyncSession, *, limit: int | None = None, offset: int = 0
) -> tuple[list[ApiKey], int]:
    total = (await session.execute(select(func.count()).select_from(ApiKey))).scalar_one()
    query = select(ApiKey).order_by(ApiKey.created_at).offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return list((await session.execute(query)).scalars()), total


async def create_api_key(
    session: AsyncSession, name: str, created_by: str
) -> tuple[str, ApiKey]:
    """Mint a render key. Returns (clear_key, row); the clear key is the only
    time the secret is visible."""
    name = name.strip()
    if not name:
        raise AccountError("Key name must not be empty")
    token = generate_token()
    row = ApiKey(
        name=name,
        prefix=token[:8],
        key_hash=hash_token(token),
        created_by=created_by,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return token, row


async def delete_api_key(session: AsyncSession, key_id: int) -> bool:
    row = await session.get(ApiKey, key_id)
    if row is None:
        return False
    await session.delete(row)
    await session.commit()
    return True


async def resolve_api_key(session: AsyncSession, token: str) -> ApiKey | None:
    row = (
        await session.execute(
            select(ApiKey).where(ApiKey.key_hash == hash_token(token))
        )
    ).scalar_one_or_none()
    if row is not None:
        # Best-effort last-seen; never block a render on the bookkeeping.
        await session.execute(
            update(ApiKey).where(ApiKey.id == row.id).values(last_used_at=_now())
        )
        await session.commit()
    return row
