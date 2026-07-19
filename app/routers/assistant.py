import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.auth import check_admin_token
from app.core.config import Settings, get_settings
from app.services import assistant

log = logging.getLogger("linform.assistant")

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    #: Prose only — the client strips html blocks before sending.
    text: str = ""


class AssistantRequest(BaseModel):
    message: str = Field(min_length=1)
    #: Earlier turns of this session, oldest first.
    history: list[HistoryTurn] = Field(default_factory=list, max_length=40)
    html: str = ""
    placeholders: list[str] = Field(default_factory=list)
    # Sent only when the caller wants test data considered; still gated by the
    # server-side ai_send_test_data flag before it reaches the model.
    test_data: dict | None = None
    # Scans/screenshots as data: URLs — the document-to-template and
    # "here, this part is wrong" flows.
    images: list[str] = Field(default_factory=list, max_length=4)


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
    messages = assistant.build_messages(
        body.message,
        body.html,
        body.placeholders,
        test_data,
        images=body.images,
        history=[turn.model_dump() for turn in body.history],
    )

    async def event_stream() -> AsyncIterator[str]:
        # uvicorn's access log only prints when the response finishes, so a
        # stream that hangs leaves no trace at all. Log both ends: an "opened"
        # with no matching "closed" is exactly the signature of a stuck stream.
        started = time.monotonic()
        log.info(
            "assistant stream opened: images=%d history=%d html=%dB",
            len(body.images),
            len(body.history),
            len(body.html),
        )
        deltas = 0
        outcome = "ok"
        try:
            async for delta in assistant.stream_completion(settings, messages):
                deltas += 1
                yield _sse("delta", {"text": delta})
            yield _sse("done", {})
        except assistant.AssistantError as exc:
            outcome = f"error: {exc}"
            yield _sse("error", {"detail": str(exc)})
        except asyncio.CancelledError:
            # The client went away mid-stream (navigated, hit Stop, lost the
            # connection). Worth seeing: it is what a "frozen" tab looks like.
            outcome = "cancelled by client"
            raise
        finally:
            log.info(
                "assistant stream closed after %.2fs: deltas=%d %s",
                time.monotonic() - started,
                deltas,
                outcome,
            )

    return StreamingResponse(event_stream(), media_type="text/event-stream")
