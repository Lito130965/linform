"""A template is untrusted input, so a template that asks for too much must
fail as a template problem — not as a server fault and not as a hang.

Two mechanisms cover this, and they are worth telling apart:

* Jinja's sandbox refuses `range()` above MAX_RANGE (100_000) outright. That
  guard already existed; what did not is reporting it as a client error, so it
  used to surface as a 500 ("the server broke") instead of naming the problem.
* Anything the sandbox allows through but that is merely slow is bounded by the
  render timeout, which answers 504. Verified against the real engine on a
  server: a 4000x4000 nested loop returned 504 after the configured 30s while
  /health kept answering in ~2ms.
"""

import pytest

from app.services.template_engine import TemplateRenderError, render_html

RUNAWAY = "<p>{% for i in range(20000000) %}x{% endfor %}</p>"


def test_runaway_range_is_refused_by_the_sandbox():
    with pytest.raises(TemplateRenderError) as exc:
        render_html(RUNAWAY, {}, strict=False)
    # The message has to name the template's problem, not leak an internal one.
    assert "too much" in str(exc.value).lower()


def test_runaway_range_is_a_client_error_not_a_server_error(db_client):
    """It is the caller's template, so it is the caller's error. Before this,
    the bare OverflowError escaped the handler and became a 500."""
    resp = db_client.post("/api/render", json={"html": RUNAWAY, "data": {}, "strict": False})
    assert resp.status_code == 422, f"expected 422, got {resp.status_code}"
    assert "too much" in resp.json()["detail"].lower()


def test_a_stored_template_with_a_runaway_loop_fails_the_same_way(db_client):
    db_client.post("/api/templates", json={"code": "runaway", "name": "Runaway"})
    # It compiles fine — the refusal happens at render time, with real data.
    created = db_client.put(
        "/api/templates/runaway", json={"html_content": RUNAWAY, "comment": "boom"}
    )
    assert created.status_code == 201
    db_client.post("/api/templates/runaway/publish/1")
    resp = db_client.post("/api/render/runaway", json={})
    assert resp.status_code == 422


def test_a_slow_render_times_out_as_504_rather_than_hanging(db_client, monkeypatch):
    """The engine stage is bounded by the render timeout. Simulated here so the
    suite stays fast; the real 30s path was exercised against a server."""
    from app.services.renderer import RenderTimeout

    async def slow(_html: str):
        raise RenderTimeout("Render exceeded 30s timeout")

    monkeypatch.setattr(db_client.stub_renderer, "render_pdf", slow)
    resp = db_client.post(
        "/api/render", json={"html": "<p>{{ x }}</p>", "data": {"x": 1}, "strict": False}
    )
    assert resp.status_code == 504
    assert "timeout" in resp.json()["detail"].lower()


def test_a_loop_within_the_sandbox_limit_still_renders():
    """The guard must not be so eager that ordinary forms break: padding a table
    to a fixed number of rows is a normal thing for a print form to do."""
    html = "<table><tbody>{% for i in range(50) %}<tr><td>{{ i }}</td></tr>{% endfor %}</tbody></table>"
    out = render_html(html, {}, strict=False)
    assert out.count("<tr>") == 50
