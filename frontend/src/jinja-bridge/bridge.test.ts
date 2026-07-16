import { describe, expect, it } from 'vitest'
import { detect, fromCanvasAssets, protect, restore, toCanvasAssets } from './bridge'

/** Canonical templates keep block tags adjacent to their element, which is
 * how protect/restore achieves byte-exact round-trips. */
const roundTrip = (html: string) => restore(protect(html))

describe('round-trip: restore(protect(html)) === html', () => {
  it('invoice table with a for-loop and expressions', () => {
    const html =
      '<table><thead><tr><th>Item</th><th>Total</th></tr></thead><tbody>' +
      '{% for item in items %}<tr><td>{{ item.name }}</td><td>{{ item.qty * item.price }}</td></tr>{% endfor %}' +
      '</tbody></table>'
    expect(roundTrip(html)).toBe(html)
  })

  it('if block aligned with an element', () => {
    const html = '<div>{% if discount %}<p>Discount: {{ discount }}%</p>{% endif %}</div>'
    expect(roundTrip(html)).toBe(html)
  })

  it('nested loops on nested elements', () => {
    const html =
      '{% for group in groups %}<section><h2>{{ group.title }}</h2>' +
      '{% for row in group.rows %}<div>{{ row }}</div>{% endfor %}' +
      '</section>{% endfor %}'
    expect(roundTrip(html)).toBe(html)
  })

  it('filters and loop.index survive untouched', () => {
    const html =
      '{% for item in items %}<li>{{ loop.index }}. {{ item.total | round(2) }}</li>{% endfor %}'
    expect(roundTrip(html)).toBe(html)
  })

  it('expression with quotes and comparison operators', () => {
    const html = '<p>{{ data["ключ"] if flag > 2 else "нет" }}</p>'
    expect(roundTrip(html)).toBe(html)
  })

  it('whitespace-control dashes are preserved', () => {
    const html = '<ul>{%- for x in xs -%}<li>{{ x }}</li>{%- endfor -%}</ul>'
    expect(roundTrip(html)).toBe(html)
  })

  it('loop around a void element', () => {
    const html = '{% for u in logos %}<img src="{{ u }}" class="logo">{% endfor %}'
    expect(roundTrip(html)).toBe(html)
  })

  it('expressions in attributes are left alone (DOM-safe already)', () => {
    const html = '<img src="{{ logo_url }}" alt="logo"><a href="/x?id={{ id }}">t</a>'
    expect(protect(html)).toBe(html)
    expect(roundTrip(html)).toBe(html)
  })

  it('style and script contents are never wrapped', () => {
    const html =
      '<style>@page { size: A4; } h1 { color: red; }</style>' +
      '<p>{{ name }}</p>'
    const protectedHtml = protect(html)
    expect(protectedHtml).toContain('@page { size: A4; }')
    expect(protectedHtml).toContain('data-jinja-expr="name"')
    expect(roundTrip(html)).toBe(html)
  })

  it('a full realistic invoice round-trips', () => {
    const html =
      '<style>@page { size: A4; margin: 20mm; } body { font-family: sans-serif; }</style>' +
      '<div class="head"><img src="asset://' + 'a'.repeat(64) + '" style="width:40mm"><h1>Счёт №{{ number }}</h1></div>' +
      '<p>Покупатель: {{ customer }}</p>' +
      '<table><tbody>' +
      '{% for item in items %}<tr><td>{{ loop.index }}</td><td>{{ item.name }}</td><td>{{ item.qty * item.price }}</td></tr>{% endfor %}' +
      '</tbody></table>' +
      '{% if comment %}<p class="note">{{ comment }}</p>{% endif %}' +
      '<p class="total">Итого: {{ total }}</p>'
    expect(roundTrip(html)).toBe(html)
  })
})

describe('protect output shape', () => {
  it('folds the loop into a data attribute on the element', () => {
    const out = protect('{% for item in items %}<tr><td>{{ item.name }}</td></tr>{% endfor %}')
    expect(out).toContain('<tr data-jinja-for="item in items">')
    expect(out).toContain('<span data-jinja-expr="item.name">{{ item.name }}</span>')
    expect(out).not.toContain('{%')
  })

  it('folds if into data-jinja-if', () => {
    const out = protect('{% if vip %}<p>VIP</p>{% endif %}')
    expect(out).toContain('<p data-jinja-if="vip">')
  })
})

describe('detect: honest rejection, never silent loss', () => {
  const rejects = (html: string, reasonPart: string) => {
    const result = detect(html)
    expect(result.supported).toBe(false)
    expect(result.reasons.join('\n')).toContain(reasonPart)
    expect(() => protect(html)).toThrow()
  }

  it('macros are code-only', () => {
    rejects('{% macro boxes(v, n) %}<b>{{ v }}</b>{% endmacro %}<p>x</p>', 'macro')
  })

  it('set is code-only', () => {
    rejects("{% set org = org_name | default('') %}<p>{{ org }}</p>", 'set')
  })

  it('elif/else are code-only for now', () => {
    rejects('{% if a %}<p>a</p>{% else %}<p>b</p>{% endif %}', 'else')
  })

  it('loop crossing element boundaries is code-only', () => {
    rejects('<tr>{% for c in cells %}<td>{{ c }}</td><td>-</td>{% endfor %}</tr>', 'more than one element')
  })

  it('loop not starting at an element is code-only', () => {
    rejects('{% for x in xs %}plain {{ x }} text{% endfor %}', 'element boundary')
  })

  it('jinja comments are code-only', () => {
    rejects('{#- helper -#}<p>{{ x }}</p>', 'comment')
  })

  it('statement inside a tag attribute is code-only', () => {
    rejects('<div {% if wide %}class="wide"{% endif %}>x</div>', 'attribute')
  })

  it('unbalanced blocks are rejected', () => {
    rejects('{% for x in xs %}<p>{{ x }}</p>', 'without a closing tag')
  })

  it('the real KKM form (macros, set, comments) is honestly code-only', () => {
    const kkmLike =
      "{%- macro boxes(value, count) -%}{%- endmacro -%}" +
      "{%- set reason = reason_code | default('') | upper -%}" +
      '<div class="row">{{ boxes(iin_bin, 12) }}</div>'
    const result = detect(kkmLike)
    expect(result.supported).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('supported templates pass', () => {
    const result = detect('{% for i in items %}<li>{{ i }}</li>{% endfor %}')
    expect(result).toEqual({ supported: true, reasons: [] })
  })
})

describe('asset URL rewriting for the canvas', () => {
  const sha = 'ab'.repeat(32)

  it('asset:// becomes a fetchable URL and back', () => {
    const html = `<img src="asset://${sha}">`
    const canvas = toCanvasAssets(html)
    expect(canvas).toBe(`<img src="/api/assets/${sha}">`)
    expect(fromCanvasAssets(canvas)).toBe(html)
  })

  it('does not touch non-asset URLs', () => {
    const html = '<img src="/static/x.png"><img src="data:image/png;base64,AAA">'
    expect(toCanvasAssets(html)).toBe(html)
    expect(fromCanvasAssets(html)).toBe(html)
  })
})
