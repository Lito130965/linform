"""Read-only showcase examples for the editor gallery. Editor-side feature, so
gated with the editor role; consuming applications never need these."""

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import require_editor
from app.models.schemas import ExampleDetail, ExampleMeta
from app.services import examples
from app.services.examples import ExampleError

router = APIRouter(
    prefix="/api/examples", tags=["examples"], dependencies=[Depends(require_editor)]
)


@router.get("", response_model=list[ExampleMeta])
async def list_examples():
    return examples.list_examples()


@router.get("/{example_id}", response_model=ExampleDetail)
async def get_example(example_id: str):
    try:
        return examples.get_example(example_id)
    except ExampleError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
