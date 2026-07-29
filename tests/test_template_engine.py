import pytest

from app.services.template_engine import (
    TemplateRenderError,
    extract_placeholders,
    render_html,
)


def test_basic_substitution():
    html = render_html("<h1>Invoice #{{ number }}</h1>", {"number": 42})
    assert html == "<h1>Invoice #42</h1>"


def test_loops_and_conditions():
    src = "{% for item in items %}<li>{{ item.name }}: {{ item.qty }}</li>{% endfor %}"
    html = render_html(src, {"items": [{"name": "A", "qty": 1}, {"name": "B", "qty": 2}]})
    assert html == "<li>A: 1</li><li>B: 2</li>"


def test_values_are_html_escaped():
    html = render_html("<p>{{ name }}</p>", {"name": "<script>alert(1)</script>"})
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_missing_placeholder_strict_fails():
    with pytest.raises(TemplateRenderError, match="Missing placeholder"):
        render_html("<p>{{ absent }}</p>", {}, strict=True)


def test_missing_placeholder_lenient_renders_empty():
    assert render_html("<p>{{ absent }}</p>", {}, strict=False) == "<p></p>"


def test_syntax_error_reports_line():
    with pytest.raises(TemplateRenderError, match="line 1"):
        render_html("{% for %}", {})


@pytest.mark.parametrize(
    "payload",
    [
        "{{ ''.__class__.__mro__ }}",
        "{{ cycler.__init__.__globals__ }}",
        "{{ joiner.__init__.__globals__.os }}",
        "{% for x in ().__class__.__base__.__subclasses__() %}{{ x }}{% endfor %}",
    ],
)
def test_sandbox_blocks_ssti(payload):
    with pytest.raises(TemplateRenderError):
        render_html(payload, {})


def test_extract_placeholders():
    src = "{{ customer }} {% for i in items %}{{ i.price }}{% endfor %} {{ total }}"
    assert extract_placeholders(src) == ["customer", "items", "total"]


def test_version_cache_does_not_serve_another_template_with_the_same_id():
    """Compiled versions are cached by version id, which is a primary key of one
    particular database. A process can outlive that database — a restored
    backup, a repointed instance, a fresh test schema — and then id 1 is a
    different template. The cache must miss, not hand back the old document.

    This is not hypothetical: it surfaced as three unrelated tests failing
    because an earlier test had cached its own template under version id 1.
    """
    from app.services.template_engine import render_version_html

    first = render_version_html(1, "<p>first template</p>", {}, strict=False)
    second = render_version_html(1, "<p>second template</p>", {}, strict=False)
    assert "first" in first
    assert "second" in second, "the cache served the previous template for this id"

    # Re-rendering the original source still works (both remain cacheable).
    assert "first" in render_version_html(1, "<p>first template</p>", {}, strict=False)
