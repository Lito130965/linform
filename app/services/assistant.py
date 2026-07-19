"""AI assistant: a thin proxy to any OpenAI-compatible chat completions API.

BYOK — the installation owner supplies the key, which lives only here on the
backend and is never sent to the browser. The assistant is off (and hidden in
the UI) when no key is configured.

The contract with the model is deliberately narrow: it returns a whole new
template HTML in a fenced block, never patches. The human reviews the diff and
applies it — the assistant never writes to the database.
"""

import json
from collections.abc import AsyncIterator

import httpx

from app.core.config import Settings
from app.services.assistant_prompt import build_system_prompt


class AssistantError(Exception):
    """Message is safe to show the client — never contains the key or URL."""


def is_enabled(settings: Settings) -> bool:
    return bool(settings.ai_api_key)


def build_messages(
    user_message: str,
    template_html: str,
    placeholders: list[str],
    test_data: dict | None,
    images: list[str] | None = None,
) -> list[dict]:
    context = [
        "Current template HTML:",
        "```html",
        template_html or "(empty)",
        "```",
        f"Declared placeholders: {', '.join(placeholders) or '(none)'}",
    ]
    # Privacy: test data is included only when the caller passed it, which the
    # router allows only under the ai_send_test_data flag.
    if test_data is not None:
        context += ["Sample data (JSON):", "```json", json.dumps(test_data, ensure_ascii=False), "```"]
    text = "\n".join(context) + "\n\nRequest: " + user_message

    # Attached documents/screenshots (data URLs) travel in the vision content
    # format; providers without vision reject them with their own error.
    content: str | list[dict]
    if images:
        content = [{"type": "text", "text": text}] + [
            {"type": "image_url", "image_url": {"url": url}} for url in images
        ]
    else:
        content = text
    return [
        {"role": "system", "content": build_system_prompt()},
        {"role": "user", "content": content},
    ]


async def stream_completion(settings: Settings, messages: list[dict]) -> AsyncIterator[str]:
    """Yield assistant text deltas from an OpenAI-compatible streaming endpoint.

    Provider/network failures are re-raised as AssistantError with a generic
    message; the key and base URL never appear in what the client sees.
    """
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    payload = {"model": settings.ai_model, "messages": messages, "stream": True}
    headers = {"Authorization": f"Bearer {settings.ai_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    raise AssistantError(f"AI provider returned HTTP {resp.status_code}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"].get("content")
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
                    if delta:
                        yield delta
    except httpx.TimeoutException:
        raise AssistantError("AI provider timed out")
    except httpx.HTTPError:
        # Deliberately generic: an httpx error string can include the URL.
        raise AssistantError("Could not reach the AI provider")
