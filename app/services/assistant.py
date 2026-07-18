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

SYSTEM_PROMPT = """You are a template assistant for Linform, a service that \
renders HTML templates to PDF with WeasyPrint and fills them with data via \
sandboxed Jinja2.

Hard rules for every template you produce:
- Output ONE complete HTML document inside a single ```html fenced code block. \
Never output partial snippets or diffs — always the full template.
- Rendering is WeasyPrint: CSS Paged Media works (@page, margins, \
@top/@bottom margin boxes with counter(page)/counter(pages), \
page-break-before/inside/after). No JavaScript runs. Flexbox and grid are only \
partially supported — prefer tables and normal flow for print layout.
- Data is injected with Jinja2 in a sandbox: {{ placeholders }}, {% for %}, \
{% if %}, filters like default() and round(). No access to Python internals.
- Images/logos are referenced as asset://<sha256>; leave existing asset:// \
URLs untouched. Do not invent asset URLs.
- Keep the set of {{ placeholders }} stable unless the user asks to change it.

When the user reports a render error, fix the template so it renders cleanly \
and return the full corrected HTML. Briefly explain what you changed in one or \
two sentences before the code block."""


class AssistantError(Exception):
    """Message is safe to show the client — never contains the key or URL."""


def is_enabled(settings: Settings) -> bool:
    return bool(settings.ai_api_key)


def build_messages(
    user_message: str,
    template_html: str,
    placeholders: list[str],
    test_data: dict | None,
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
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(context) + "\n\nRequest: " + user_message},
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
