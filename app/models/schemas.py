from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.database import Role, VersionStatus


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


class AssetOut(BaseModel):
    url: str
    sha256: str
    filename: str
    mime_type: str
    size: int


class TemplateCreate(BaseModel):
    code: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9_\-]+$",
                      description="Stable identifier used by the render API, e.g. 'invoice'")
    name: str = Field(min_length=1, max_length=255)


class VersionCreate(BaseModel):
    html_content: str = Field(min_length=1)
    comment: str = Field(default="", max_length=2000, description="What changed, like a commit message")
    # Authorship is taken from the authenticated principal server-side, never
    # from the request, so a saved version records who really saved it.


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


# --- auth & accounts -------------------------------------------------------

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1)


class MeResponse(BaseModel):
    """Who the current credential is — the UI adapts its affordances to this."""

    authenticated: bool
    # False only in open dev mode (no auth configured at all).
    auth_enabled: bool
    username: str = ""
    role: str = ""


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=8, max_length=255)
    role: Role = Role.editor


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: Role
    is_active: bool
    created_at: datetime


class PasswordUpdate(BaseModel):
    password: str = Field(min_length=8, max_length=255)


class ActiveUpdate(BaseModel):
    is_active: bool


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)


class ApiKeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    prefix: str
    created_by: str
    created_at: datetime
    last_used_at: datetime | None


class ApiKeyCreated(ApiKeyOut):
    """Returned once at creation — the only time the clear key is visible."""

    key: str


# --- showcase examples -----------------------------------------------------

class ExampleMeta(BaseModel):
    id: str
    title: str
    description: str
    tags: list[str] = Field(default_factory=list)


class ExampleDetail(ExampleMeta):
    html: str
    data: dict = Field(default_factory=dict)
