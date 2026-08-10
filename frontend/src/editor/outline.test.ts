import { describe, expect, it } from 'vitest'
import { CROWDED, detailFor, labelFor, outlineOf, selectableChildren } from './outline'

function bodyOf(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

const alwaysOpen = () => true
const neverOpen = () => false

describe('what the outline lists', () => {
  it('lists what a click can select, and nothing else', () => {
    // <span> is not selectable in the canvas, so it is not a row here either —
    // a list offering something the canvas cannot select is a second model of
    // the document.
    const body = bodyOf('<h1>Title</h1><span>loose text</span><p>Body</p>')
    expect(outlineOf(body, alwaysOpen).map((i) => i.label)).toEqual(['Heading 1', 'Paragraph'])
  })

  it('steps through a wrapper nobody can select', () => {
    // The parser inserts <tbody> whether or not the author wrote one. Showing it
    // would add a nameless level to walk past on the way to the row.
    const body = bodyOf('<table><tbody><tr><td>cell</td></tr></tbody></table>')
    const found = outlineOf(body, alwaysOpen)
    expect(found.map((i) => [i.label, i.depth])).toEqual([
      ['Table', 0],
      ['Row', 1],
      ['Cell', 2],
    ])
  })

  it('leaves a closed container closed and still says it has parts', () => {
    const body = bodyOf('<table><tr><td>cell</td></tr></table>')
    const [table] = outlineOf(body, neverOpen)
    expect(table.label).toBe('Table')
    expect(table.container).toBe(true)
    expect(outlineOf(body, neverOpen)).toHaveLength(1)
  })

  it('reports how many parts a container has, so the crowded ones can close', () => {
    const rows = Array.from({ length: CROWDED + 3 }, () => '<tr><td>x</td></tr>').join('')
    const body = bodyOf(`<table>${rows}</table>`)
    const seen: number[] = []
    outlineOf(body, (_el, children) => {
      seen.push(children)
      return false
    })
    expect(seen).toEqual([CROWDED + 3])
  })

  it('stops rather than rendering a runaway document into the panel', () => {
    const body = bodyOf('<p>x</p>'.repeat(5000))
    const found = outlineOf(body, alwaysOpen)
    expect(found.length).toBeGreaterThan(1000)
    expect(found.length).toBeLessThan(5000)
  })
})

describe('what each row is called', () => {
  it('names the tag rather than calling everything a block', () => {
    const body = bodyOf('<h2>a</h2><p>b</p><ul><li>c</li></ul><hr><div>d</div>')
    expect(outlineOf(body, alwaysOpen).map((i) => i.label)).toEqual([
      'Heading 2',
      'Paragraph',
      'List',
      'List item',
      'Divider',
      'Block',
    ])
  })

  it('calls a page break a page break, not an empty div', () => {
    const body = bodyOf('<div data-lf-pagebreak="" style="break-after: page"></div>')
    expect(labelFor(body.firstElementChild as HTMLElement)).toBe('Page break')
  })

  it('says when something repeats on every printed page', () => {
    const fromBlock = bodyOf('<div data-lf-running="header">x</div>')
    expect(labelFor(fromBlock.firstElementChild as HTMLElement)).toBe('Page header')
    // A template written by hand carries the running position and no badge.
    const authored = bodyOf('<div style="position: running(lf-footer)">x</div>')
    expect(labelFor(authored.firstElementChild as HTMLElement)).toBe('Repeats on every page')
  })

  it('names Jinja by what it holds', () => {
    // The row has to be written inside a table: a bare <tr> is dropped by the
    // parser, which is worth remembering before writing any DOM fixture here.
    const body = bodyOf(
      '<table><tr data-jinja-for="row in metrics"><td>x</td></tr></table>' +
        '<p><span data-jinja-expr="company"></span></p>',
    )
    const loop = outlineOf(body, alwaysOpen).find((i) => i.kind === 'loop')!
    expect([loop.label, loop.detail, loop.depth]).toEqual(['Repeating', 'row in metrics', 1])
    expect(detailFor(body.querySelector('[data-jinja-expr]')!)).toBe('company')
  })

  it('shows a recognisable tail of an image rather than the whole reference', () => {
    const long = bodyOf('<img src="asset://3f8a2b1c9d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829">')
    expect(detailFor(long.firstElementChild as HTMLElement).length).toBeLessThan(50)
    const named = bodyOf('<img src="/x/logo.png" alt="Company logo">')
    expect(detailFor(named.firstElementChild as HTMLElement)).toBe('Company logo')
  })

  it('collapses whitespace and cuts long text', () => {
    const body = bodyOf(`<p>  one\n  two   three  ${'long '.repeat(40)}</p>`)
    const detail = detailFor(body.firstElementChild as HTMLElement)
    expect(detail.startsWith('one two three')).toBe(true)
    expect(detail.length).toBeLessThanOrEqual(44)
    expect(detail.endsWith('…')).toBe(true)
  })
})

describe('selectableChildren', () => {
  it('finds the nearest selectable descendants across several dead levels', () => {
    const body = bodyOf('<table><thead><tr><th>h</th></tr></thead></table>')
    const table = body.firstElementChild!
    expect(selectableChildren(table).map((el) => el.tagName)).toEqual(['TR'])
  })

  it('never returns a canvas-only spacer', () => {
    const body = bodyOf('<div><div data-lf-spacer="1"></div><p>real</p></div>')
    expect(selectableChildren(body.firstElementChild!).map((el) => el.tagName)).toEqual(['P'])
  })
})
