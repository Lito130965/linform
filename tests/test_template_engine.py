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
