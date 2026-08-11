// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { RUNNING_ATTR, markRunning, runningBoxCss, runningNameOf, slotsByName } from './running'

const CSS =
  '@page { size: A4; margin: 26mm 18mm; @top-center { content: element(lf-header) } ' +
  '@bottom-left { content: element(lf-footer) } ' +
  '@bottom-center { content: "Page " counter(page) } }\n' +
  '.foot { position: running(lf-footer) }'

function bodyOf(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('which box pulls which element', () => {
  it('reads the margin boxes that name an element', () => {
    const slots = slotsByName(CSS)
    expect(slots.get('lf-header')).toEqual({ edge: 'top', place: 'center' })
    expect(slots.get('lf-footer')).toEqual({ edge: 'bottom', place: 'left' })
  })

  it('ignores a margin box holding text rather than an element', () => {
    // @bottom-center here is a page number, not a running element.
    expect(slotsByName(CSS).size).toBe(2)
  })
})

describe('finding the running elements', () => {
  it('reads the name from the element own style', () => {
    const body = bodyOf('<div style="position: running(lf-header); color: #555">head</div>')
    expect(runningNameOf(body.firstElementChild!, CSS)).toBe('lf-header')
  })

  it('reads it from a rule in the stylesheet too', () => {
    const body = bodyOf('<div class="foot">Confidential</div>')
    expect(runningNameOf(body.firstElementChild!, CSS)).toBe('lf-footer')
  })

  it('is null for an ordinary element', () => {
    expect(runningNameOf(bodyOf('<p>text</p>').firstElementChild!, CSS)).toBeNull()
  })
})

describe('marking them for the canvas', () => {
  it('tags each with the corner it belongs to', () => {
    const body = bodyOf(
      '<div style="position: running(lf-header)">head</div><div class="foot">foot</div><p>body</p>',
    )
    expect(markRunning(body, CSS)).toBe(2)
    const tags = Array.from(body.querySelectorAll(`[${RUNNING_ATTR}]`)).map((el) =>
      el.getAttribute(RUNNING_ATTR),
    )
    expect(tags).toEqual(['top-center', 'bottom-left'])
    expect(body.querySelector('p')!.hasAttribute(RUNNING_ATTR)).toBe(false)
  })

  it('marks one that no margin box pulls, rather than drawing it as ordinary text', () => {
    // Running but orphaned: it prints nowhere at all, which is a mistake worth
    // seeing in the editor rather than in a PDF.
    const body = bodyOf('<div style="position: running(nobody)">stray</div>')
    expect(markRunning(body, CSS)).toBe(0)
    expect(body.firstElementChild!.getAttribute(RUNNING_ATTR)).toBe('unplaced')
  })

  it('takes the tag off again when the element stops being running', () => {
    const body = bodyOf('<div style="position: running(lf-header)">head</div>')
    markRunning(body, CSS)
    body.firstElementChild!.setAttribute('style', 'color: #555')
    markRunning(body, CSS)
    expect(body.firstElementChild!.hasAttribute(RUNNING_ATTR)).toBe(false)
  })
})

describe('where the bands are', () => {
  it('puts the top band above the page area and the bottom one a page down', () => {
    const css = runningBoxCss({ top: 98, bottom: 98, usable: 927 })
    expect(css).toContain('top: -98px')
    expect(css).toContain('top: 927px')
  })

  it('falls back to the end of the content when the page has no height', () => {
    expect(runningBoxCss({ top: 40, bottom: 40, usable: null })).toContain('bottom: -40px')
  })
})

describe('marking again', () => {
  it('writes nothing when nothing changed', () => {
    // An unconditional setAttribute still raises a mutation record, and the
    // canvas treats those as edits — so re-marking would loop with the
    // observer that triggers it. This is that loop, in one assertion.
    const body = bodyOf('<div style="position: running(lf-header)">head</div>')
    markRunning(body, CSS)
    let writes = 0
    const observer = new MutationObserver((records) => (writes += records.length))
    observer.observe(body, { subtree: true, attributes: true })
    markRunning(body, CSS)
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        observer.disconnect()
        expect(writes).toBe(0)
        resolve()
      }, 0),
    )
  })
})
