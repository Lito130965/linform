"""Login throttling: an unthrottled login endpoint is both a brute-force target
and a CPU-exhaustion vector, because verifying a password is deliberately
expensive (PBKDF2) and the render workers compete for the same cores."""

import asyncio

import pytest

from app.core.config import Settings, get_settings
from app.core.ratelimit import SlidingWindowLimiter
from app.main import app
from app.routers import auth as auth_router
from app.services import accounts

SUPER = "root"
SUPER_PW = "supersecret1"


@pytest.fixture()
def auth_client(db_client):
    settings = Settings(
        superuser=SUPER,
        superuser_password=SUPER_PW,
        database_url="sqlite+aiosqlite://",
        # A high address limit so the per-account lockout is what these tests
        # exercise; the address limiter has its own test below.
        login_rate_per_minute=1000,
    )
    app.dependency_overrides[get_settings] = lambda: settings

    async def seed():
        async with db_client.db_factory() as session:
            await accounts.ensure_superuser(session, settings)

    asyncio.run(seed())
    auth_router._login_limiter = None  # fresh window per test
    yield db_client
    app.dependency_overrides.pop(get_settings, None)
    auth_router._login_limiter = None


def _login(client, password: str, username: str = SUPER):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def test_account_locks_after_five_failures_even_with_the_right_password(auth_client):
    for _ in range(5):
        assert _login(auth_client, "wrong").status_code == 401
    # The 6th attempt is refused even though the password is correct.
    resp = _login(auth_client, SUPER_PW)
    assert resp.status_code == 401
    assert int(resp.headers["Retry-After"]) > 0


def test_locked_account_does_not_spend_the_password_hash(auth_client, monkeypatch):
    """The point of the lock is to stop burning CPU, so a locked account must be
    refused BEFORE PBKDF2 runs. Without this, a lockout is a brute-force
    mitigation but not a DoS mitigation."""
    for _ in range(5):
        _login(auth_client, "wrong")

    calls = []
    real = accounts.verify_password
    monkeypatch.setattr(accounts, "verify_password", lambda *a: calls.append(1) or real(*a))

    assert _login(auth_client, SUPER_PW).status_code == 401
    assert calls == [], "verify_password was called for a locked account"


def test_a_success_before_the_limit_clears_the_counter(auth_client):
    for _ in range(4):
        assert _login(auth_client, "wrong").status_code == 401
    assert _login(auth_client, SUPER_PW).status_code == 200
    # Counter reset: four more failures still do not lock.
    for _ in range(4):
        assert _login(auth_client, "wrong").status_code == 401
    assert _login(auth_client, SUPER_PW).status_code == 200


def test_failure_responses_do_not_reveal_which_account_exists(auth_client):
    missing = _login(auth_client, "whatever", username="ghost")
    wrong = _login(auth_client, "wrong")
    assert missing.status_code == wrong.status_code == 401
    assert missing.json()["detail"] == wrong.json()["detail"]
    # And the locked case reuses the same message (only Retry-After differs).
    for _ in range(5):
        _login(auth_client, "wrong")
    locked = _login(auth_client, SUPER_PW)
    assert locked.json()["detail"] == wrong.json()["detail"]


def test_address_rate_limit_sheds_attempts_for_unknown_usernames(db_client):
    """The path that never touches an account — username guessing — is exactly
    where the per-account lockout cannot help, so the address limit must."""
    settings = Settings(
        superuser=SUPER, superuser_password=SUPER_PW,
        database_url="sqlite+aiosqlite://", login_rate_per_minute=3,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    auth_router._login_limiter = None
    try:
        codes = [
            db_client.post(
                "/api/auth/login", json={"username": f"ghost{i}", "password": "x"}
            ).status_code
            for i in range(5)
        ]
        assert codes[:3] == [401, 401, 401]
        assert codes[3:] == [429, 429]
    finally:
        app.dependency_overrides.pop(get_settings, None)
        auth_router._login_limiter = None


# --- the limiter itself ----------------------------------------------------

def test_limiter_allows_up_to_the_limit_then_reports_a_wait():
    lim = SlidingWindowLimiter(2, window_seconds=60)
    assert lim.check("a") is None
    assert lim.check("a") is None
    wait = lim.check("a")
    assert wait is not None and 0 < wait <= 61
    # Keys are independent.
    assert lim.check("b") is None


def test_limiter_window_slides(monkeypatch):
    import app.core.ratelimit as rl

    now = [1000.0]
    monkeypatch.setattr(rl.time, "monotonic", lambda: now[0])
    lim = rl.SlidingWindowLimiter(1, window_seconds=10)
    assert lim.check("a") is None
    assert lim.check("a") is not None  # blocked inside the window
    now[0] += 11
    assert lim.check("a") is None  # the old hit aged out


def test_limiter_disabled_when_limit_is_zero():
    lim = SlidingWindowLimiter(0)
    for _ in range(100):
        assert lim.check("a") is None
