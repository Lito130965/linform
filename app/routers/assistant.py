import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.auth import check_admin_token
from app.core.config import Settings, get_settings
from app.services import assistant

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class AssistantRequest(BaseModel):
    message: str = Field(min_length=1)
    html: str = ""
    placeholders: list[str] = Field(default_factory=list)
    # Sent only when the caller wants test data considered; still gated by the
    # server-side ai_send_test_data flag before it reaches the model.
    test_data: dict | None = None


class AssistantStatus(BaseModel):
    enabled: bool
    model: str | None = None
    sends_test_data: bool = False


@router.get("/status", response_model=AssistantStatus)
async def status(settings: Settings = Depends(get_settings)) -> AssistantStatus:
    """Lets the UI show or hide the assistant without exposing any secret."""
    if not assistant.is_enabled(settings):
        return AssistantStatus(enabled=False)
    return AssistantStatus(
        enabled=True, model=settings.ai_model, sends_test_data=settings.ai_send_test_data
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("", dependencies=[Depends(check_admin_token)])
async def chat(
    body: AssistantRequest, settings: Settings = Depends(get_settings)
) -> StreamingResponse:
    if not assistant.is_enabled(settings):
        raise HTTPException(status_code=503, detail="AI assistant is not configured")

    # Enforce the privacy flag here: even if the client sends test data, it is
    # dropped unless the installation explicitly opted in.
    test_data = body.test_data if settings.ai_send_test_data else None
    messages = assistant.build_messages(body.message, body.html, body.placeholders, test_data)

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for delta in assistant.stream_completion(settings, messages):
                yield _sse("delta", {"text": delta})
            yield _sse("done", {})
        except assistant.AssistantError as exc:
            yield _sse("error", {"detail": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
