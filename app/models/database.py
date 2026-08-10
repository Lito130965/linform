import enum
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
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


class Role(str, enum.Enum):
    """Who a human user is. `superuser` is bootstrapped from the environment and
    manages users and API keys; `editor` designs templates and previews them but
    cannot manage accounts. Consumer applications are not users — they render
    with API keys, which are always render-only."""

    superuser = "superuser"
    editor = "editor"


class User(Base):
    """A human who signs into the editor UI. Passwords are stored slow-hashed;
    the clear value never touches the database."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False, length=20))
    is_active: Mapped[bool] = mapped_column(default=True)
    # Login throttling. Kept in the database, not in memory: an in-process
    # counter would reset on restart and would not be shared across replicas,
    # which the deployment model explicitly allows.
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint("username <> ''", name="ck_user_username_not_empty"),)


class ApiKey(Base):
    """A render credential a consuming application sends as a Bearer token.
    Minted by a superuser, revocable one at a time. Only the SHA-256 digest is
    stored; the clear key is shown once, at creation. Always render-scoped."""

    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    # First few chars of the clear key, kept for display so a superuser can tell
    # rows apart without ever seeing the secret again.
    prefix: Mapped[str] = mapped_column(String(12))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_by: Mapped[str] = mapped_column(String(150), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LoginSession(Base):
    """An opaque server-side session issued after a password login. Stored by
    digest and bounded by `expires_at`; deleting the user's rows (or the row
    itself on logout) revokes access immediately — the reason we keep sessions
    in the database instead of handing out self-contained JWTs."""

    __tablename__ = "login_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship()


class Asset(Base):
    """Uploaded resource (logo, font, background) referenced from templates
    as asset://<sha256>. Content-addressed and immutable: replacing a logo
    means uploading a new file — old template versions keep rendering the
    bytes they were published with."""

    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DemoAsset(Base):
    """A file uploaded on a public demo: one visitor's, and temporary.

    Deliberately not an Asset. An asset belongs to the installation, is
    deduplicated by content and lasts as long as the versions referencing it
    (decision 3) — none of which is safe where anybody may upload anything. A
    demo upload is visible only to whoever sent it and stops existing an hour
    later, so that unlawful or malicious content cannot be served to anyone
    else and cannot be parked on the domain.

    Separate tables keep both statements true at once: `assets` keeps its
    guarantee, and this table can be emptied at any moment with nothing lost.
    Content addressing is scoped to the owner here — two visitors uploading the
    same bytes get a row each, because sharing one would let the first's expiry
    delete what the second is using.
    """

    __tablename__ = "demo_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    # Opaque per-browser id from a cookie. Not an account: it identifies a
    # scratch space, and it is all this table ever knows about a visitor.
    owner: Mapped[str] = mapped_column(String(64), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("sha256", "owner", name="uq_demo_asset_per_owner"),)


class Directory(Base):
    """A flat organizational bucket for templates (e.g. one per consuming
    service). Purely for the editor's benefit today — the render API still
    addresses templates by their stable code, never by directory. The relation
    exists so a later step can scope render/editor access per directory."""

    __tablename__ = "directories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    created_by: Mapped[str] = mapped_column(String(150), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint("name <> ''", name="ck_directory_name_not_empty"),)


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable identifier consumers render by; the active version may change,
    # the code never does.
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    # Optional bucket; NULL = uncategorized. SET NULL on directory delete so a
    # removed bucket never orphans a template into an invalid state.
    directory_id: Mapped[int | None] = mapped_column(
        ForeignKey("directories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Archiving, not deletion: a consumer may still be pinning an old version
    # of a template nobody edits any more, and reproducibility outranks tidiness.
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    versions: Mapped[list["TemplateVersion"]] = relationship(
        back_populates="template", order_by="TemplateVersion.version"
    )

    __table_args__ = (CheckConstraint("code <> ''", name="ck_template_code_not_empty"),)


class TemplateVersion(Base):
    __tablename__ = "template_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"))
    # NULL while this row is a draft. A number is assigned at publication, so
    # a version number always means "something a consumer could have rendered"
    # — there are no gaps for work that never shipped. A template may hold
    # several drafts at once; each is addressed by its id, and any of them can
    # be edited, deleted or published independently.
    version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    html_content: Mapped[str] = mapped_column(Text)
    status: Mapped[VersionStatus] = mapped_column(
        Enum(VersionStatus, native_enum=False, length=20), default=VersionStatus.draft
    )
    created_by: Mapped[str] = mapped_column(String(255), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    template: Mapped[Template] = relationship(back_populates="versions")

    __table_args__ = (
        # Published versions are immutable and numbered per template; the
        # constraint is also what resolves the concurrent-increment race
        # (insert + retry). Drafts carry NULL, and both engines treat NULLs as
        # distinct in a unique constraint, so any number of them coexist.
        UniqueConstraint("template_id", "version", name="uq_version_per_template"),
        # At most one published version per template — the one consumers get.
        # Enforced by the database rather than by "there is only one pod".
        Index(
            "uq_one_published_per_template",
            "template_id",
            unique=True,
            postgresql_where=text("status = 'published'"),
            sqlite_where=text("status = 'published'"),
        ),
    )
