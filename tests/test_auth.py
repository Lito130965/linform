"""Token matrix: render token renders but cannot manage; admin and legacy
tokens do both; no tokens configured = dev mode, everything open."""

import pytest

from app.core.config import Settings, get_settings
from app.main import app


@pytest.fixture()
def secured_client(db_client):
    settings = Settings(
        render_token="render-secret",
        admin_token="admin-secret",
        database_url="sqlite+aiosqlite://",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield db_client
    app.dependency_overrides.pop(get_settings, None)


def _auth(token: str | None) -> dict:
    return {"Authorization": f"Bearer {token}"} if token else {}


RENDER_BODY = {"html": "<p>{{ x }}</p>", "data": {"x": 1}, "strict": False}


@pytest.mark.parametrize("token,expected", [
    ("render-secret", 200),
    ("admin-secret", 200),
    ("wrong", 401),
    (None, 401),
])
def test_render_endpoint_token_matrix(secured_client, token, expected):
    resp = secured_client.post("/api/render", json=RENDER_BODY, headers=_auth(token))
    assert resp.status_code == expected


@pytest.mark.parametrize("token,expected", [
    ("admin-secret", 200),
    ("render-secret", 403),
    ("wrong", 401),
    (None, 401),
])
def test_admin_endpoint_token_matrix(secured_client, token, expected):
    resp = secured_client.get("/api/templates", headers=_auth(token))
    assert resp.status_code == expected


def test_legacy_token_counts_as_both(db_client):
    settings = Settings(api_token="legacy-secret", database_url="sqlite+aiosqlite://")
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        assert db_client.get("/api/templates", headers=_auth("legacy-secret")).status_code == 200
        assert (
            db_client.post("/api/render", json=RENDER_BODY, headers=_auth("legacy-secret")).status_code
            == 200
        )
        assert db_client.get("/api/templates", headers=_auth("nope")).status_code == 401
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_render_only_deployment_locks_admin(db_client):
    settings = Settings(render_token="render-secret", database_url="sqlite+aiosqlite://")
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        assert (
            db_client.post("/api/render", json=RENDER_BODY, headers=_auth("render-secret")).status_code
            == 200
        )
        # No admin-capable token exists: management stays closed, by design.
        assert db_client.get("/api/templates", headers=_auth("render-secret")).status_code == 403
        assert db_client.get("/api/templates").status_code == 401
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_no_tokens_is_dev_mode(db_client):
    assert db_client.get("/api/templates").status_code == 200
    assert db_client.post("/api/render", json=RENDER_BODY).status_code == 200
