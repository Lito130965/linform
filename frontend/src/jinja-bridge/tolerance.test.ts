// @vitest-environment jsdom
/** Stage 2 tolerance: constructs the editor cannot represent are preserved as
 * inert raw chips rather than forcing the whole template code-only. The bar is
 * byte-exact round-trip — a macro must come back exactly as it went in. */

import { describe, expect, it } from 'vitest'
import { detect, protect, restore } from './bridge'

/** Simulate the DOM leg: parse and re-serialize, as the canvas iframe does. */
function throughDom(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return el.innerHTML
}

function roundtrips(html: string): void {
  expect(detect(html).supported).toBe(true)
  const protectedHtml = protect(html)
  // Direct round-trip (no DOM): the string-level inverse must hold.
  expect(restore(protectedHtml)).toBe(html)
  // And through the DOM, which is how the editor actually uses it.
  expect(restore(throughDom(protectedHtml))).toBe(html)
}

describe('macro definitions are tolerated, not code-only', () => {
  it('a simple macro round-trips byte-exact', () => {
    roundtrips(
      '{% macro boxes(value, count) %}' +
        '<span class="sq">{{ value }}</span>' +
        '{% endmacro %}\n<p>Body {{ name }}</p>',
    )
  })

  it('a macro whose body has a nested for-loop stays intact', () => {
    roundtrips(
      "{%- macro boxes(value, count) -%}\n" +
        "  {% set v = value | default('') | string | upper %}\n" +
        '  {% for i in range(count) %}<span class="sq">{{ v[i] }}</span>{% endfor %}\n' +
        '{%- endmacro -%}\n' +
        '<div>{{ boxes(code, 12) }}</div>',
    )
  })

  it('a for-loop OUTSIDE the macro still folds to an attribute', () => {
    const html =
      '{% macro cell(x) %}<td>{{ x }}</td>{% endmacro %}' +
      '<table><tbody>{% for r in rows %}<tr><td>{{ r }}</td></tr>{% endfor %}</tbody></table>'
    roundtrips(html)
    // The real loop became a chip-less attribute; the macro became a raw chip.
    const p = protect(html)
    expect(p).toContain('data-jinja-for')
    expect(p).toContain('data-jinja-raw')
  })
})

describe('set, comments and unsupported statements', () => {
  it('a standalone set assignment round-trips', () => {
    roundtrips("{% set total = a + b %}\n<p>{{ total }}</p>")
  })

  it('a comment round-trips', () => {
    roundtrips('<p>before</p>{# a note about {{ x }} #}<p>after</p>')
  })

  it('an unsupported statement (include) is preserved, not rejected', () => {
    roundtrips('<div>{% include "header.html" %}</div>')
  })
})

describe('the safety valve still closes on genuinely unrepresentable cases', () => {
  it('a macro opened inside a tag attribute stays code-only', () => {
    // No text-context wrapping is byte-safe here.
    const html = '<div class="{% macro x() %}oops{% endmacro %}">y</div>'
    expect(detect(html).supported).toBe(false)
  })

  it('an unbalanced macro is a reason, not a silent chip', () => {
    const r = detect('{% macro x() %}<p>no end</p>')
    expect(r.supported).toBe(false)
    expect(r.reasons.join(' ')).toContain('macro')
  })

  it('a for-loop that crosses element boundaries is still code-only', () => {
    const html = '<table>{% for r in rows %}<tr><td>a</td>{% endfor %}</table>'
    expect(detect(html).supported).toBe(false)
  })
})

describe('a real-shaped government form template', () => {
  // The shape of kz_withdrawal_ai / tax_report_withdrawal: macros up top,
  // then markup that calls them. Previously all code-only; now editable.
  const html =
    "{%- macro boxes(value, count) -%}{%- set v = value | default('') | string | upper -%}" +
    '{% for i in range(count) %}<span class="sq">{{ v[i] if i < v|length else "" }}</span>{% endfor %}' +
    '{%- endmacro -%}\n' +
    '{%- macro mark(cond) -%}<span class="cb">{{ "X" if cond else "" }}</span>{%- endmacro -%}\n' +
    '<div class="page"><h1>Заявление</h1>' +
    '<div class="row">ИИН: {{ boxes(iin, 12) }}</div>' +
    '{% if resident %}<div>Резидент {{ mark(true) }}</div>{% endif %}' +
    '</div>'

  it('is now representable and round-trips byte-exact', () => {
    roundtrips(html)
  })

  it('exposes the real content for editing while hiding macro bodies', () => {
    const p = protect(html)
    // Two macros → two raw chips; the calling markup is live.
    expect((p.match(/data-jinja-raw/g) ?? []).length).toBe(2)
    expect(p).toContain('data-jinja-if') // the {% if resident %} is real
    expect(p).toContain('<h1>Заявление</h1>')
  })
})
