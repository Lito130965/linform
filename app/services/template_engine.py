"""Data substitution: HTML template with {{ placeholders }} + JSON payload -> final HTML.

Templates are user-supplied and therefore untrusted code. Everything here goes
through Jinja2's SandboxedEnvironment — never a plain Environment.
"""

from jinja2 import StrictUndefined, TemplateSyntaxError, Undefined, meta
from jinja2.exceptions import SecurityError, UndefinedError
from jinja2.sandbox import SandboxedEnvironment

from app.services import barcodes, cache


class TemplateRenderError(Exception):
    """Template failed to compile or render; message is safe to show the client."""


def _make_environment(strict: bool) -> SandboxedEnvironment:
    env = SandboxedEnvironment(
        autoescape=True,
        undefined=StrictUndefined if strict else Undefined,
    )
    env.filters.update(barcodes.FILTERS)
    return env


def render_html(template_source: str, data: dict, *, strict: bool = True) -> str:
    env = _make_environment(strict)
    try:
        template = env.from_string(template_source)
        return template.render(**data)
    except TemplateSyntaxError as exc:
        raise TemplateRenderError(f"Template syntax error at line {exc.lineno}: {exc.message}") from exc
    except UndefinedError as exc:
        raise TemplateRenderError(f"Missing placeholder value: {exc.message}") from exc
    except SecurityError as exc:
        raise TemplateRenderError(f"Template uses a forbidden construct: {exc}") from exc
    except barcodes.BarcodeError as exc:
        # A symbol the data cannot encode is the template author's problem, not
        # a server fault: surface it like any other template error.
        raise TemplateRenderError(f"Barcode error: {exc}") from exc
    except OverflowError as exc:
        # The sandbox refuses range() above MAX_RANGE (100_000) — a real guard
        # against a template that would build an enormous document. It arrives
        # as a bare OverflowError, which without this became a 500: the caller
        # would be told the server broke, when what they need to hear is which
        # part of their template to fix.
        raise TemplateRenderError(f"Template asks for too much at once: {exc}") from exc


def validate_template(template_source: str) -> None:
    """Compile check without rendering; raises TemplateRenderError if broken."""
    env = _make_environment(strict=False)
    try:
        env.from_string(template_source)
    except TemplateSyntaxError as exc:
        raise TemplateRenderError(f"Template syntax error at line {exc.lineno}: {exc.message}") from exc


# Versions are immutable, so a compiled template can be cached by version id —
# but ONLY as long as that id refers to the same row. A version id is a primary
# key of one particular database, and a process can outlive the database it was
# talking to: restore a backup, repoint at another instance, or run a test
# against a fresh schema, and id 1 is a different template with the same key.
# So the source itself is part of the key; a colliding id simply misses the
# cache instead of rendering somebody else's document. (Found by the suite: a
# runaway-template test poisoned the cache for every later test that rendered
# version 1.)
def render_version_html(version_id: int, template_source: str, data: dict, *, strict: bool = True) -> str:
    key = (version_id, strict, hash(template_source))
    template = cache.COMPILED.get(key)
    if template is None:
        env = _make_environment(strict)
        try:
            template = env.from_string(template_source)
        except TemplateSyntaxError as exc:
            raise TemplateRenderError(f"Template syntax error at line {exc.lineno}: {exc.message}") from exc
        cache.COMPILED.put(key, template, size=0)
    try:
        return template.render(**data)
    except UndefinedError as exc:
        raise TemplateRenderError(f"Missing placeholder value: {exc.message}") from exc
    except SecurityError as exc:
        raise TemplateRenderError(f"Template uses a forbidden construct: {exc}") from exc
    except barcodes.BarcodeError as exc:
        # A symbol the data cannot encode is the template author's problem, not
        # a server fault: surface it like any other template error.
        raise TemplateRenderError(f"Barcode error: {exc}") from exc
    except OverflowError as exc:
        # The sandbox refuses range() above MAX_RANGE (100_000) — a real guard
        # against a template that would build an enormous document. It arrives
        # as a bare OverflowError, which without this became a 500: the caller
        # would be told the server broke, when what they need to hear is which
        # part of their template to fix.
        raise TemplateRenderError(f"Template asks for too much at once: {exc}") from exc


def extract_placeholders(template_source: str) -> list[str]:
    """Top-level variables the template expects; the integration contract."""
    env = _make_environment(strict=False)
    try:
        ast = env.parse(template_source)
    except TemplateSyntaxError as exc:
        raise TemplateRenderError(f"Template syntax error at line {exc.lineno}: {exc.message}") from exc
    return sorted(meta.find_undeclared_variables(ast))
