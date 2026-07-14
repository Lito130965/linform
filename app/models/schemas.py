from pydantic import BaseModel, Field


class AdHocRenderRequest(BaseModel):
    """Render core (no stored templates yet): raw template + payload -> PDF."""

    html: str = Field(min_length=1, description="HTML template with Jinja2 placeholders")
    data: dict = Field(default_factory=dict, description="Payload substituted into the template")


class PlaceholdersResponse(BaseModel):
    placeholders: list[str]
