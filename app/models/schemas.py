from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.database import VersionStatus


class AdHocRenderRequest(BaseModel):
    """Render core (no stored templates yet): raw template + payload -> PDF."""

    html: str = Field(min_length=1, description="HTML template with Jinja2 placeholders")
    data: dict = Field(default_factory=dict, description="Payload substituted into the template")
    strict: bool | None = Field(
        default=None,
        description="Override strict placeholder mode for this render; "
        "editors preview leniently, production uses the configured default",
    )


class PlaceholdersResponse(BaseModel):
    placeholders: list[str]


class TemplateCreate(BaseModel):
    code: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9_\-]+$",
                      description="Stable identifier used by the render API, e.g. 'invoice'")
    name: str = Field(min_length=1, max_length=255)


class VersionCreate(BaseModel):
    html_content: str = Field(min_length=1)
    comment: str = Field(default="", max_length=2000, description="What changed, like a commit message")
    created_by: str = Field(default="", max_length=255)


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version: int
    status: VersionStatus
    comment: str
    created_by: str
    created_at: datetime


class VersionDetailOut(VersionOut):
    html_content: str


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    created_at: datetime


class TemplateDetailOut(TemplateOut):
    versions: list[VersionOut]
