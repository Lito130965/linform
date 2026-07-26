// @vitest-environment jsdom
/** Every preset must generate Способ A markup the bridge already round-trips:
 * detect() accepts it, and restore(protect(source)) returns the source
 * byte-for-byte. That is the whole contract — a preset adds no new work to the
 * bridge, only a convenient way to author what it already handles. */

import { describe, expect, it } from 'vitest'
import { detect, protect, restore } from '../jinja-bridge/bridge'
import { PRESETS } from './registry'

function throughDom(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return el.innerHTML
}

describe('every preset round-trips through the bridge', () => {
  for (const preset of PRESETS) {
    it(`${preset.id}: detect passes and restore∘protect is identity`, () => {
      const source = preset.generate({})
      expect(detect(source).supported).toBe(true)
      expect(restore(protect(source))).toBe(source)
    })
  }
})

describe('generated Jinja is what we expect', () => {
  const gen = (id: string, params: Record<string, string> = {}) =>
    PRESETS.find((p) => p.id === id)!.generate(params)

  it('repeating table wraps a single body row in a for', () => {
    const s = gen('dynamic-table', { array: 'rows', item: 'r', columns: 'a, b' })
    expect(s).toContain('{% for r in rows %}<tr><td>{{ r.a }}</td><td>{{ r.b }}</td></tr>{% endfor %}')
    expect(s).toContain('<th>a</th><th>b</th>')
  })

  it('pad-rows iterates the gap up to the target count', () => {
    expect(gen('fill-rows', { array: 'items', total: '8', columns: '3' })).toBe(
      '{% for _ in range(items|length, 8) %}<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>{% endfor %}',
    )
  })

  it('character cells never wrap and hold one glyph each', () => {
    const s = gen('char-cells', { value: 'iin' })
    expect(s).toContain('white-space:nowrap')
    expect(s).toContain('{% for ch in iin %}')
    expect(s).toContain('{{ ch }}')
  })

  it('value-or-dash is presentation, not a threshold', () => {
    expect(gen('present-if', { value: 'total' })).toBe("{{ total if total else '—' }}")
  })

  it('checkbox reflects a boolean field', () => {
    expect(gen('checkbox', { condition: 'agreed' })).toBe("{{ '☑' if agreed else '☐' }}")
  })

  it('conditional section shows only when the field is present', () => {
    expect(gen('conditional', { condition: 'note' })).toBe('{% if note %}<div>{{ note }}</div>{% endif %}')
  })

  it('qr and barcode call the server filters on a value', () => {
    expect(gen('qr', { value: 'oid', size: '30' })).toBe('<img src="{{ oid | qr }}" style="width:30mm">')
    expect(gen('barcode', { value: 't' })).toContain("barcode('code128', text=True)")
  })
})

describe('self-contained presets also survive the DOM leg', () => {
  // A bare <tr> (pad-rows) is foster-parented without a table, so only the
  // presets that are whole elements are DOM-round-tripped here.
  for (const id of ['dynamic-table', 'char-cells', 'present-if', 'checkbox', 'conditional', 'qr']) {
    it(`${id} round-trips through parse+serialize`, () => {
      const source = PRESETS.find((p) => p.id === id)!.generate({})
      expect(restore(throughDom(protect(source)))).toBe(source)
    })
  }
})
