"""Request correlation, structured logs and metrics.

The question all of this exists to answer is "why were forms slow at 14:00
yesterday". Answering it needs an id that ties every line of one request
together, one line per request carrying its own timing, and counters that
survive the restart of the conversation.

The other half is what must NOT be there: the request body. Payloads are the
consumer's business data, which this service renders and forgets — a log file is
the easiest place to break that promise by accident.
"""

import json
import logging

import pytest

from app.core import metrics
from app.core.config import Settings, get_settings
from app.core.logging import (
    REQUEST_ID_HEADER,
    JsonFormatter,
    RequestIdFilter,
    get_request_id,
    set_request_id,
)
from app.main import app

RENDER_BODY = {"html": "<p>{{ secret }}</p>", "data": {"secret": "ACC-9999-PRIVATE"}, "strict": False}


# --- request id ------------------------------------------------------------

def test_every_response_carries_a_request_id(db_client):
    resp = db_client.get("/health")
    assert resp.headers[REQUEST_ID_HEADER]
    # Two requests are two ids.
    other = db_client.get("/health")
    assert other.headers[REQUEST_ID_HEADER] != resp.headers[REQUEST_ID_HEADER]


def test_an_incoming_request_id_is_honoured(db_client):
    """A proxy or a calling application may already have an id; reusing it is
    what makes one trace span both sides."""
    resp = db_client.get("/health", headers={REQUEST_ID_HEADER: "trace-from-caller"})
    assert resp.headers[REQUEST_ID_HEADER] == "trace-from-caller"


def test_an_absurd_incoming_id_is_truncated(db_client):
    """It is echoed into a response header, so its length cannot be the
    caller's choice."""
    resp = db_client.get("/health", headers={REQUEST_ID_HEADER: "x" * 5000})
    assert len(resp.headers[REQUEST_ID_HEADER]) == 64


def test_errors_carry_a_request_id_too(db_client):
    """The id matters most when something went wrong."""
    resp = db_client.get("/api/templates/no-such-template")
    assert resp.status_code == 404
    assert resp.headers[REQUEST_ID_HEADER]


# --- structured logs -------------------------------------------------------

def _format(record: logging.LogRecord) -> dict:
    RequestIdFilter().filter(record)
    return json.loads(JsonFormatter().format(record))


def _record(msg: str = "hello", **extra) -> logging.LogRecord:
    record = logging.LogRecord("linform.test", logging.INFO, __file__, 1, msg, (), None)
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_json_log_line_has_the_fields_an_operator_needs():
    set_request_id("req-123")
    try:
        line = _format(_record("GET /api/render", method="GET", path="/api/render",
                               status=200, duration_ms=42.5, principal="billing-app"))
    finally:
        set_request_id(None)
    assert line["level"] == "INFO"
    assert line["message"] == "GET /api/render"
    assert line["request_id"] == "req-123"
    assert line["status"] == 200
    assert line["duration_ms"] == 42.5
    assert line["principal"] == "billing-app"
    assert line["ts"].endswith("Z")


def test_a_log_line_without_a_request_omits_the_id():
    set_request_id(None)
    assert "request_id" not in _format(_record("startup"))


def test_an_unserializable_extra_degrades_instead_of_losing_the_line():
    class Opaque:
        def __repr__(self) -> str:
            return "<opaque>"

    line = _format(_record("odd", thing=Opaque()))
    assert line["thing"] == "<opaque>"


def test_exceptions_are_captured_in_the_line():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = _record("failed")
        record.exc_info = sys.exc_info()
        line = _format(record)
    assert "ValueError: boom" in line["exception"]


def test_the_request_log_never_contains_the_payload(db_client, caplog):
    """Business data must not reach a log file. The service renders payloads and
    forgets them — that promise is in the README, and this is where it would
    quietly break."""
    with caplog.at_level(logging.INFO):
        resp = db_client.post("/api/render", json=RENDER_BODY)
    assert resp.status_code == 200
    logged = "\n".join(r.getMessage() + str(r.__dict__) for r in caplog.records)
    assert "ACC-9999-PRIVATE" not in logged
    assert "secret" not in logged.replace("secrets", "")


def test_the_request_log_records_the_principal_not_the_credential(db_client, caplog):
    with caplog.at_level(logging.INFO, logger="linform.request"):
        db_client.get("/api/templates")
    line = next(r for r in caplog.records if r.name == "linform.request")
    # Dev mode resolves to the synthetic "dev" principal.
    assert getattr(line, "principal") == "dev"
    assert getattr(line, "status") == 200
    assert getattr(line, "duration_ms") >= 0


def test_request_id_is_per_task_not_global():
    set_request_id("outer")
    assert get_request_id() == "outer"
    set_request_id(None)
    assert get_request_id() is None


# --- metrics ---------------------------------------------------------------

@pytest.fixture()
def metrics_client(db_client):
    settings = Settings(metrics_enabled=True, database_url="sqlite+aiosqlite://")
    app.dependency_overrides[get_settings] = lambda: settings
    yield db_client
    app.dependency_overrides.pop(get_settings, None)


def test_metrics_are_not_exposed_unless_enabled(db_client):
    """Series are labelled by template code, so an open /metrics tells anyone
    which forms this deployment runs."""
    assert db_client.get("/metrics").status_code == 404


def test_metrics_expose_the_render_series(metrics_client):
    metrics_client.post("/api/render", json=RENDER_BODY)
    body = metrics_client.get("/metrics").text
    assert "linform_render_duration_seconds" in body
    assert "linform_render_inflight" in body
    assert 'outcome="ok"' in body


def test_a_named_template_gets_its_own_series(metrics_client):
    metrics_client.post("/api/templates", json={"code": "invoice-m", "name": "Invoice"})
    draft = metrics_client.post(
        "/api/templates/invoice-m/drafts", json={"html_content": "<p>{{ x }}</p>"}
    ).json()
    metrics_client.post(f"/api/templates/invoice-m/drafts/{draft['id']}/publish")
    metrics_client.post("/api/render/invoice-m", json={"x": 1})

    body = metrics_client.get("/metrics").text
    assert 'template_code="invoice-m"' in body
    # Ad-hoc renders share one series instead of minting one each.
    assert 'template_code="<ad-hoc>"' in body


def test_shed_and_timed_out_renders_are_counted(metrics_client, monkeypatch):
    from app.services.renderer import RenderBusy, RenderTimeout

    before_rejected = metrics.render_rejected_total._value.get()
    before_timeout = metrics.render_timeout_total._value.get()

    async def busy(_html):
        raise RenderBusy("at capacity")

    monkeypatch.setattr(metrics_client.stub_renderer, "render_pdf", busy)
    assert metrics_client.post("/api/render", json=RENDER_BODY).status_code == 429

    async def slow(_html):
        raise RenderTimeout("too slow")

    monkeypatch.setattr(metrics_client.stub_renderer, "render_pdf", slow)
    assert metrics_client.post("/api/render", json=RENDER_BODY).status_code == 504

    assert metrics.render_rejected_total._value.get() == before_rejected + 1
    assert metrics.render_timeout_total._value.get() == before_timeout + 1


def test_failed_logins_are_counted_by_reason_without_leaking_it(db_client):
    """The reason is a metric label; the response stays one indistinguishable
    401, so the endpoint is still not an account enumerator."""
    settings = Settings(
        superuser="root", superuser_password="supersecret1",
        database_url="sqlite+aiosqlite://", login_rate_per_minute=1000,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        import asyncio

        from app.services import accounts as accounts_service

        async def seed():
            async with db_client.db_factory() as session:
                await accounts_service.ensure_superuser(session, settings)

        asyncio.run(seed())

        before = metrics.login_failed_total.labels(reason="bad_credentials")._value.get()
        resp = db_client.post("/api/auth/login", json={"username": "root", "password": "nope"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid username or password"
        after = metrics.login_failed_total.labels(reason="bad_credentials")._value.get()
        assert after == before + 1
    finally:
        app.dependency_overrides.pop(get_settings, None)
