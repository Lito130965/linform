import enum
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class VersionStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    archived = "archived"


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable identifier consumers render by; the active version may change,
    # the code never does.
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    versions: Mapped[list["TemplateVersion"]] = relationship(
        back_populates="template", order_by="TemplateVersion.version"
    )

    __table_args__ = (CheckConstraint("code <> ''", name="ck_template_code_not_empty"),)


class TemplateVersion(Base):
    __tablename__ = "template_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    html_content: Mapped[str] = mapped_column(Text)
    status: Mapped[VersionStatus] = mapped_column(
        Enum(VersionStatus, native_enum=False, length=20), default=VersionStatus.draft
    )
    created_by: Mapped[str] = mapped_column(String(255), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    template: Mapped[Template] = relationship(back_populates="versions")

    __table_args__ = (
        # Versions are immutable and numbered per template; the constraint is
        # also what resolves the concurrent-increment race (insert + retry).
        UniqueConstraint("template_id", "version", name="uq_version_per_template"),
        # At most one published version per template, enforced by the database
        # rather than by "there is only one pod" assumptions.
        Index(
            "uq_one_published_per_template",
            "template_id",
            unique=True,
            postgresql_where=text("status = 'published'"),
            sqlite_where=text("status = 'published'"),
        ),
    )
