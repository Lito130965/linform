// @vitest-environment jsdom
/** Unit tests for the custom editor's pure core: selection eligibility and
 * the prepare/export inverse pair that the round-trip fidelity rests on. */

import { describe, expect, it } from 'vitest'
import { exportBody, prepareBody, prepareFragment } from './export-body'
import { findSelectable, kindOf, parentSelectable } from './selection'
import { PAGE_FORMATS, formatFromStyles } from './page'

function bodyOf(html: string): HTMLElement {
  const el = document.createElement('body')
  el.innerHTML = html
  return el
}

describe('kindOf', () => {
  it('classifies jinja marks ahead of tags', () => {
    // The tr must live inside a table: the parser drops orphan table parts —
    // the very normalization class the spike documented.
    const b = bodyOf(
      '<table><tbody><tr data-jinja-for="item in items"><td>x</td></tr></tbody></table>' +
        '<div data-jinja-if="flag">y</div>' +
        '<span data-jinja-expr="name">{{ name }}</span>',
    )
    expect(kindOf(b.querySelector('[data-jinja-for]')!)).toBe('loop')
    expect(kindOf(b.querySelector('[data-jinja-if]')!)).toBe('conditional')
    expect(kindOf(b.querySelector('[data-jinja-expr]')!)).toBe('chip')
  })

  it('classifies structural tags and rejects inline text hosts', () => {
    const b = bodyOf('<table><tr><td><p><b>bold</b></p></td></tr></table>')
    expect(kindOf(b.querySelector('table')!)).toBe('table')
    expect(kindOf(b.querySelector('tr')!)).toBe('row')
    expect(kindOf(b.querySelector('td')!)).toBe('cell')
    expect(kindOf(b.querySelector('p')!)).toBe('block')
    expect(kindOf(b.querySelector('b')!)).toBeNull()
  })
})

describe('findSelectable / parentSelectable', () => {
  it('walks from a click target up to the nearest structural node', () => {
    const b = bodyOf('<div><p>some <b>bold</b> text</p></div>')
    const bold = b.querySelector('b')!
    expect(findSelectable(bold, b)).toBe(b.querySelector('p'))
    expect(parentSelectable(b.querySelector('p')!, b)).toBe(b.querySelector('div'))
  })

  it('never selects the body root itself', () => {
    const b = bodyOf('text only')
    expect(findSelectable(b, b)).toBeNull()
  })
})

describe('prepareBody / exportBody are inverse', () => {
  const TEMPLATE =
    '<h1>Invoice {{ number }}</h1>' +
    '<p>Hello <span data-jinja-expr="name">{{ name }}</span></p>' +
    '<table><tbody><tr data-jinja-for="i in items"><td>' +
    '<span data-jinja-expr="i.qty">{{ i.qty }}</span></td></tr></tbody></table>' +
    '<img src="/api/assets/abc" style="width: 40mm">'

  it('export strips exactly what prepare added', () => {
    const b = bodyOf(TEMPLATE)
    const before = b.innerHTML
    prepareBody(b)
    // The affordances really were added…
    expect(b.getAttribute('contenteditable')).toBe('true')
    expect(b.querySelector('[data-jinja-expr]')!.getAttribute('contenteditable')).toBe('false')
    expect(b.querySelector('img')!.getAttribute('draggable')).toBe('false')
    // …and export removes them without touching anything else.
    expect(exportBody(b)).toBe(before)
  })

  it('export drops the selection mark', () => {
    const b = bodyOf(TEMPLATE)
    prepareBody(b)
    b.querySelector('h1')!.setAttribute('data-lf-selected', '')
    expect(exportBody(b)).not.toContain('data-lf-selected')
  })

  it('a qr/barcode image shows a placeholder but exports its real src', () => {
    const b = bodyOf('<p>x</p><img src="{{ order_id | qr }}" style="width:30mm">')
    prepareBody(b)
    const img = b.querySelector('img')!
    // Canvas shows a self-describing SVG placeholder, not the broken Jinja URL.
    expect(img.getAttribute('src')!.startsWith('data:image/svg+xml,')).toBe(true)
    expect(img.getAttribute('data-lf-src')).toBe('{{ order_id | qr }}')
    // Export restores the true expression exactly.
    expect(exportBody(b)).toBe('<p>x</p><img src="{{ order_id | qr }}" style="width:30mm">')
  })

  it('a prepared inserted fragment exports clean too', () => {
    const b = bodyOf(TEMPLATE)
    prepareBody(b)
    const holder = document.createElement('div')
    holder.innerHTML = '<p>new <span data-jinja-expr="x">{{ x }}</span></p>'
    const p = holder.firstElementChild!
    prepareFragment(p)
    b.appendChild(p)
    const out = exportBody(b)
    expect(out).toContain('<p>new <span data-jinja-expr="x">{{ x }}</span></p>')
    expect(out).not.toContain('contenteditable')
  })
})

describe('formatFromStyles', () => {
  it('reads the template @page rule', () => {
    expect(formatFromStyles('@page { size: A4; }')).toBe('A4')
    expect(formatFromStyles('@page{size:a5 landscape}')).toBe('A5 landscape')
    expect(formatFromStyles('@page { size: letter; }')).toBe('Letter')
    expect(formatFromStyles('body{}')).toBe('A4')
  })

  it('every format id resolves to a width entry', () => {
    for (const f of PAGE_FORMATS) {
      expect(typeof f.name).toBe('string')
      expect(f.width === null || f.width > 0).toBe(true)
    }
  })
})
