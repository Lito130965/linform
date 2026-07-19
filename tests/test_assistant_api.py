"""Assistant proxy: feature-flag gating, streaming shape, the privacy flag,
admin-only access, and no key leaking into error text — all with a mocked LLM."""

import pytest

from app.core.config import Settings, get_settings
from app.main import app
from app.services import assistant


def _override(**kwargs):
    settings = Settings(database_url="sqlite+aiosqlite://", **kwargs)
    app.dependency_overrides[get_settings] = lambda: settings
    return settings


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    app.dependency_overrides.pop(get_settings, None)


def test_status_off_when_no_key(db_client):
    _override()
    body = db_client.get("/api/assistant/status").json()
    assert body == {"enabled": False, "model": None, "sends_test_data": False}


def test_status_on_reports_model_not_key(db_client):
    _override(ai_api_key="secret-key-123", ai_model="gpt-4o-mini")
    body = db_client.get("/api/assistant/status").json()
    assert body["enabled"] is True
    assert body["model"] == "gpt-4o-mini"
    assert "secret-key-123" not in str(body)


def test_chat_returns_503_when_disabled(db_client):
    _override()
    resp = db_client.post("/api/assistant", json={"message": "hi"})
    assert resp.status_code == 503


def _mock_stream(deltas):
    async def gen(settings, messages):
        gen.messages = messages
        for d in deltas:
            yield d

    return gen


def test_chat_streams_sse_deltas(db_client, monkeypatch):
    _override(ai_api_key="k")
    monkeypatch.setattr(assistant, "stream_completion", _mock_stream(["Hello ", "world"]))
    resp = db_client.post("/api/assistant", json={"message": "make a title", "html": "<h1>x</h1>"})
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    assert 'event: delta' in resp.text
    assert '"Hello ' in resp.text
    assert 'event: done' in resp.text


def test_test_data_dropped_unless_flag_set(db_client, monkeypatch):
    _override(ai_api_key="k", ai_send_test_data=False)
    mock = _mock_stream(["ok"])
    monkeypatch.setattr(assistant, "stream_completion", mock)
    db_client.post(
        "/api/assistant",
        json={"message": "m", "html": "<p>{{ x }}</p>", "test_data": {"secret": "pii"}},
    )
    sent = "\n".join(m["content"] for m in mock.messages)
    assert "pii" not in sent


def test_test_data_included_when_flag_set(db_client, monkeypatch):
    _override(ai_api_key="k", ai_send_test_data=True)
    mock = _mock_stream(["ok"])
    monkeypatch.setattr(assistant, "stream_completion", mock)
    db_client.post(
        "/api/assistant",
        json={"message": "m", "html": "<p>{{ x }}</p>", "test_data": {"amount": 42}},
    )
    sent = "\n".join(m["content"] for m in mock.messages)
    assert "42" in sent


def test_provider_error_becomes_sse_error_without_leaking_key(db_client, monkeypatch):
    _override(ai_api_key="super-secret", ai_base_url="https://internal.example/v1/")

    async def boom(settings, messages):
        raise assistant.AssistantError("Could not reach the AI provider")
        yield  # pragma: no cover

    monkeypatch.setattr(assistant, "stream_completion", boom)
    resp = db_client.post("/api/assistant", json={"message": "m"})
    assert resp.status_code == 200
    assert "event: error" in resp.text
    assert "super-secret" not in resp.text
    assert "internal.example" not in resp.text


def test_system_prompt_is_assembled_from_live_engine():
    from app.services.assistant_prompt import build_system_prompt

    prompt = build_system_prompt()
    # Fixed contract and both modes.
    assert "```html" in prompt
    assert "MODE: document → template" in prompt
    assert "MODE: targeted correction" in prompt
    assert "numbered questions" in prompt
    # Live introspection: real sandbox filters are listed, so filters added
    # later (e.g. money/format_date) reach the model automatically.
    assert "default" in prompt and "round" in prompt and "upper" in prompt
    # Curated engine facts.
    assert "asset://" in prompt
    assert "counter(pages)" in prompt
    assert "page-break" in prompt


def test_images_travel_in_vision_content_format():
    msgs = assistant.build_messages(
        "make it like this", "<p>x</p>", ["x"], None,
        images=["data:image/png;base64,AAA"],
    )
    content = msgs[1]["content"]
    assert isinstance(content, list)
    kinds = [part["type"] for part in content]
    assert kinds == ["text", "image_url"]
    assert content[1]["image_url"]["url"] == "data:image/png;base64,AAA"


def test_chat_accepts_images(db_client, monkeypatch):
    _override(ai_api_key="k")
    mock = _mock_stream(["ok"])
    monkeypatch.setattr(assistant, "stream_completion", mock)
    resp = db_client.post(
        "/api/assistant",
        json={"message": "m", "images": ["data:image/png;base64,AAA"]},
    )
    assert resp.status_code == 200
    user_content = mock.messages[1]["content"]
    assert any(p.get("type") == "image_url" for p in user_content)


def test_chat_requires_admin_token(db_client):
    _override(ai_api_key="k", admin_token="admin-secret", render_token="render-secret")
    assert db_client.post("/api/assistant", json={"message": "m"}).status_code == 401
    assert (
        db_client.post(
            "/api/assistant",
            json={"message": "m"},
            headers={"Authorization": "Bearer render-secret"},
        ).status_code
        == 403
    )


def test_history_is_replayed_as_turns_before_the_live_request():
    msgs = assistant.build_messages(
        "the background moved again",
        "<p>current</p>",
        [],
        None,
        history=[
            {"role": "user", "text": "add a background"},
            {"role": "assistant", "text": "Put it on @page.", "applied": True},
        ],
    )
    roles = [m["role"] for m in msgs]
    assert roles == ["system", "user", "assistant", "user"]
    # The live request stays last so the current template outranks the history.
    assert "the background moved again" in msgs[-1]["content"]
    assert "<p>current</p>" in msgs[-1]["content"]


def test_apply_and_reject_are_marked_so_settled_work_is_not_undone():
    msgs = assistant.build_messages(
        "next", "<p>x</p>", [], None,
        history=[
            {"role": "assistant", "text": "took it", "applied": True},
            {"role": "assistant", "text": "missed it", "applied": False},
            {"role": "assistant", "text": "a question", "applied": None},
        ],
    )
    kept, rejected, asked = msgs[1]["content"], msgs[2]["content"], msgs[3]["content"]
    assert "settled" in kept
    assert "did NOT apply" in rejected
    # A turn that proposed no template carries no verdict either way.
    assert "settled" not in asked and "did NOT apply" not in asked


def test_history_never_carries_old_templates_or_unbounded_text():
    stale = "<html>STALE VERSION</html>"
    msgs = assistant.build_messages(
        "go", "<p>live</p>", [], None,
        history=[{"role": "assistant", "text": stale + "x" * 5000, "applied": False}],
    )
    replayed = msgs[1]["content"]
    assert len(replayed) < assistant.MAX_HISTORY_CHARS + 200


def test_history_is_capped_to_the_recent_turns():
    history = [{"role": "user", "text": f"turn {i}"} for i in range(60)]
    msgs = assistant.build_messages("now", "<p>x</p>", [], None, history=history)
    replayed = [m for m in msgs if m["role"] != "system"][:-1]
    assert len(replayed) == assistant.MAX_HISTORY_TURNS
    assert "turn 59" in replayed[-1]["content"]
    assert "turn 0" not in " ".join(m["content"] for m in replayed)


def test_blank_turns_are_dropped():
    msgs = assistant.build_messages(
        "go", "<p>x</p>", [], None,
        history=[{"role": "assistant", "text": "   "}, {"role": "user", "text": "real"}],
    )
    assert [m["role"] for m in msgs] == ["system", "user", "user"]


def test_chat_accepts_history(db_client, monkeypatch):
    _override(ai_api_key="k")
    captured = {}

    def spy(message, html, placeholders, test_data, images=None, history=None):
        captured["history"] = history
        return [{"role": "system", "content": "s"}]

    monkeypatch.setattr(assistant, "build_messages", spy)
    monkeypatch.setattr(assistant, "stream_completion", _mock_stream(["ok"]))
    resp = db_client.post(
        "/api/assistant",
        json={
            "message": "m",
            "history": [{"role": "assistant", "text": "prior", "applied": True}],
        },
    )
    assert resp.status_code == 200
    assert captured["history"] == [{"role": "assistant", "text": "prior", "applied": True}]
