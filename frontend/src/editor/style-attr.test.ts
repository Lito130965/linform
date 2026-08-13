// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readDeclarations, setDeclaration, setDeclarations, writeDeclarations } from './style-attr'

const el = (style: string): HTMLElement => {
  const node = document.createElement('div')
  if (style) node.setAttribute('style', style)
  return node
}

describe('reading a style attribute as text', () => {
  it('takes each declaration as written', () => {
    expect(readDeclarations('color: red; font-size: 9pt')).toEqual([
      ['color', 'red'],
      ['font-size', '9pt'],
    ])
  })

  it('keeps what the browser cannot parse', () => {
    // The whole reason this module exists: no browser implements running(), so
    // the CSSOM never has it and anything that rebuilds the attribute from the
    // CSSOM throws it away.
    expect(readDeclarations('position: running(lf-footer); color: #888')).toEqual([
      ['position', 'running(lf-footer)'],
      ['color', '#888'],
    ])
  })

  it('is not fooled by a semicolon inside a value', () => {
    const style = 'background: url("data:image/png;base64,AAA"); color: red'
    expect(readDeclarations(style)).toEqual([
      ['background', 'url("data:image/png;base64,AAA")'],
      ['color', 'red'],
    ])
  })

  it('ignores empty and malformed fragments', () => {
    expect(readDeclarations(';; color: red ;;')).toEqual([['color', 'red']])
    expect(readDeclarations('nonsense')).toEqual([])
    expect(readDeclarations('')).toEqual([])
  })
})

describe('writing one back', () => {
  it('changes a property and leaves the rest alone', () => {
    const node = el('position: running(lf-footer); color: #888')
    setDeclaration(node, 'text-align', 'right')
    expect(node.getAttribute('style')).toBe(
      'position: running(lf-footer); color: #888; text-align: right',
    )
  })

  it('replaces a property in place rather than appending a second copy', () => {
    const node = el('color: #888; text-align: left')
    setDeclaration(node, 'text-align', 'center')
    expect(node.getAttribute('style')).toBe('color: #888; text-align: center')
  })

  it('removes a property when the value is empty', () => {
    const node = el('position: running(lf-footer); text-align: right')
    setDeclaration(node, 'text-align', null)
    expect(node.getAttribute('style')).toBe('position: running(lf-footer)')
  })

  it('drops the attribute entirely when nothing is left', () => {
    const node = el('text-align: right')
    setDeclaration(node, 'text-align', '')
    expect(node.hasAttribute('style')).toBe(false)
  })

  it('sets several at once, in one rewrite', () => {
    const node = el('position: running(lf-header)')
    setDeclarations(node, { 'font-size': '9pt', color: '#555', 'font-weight': null })
    expect(node.getAttribute('style')).toBe(
      'position: running(lf-header); font-size: 9pt; color: #555',
    )
  })

  it('keeps a declaration no parser accepts, which is the whole point', () => {
    // The other half of the comparison — that the same edit through el.style
    // loses it — cannot be made here: jsdom's CSSOM keeps the declaration a
    // browser drops. The browser test carries that end of it
    // (e2e/tests/furniture.spec.ts).
    const node = el('position: running(lf-footer); color: #888')
    setDeclaration(node, 'text-align', 'right')
    expect(node.getAttribute('style')).toContain('position: running(lf-footer)')
  })
})

describe('writeDeclarations', () => {
  it('is the inverse of reading', () => {
    const style = 'position: running(x); font-size: 9pt; color: #555'
    expect(writeDeclarations(readDeclarations(style))).toBe(style)
  })
})
