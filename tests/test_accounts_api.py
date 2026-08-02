"""Users, render API keys and the role ladder end to end: a superuser signs in,
creates an editor and a render key, and each credential can reach exactly what
its role allows and no more."""

import asyncio

import pytest

from app.core.config import Settings, get_settings
from app.main import app
from app.services import accounts

SUPER = "root"
SUPER_PW = "supersecret1"


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def auth_client(db_client):
    """A client whose deployment has a bootstrapped superuser (auth enabled)."""
    settings = Settings(
        superuser=SUPER,
        superuser_password=SUPER_PW,
        database_url="sqlite+aiosqlite://",
    )
    app.dependency_overrides[get_settings] = lambda: settings

    async def seed():
        async with db_client.db_factory() as session:
            await accounts.ensure_superuser(session, settings)

    _run(seed())
    yield db_client
    app.dependency_overrides.pop(get_settings, None)


def _auth(token: str | None) -> dict:
    return {"Authorization": f"Bearer {token}"} if token else {}


def _login(client, username: str, password: str):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    return resp


RENDER_BODY = {"html": "<p>{{ x }}</p>", "data": {"x": 1}, "strict": False}


# --- login & identity ------------------------------------------------------

def test_superuser_can_log_in_and_me_reports_role(auth_client):
    resp = _login(auth_client, SUPER, SUPER_PW)
    assert resp.status_code == 200
    token = resp.json()["token"]
    assert resp.json()["role"] == "superuser"

    me = auth_client.get("/api/auth/me", headers=_auth(token)).json()
    assert me == {
        "authenticated": True,
        "auth_enabled": True,
        "username": SUPER,
        "role": "superuser",
    }


def test_wrong_password_is_rejected(auth_client):
    assert _login(auth_client, SUPER, "nope").status_code == 401
    assert _login(auth_client, "ghost", SUPER_PW).status_code == 401


def test_me_without_a_token_reports_unauthenticated_but_auth_enabled(auth_client):
    me = auth_client.get("/api/auth/me").json()
    assert me["authenticated"] is False
    assert me["auth_enabled"] is True


def test_me_in_dev_mode_reports_auth_disabled(db_client):
    me = db_client.get("/api/auth/me").json()
    assert me["auth_enabled"] is False
    # Dev mode resolves to an open superuser so the whole UI works with no login.
    assert me["authenticated"] is True
    assert me["role"] == "superuser"


def test_logout_revokes_the_session(auth_client):
    token = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    assert auth_client.get("/api/admin/users", headers=_auth(token)).status_code == 200
    assert auth_client.post("/api/auth/logout", headers=_auth(token)).status_code == 204
    assert auth_client.get("/api/admin/users", headers=_auth(token)).status_code == 401


# --- user management (superuser only) --------------------------------------

def test_superuser_creates_an_editor_who_can_manage_but_not_administer(auth_client):
    su = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    created = auth_client.post(
        "/api/admin/users",
        headers=_auth(su),
        json={"username": "anna", "password": "editorpass1", "role": "editor"},
    )
    assert created.status_code == 201
    assert created.json()["role"] == "editor"

    ed = _login(auth_client, "anna", "editorpass1").json()["token"]
    # Editor manages templates...
    assert auth_client.get("/api/templates", headers=_auth(ed)).status_code == 200
    # ...but cannot administer accounts.
    assert auth_client.get("/api/admin/users", headers=_auth(ed)).status_code == 403
    assert (
        auth_client.post(
            "/api/admin/users",
            headers=_auth(ed),
            json={"username": "x", "password": "password12", "role": "editor"},
        ).status_code
        == 403
    )


def test_saved_version_records_the_signed_in_author(auth_client):
    su = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    auth_client.post(
        "/api/admin/users",
        headers=_auth(su),
        json={"username": "anna", "password": "editorpass1", "role": "editor"},
    )
    ed = _login(auth_client, "anna", "editorpass1").json()["token"]
    auth_client.post("/api/templates", headers=_auth(ed), json={"code": "inv", "name": "Inv"})
    draft = auth_client.post(
        "/api/templates/inv/drafts",
        headers=_auth(ed),
        json={"html_content": "<p>{{ n }}</p>", "comment": "first"},
    ).json()
    assert draft["created_by"] == "anna"
    # And it survives publication onto the version that ships.
    auth_client.post(f"/api/templates/inv/drafts/{draft['id']}/publish", headers=_auth(ed))
    detail = auth_client.get("/api/templates/inv", headers=_auth(ed)).json()
    assert detail["versions"][0]["created_by"] == "anna"


def test_duplicate_username_conflicts(auth_client):
    su = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    body = {"username": "anna", "password": "editorpass1", "role": "editor"}
    assert auth_client.post("/api/admin/users", headers=_auth(su), json=body).status_code == 201
    assert auth_client.post("/api/admin/users", headers=_auth(su), json=body).status_code == 409


def test_short_password_is_refused_by_validation(auth_client):
    su = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    resp = auth_client.post(
        "/api/admin/users",
        headers=_auth(su),
        json={"username": "z", "password": "short", "role": "editor"},
    )
    assert resp.status_code == 422


def test_deactivating_a_user_blocks_further_login(auth_client):
    su = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    uid = auth_client.post(
        "/api/admin/users",
        headers=_auth(su),
        json={"username": "anna", "password": "editorpass1", "role": "editor"},
    ).json()["id"]
    auth_client.put(f"/api/admin/users/{uid}/active", headers=_auth(su), json={"is_active": False})
    assert _login(auth_client, "anna", "editorpass1").status_code == 401


def test_superuser_cannot_delete_own_account(auth_client):
    su_resp = _login(auth_client, SUPER, SUPER_PW).json()
    su = su_resp["token"]
    uid = next(
        u["id"]
        for u in auth_client.get("/api/admin/users", headers=_auth(su)).json()
        if u["username"] == SUPER
    )
    assert auth_client.delete(f"/api/admin/users/{uid}", headers=_auth(su)).status_code == 409


# --- render API keys -------------------------------------------------------

def test_render_key_renders_but_cannot_manage(auth_client):
    su = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    made = auth_client.post("/api/admin/keys", headers=_auth(su), json={"name": "billing-app"})
    assert made.status_code == 201
    key = made.json()["key"]
    assert made.json()["prefix"] == key[:8]

    # The key renders...
    assert auth_client.post("/api/render", headers=_auth(key), json=RENDER_BODY).status_code == 200
    # ...but is render-scoped: no template or account management.
    assert auth_client.get("/api/templates", headers=_auth(key)).status_code == 403
    assert auth_client.get("/api/admin/keys", headers=_auth(key)).status_code == 403


def test_deleting_a_key_revokes_it(auth_client):
    su = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    made = auth_client.post("/api/admin/keys", headers=_auth(su), json={"name": "temp"}).json()
    key = made["key"]
    assert auth_client.post("/api/render", headers=_auth(key), json=RENDER_BODY).status_code == 200
    assert auth_client.delete(f"/api/admin/keys/{made['id']}", headers=_auth(su)).status_code == 204
    assert auth_client.post("/api/render", headers=_auth(key), json=RENDER_BODY).status_code == 401


def test_expired_session_is_rejected_and_swept(auth_client):
    from datetime import datetime, timedelta, timezone

    from app.core.security import hash_token
    from app.models.database import LoginSession, Role, User

    async def scenario():
        async with auth_client.db_factory() as session:
            users, _total = await accounts.list_users(session)
            user = users[0]
            assert user.role == Role.superuser
            token = "expired-token"
            session.add(
                LoginSession(
                    token_hash=hash_token(token),
                    user_id=user.id,
                    expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
                )
            )
            await session.commit()
            # Resolution refuses it and deletes the stale row on the way out.
            assert await accounts.resolve_session(session, token) is None
            assert await accounts.resolve_session(session, token) is None

    _run(scenario())


def test_key_list_never_exposes_the_secret(auth_client):
    su = _login(auth_client, SUPER, SUPER_PW).json()["token"]
    auth_client.post("/api/admin/keys", headers=_auth(su), json={"name": "billing-app"})
    listed = auth_client.get("/api/admin/keys", headers=_auth(su)).json()
    assert listed[0]["name"] == "billing-app"
    assert "key" not in listed[0]  # only the prefix survives the create moment
