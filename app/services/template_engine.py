"""Data substitution: HTML template with {{ placeholders }} + JSON payload -> final HTML.

Templates are user-supplied and therefore untrusted code. Everything here goes
through Jinja2's SandboxedEnvironment — never a plain Environment.
"""

from jinja2 import StrictUndefined, TemplateSyntaxError, Undefined, meta
from jinja2.exceptions import SecurityError, UndefinedError
from jinja2.sandbox import SandboxedEnvironment


class TemplateRenderError(Exception):
    """Template failed to compile or render; message is safe to show the client."""


def _make_environment(strict: bool) -> SandboxedEnvironment:
    return SandboxedEnvironment(
        autoescape=True,
        undefined=StrictUndefined if strict else Undefined,
    )


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


def validate_template(template_source: str) -> None:
    """Compile check without rendering; raises TemplateRenderError if broken."""
    env = _make_environment(strict=False)
    try:
        env.from_string(template_source)
    except TemplateSyntaxError as exc:
        raise TemplateRenderError(f"Template syntax error at line {exc.lineno}: {exc.message}") from exc


# Versions are immutable, so a compiled template cached by version id can
# never go stale. Bounded so ad-hoc churn can't grow it unboundedly.
_MAX_CACHED = 256
_compiled_cache: dict[tuple[int, bool], object] = {}


def render_version_html(version_id: int, template_source: str, data: dict, *, strict: bool = True) -> str:
    key = (version_id, strict)
    template = _compiled_cache.get(key)
    if template is None:
        env = _make_environment(strict)
        try:
            template = env.from_string(template_source)
        except TemplateSyntaxError as exc:
            raise TemplateRenderError(f"Template syntax error at line {exc.lineno}: {exc.message}") from exc
        if len(_compiled_cache) >= _MAX_CACHED:
            _compiled_cache.pop(next(iter(_compiled_cache)))
        _compiled_cache[key] = template
    try:
        return template.render(**data)
    except UndefinedError as exc:
        raise TemplateRenderError(f"Missing placeholder value: {exc.message}") from exc
    except SecurityError as exc:
        raise TemplateRenderError(f"Template uses a forbidden construct: {exc}") from exc


def extract_placeholders(template_source: str) -> list[str]:
    """Top-level variables the template expects; the integration contract."""
    env = _make_environment(strict=False)
    try:
        ast = env.parse(template_source)
    except TemplateSyntaxError as exc:
        raise TemplateRenderError(f"Template syntax error at line {exc.lineno}: {exc.message}") from exc
    return sorted(meta.find_undeclared_variables(ast))
