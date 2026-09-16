import { describe, expect, it } from 'vitest'
import { newCaveats, proposalCaveats } from './proposal'

const PAGE = '<style>@page { size: A4; margin: 20mm; %s }</style>\n<h1>Report</h1>\n'

describe('what a proposed template will cost', () => {
  it('says nothing about a template that stays editable', () => {
    expect(proposalCaveats(PAGE.replace('%s', ''))).toEqual([])
  })

  it('catches a page number written as a margin-box string', () => {
    // The exact thing that was reported as "Page ⟨1⟩ of ⟨N⟩ cannot be edited":
    // it prints and the editor can do nothing with it.
    const found = proposalCaveats(
      PAGE.replace('%s', '@bottom-center { content: "Page " counter(page) }'),
    )
    expect(found).toHaveLength(1)
    expect(found[0].what).toContain('margin box')
    expect(found[0].cost).toContain('select, move or restyle')
  })

  it('leaves a margin box that pulls a running element alone', () => {
    // That is the editor's own footer — the one the header switch writes.
    const found = proposalCaveats(
      PAGE.replace('%s', '@bottom-center { content: element(lf-footer); width: 100% }') +
        '<div style="position: running(lf-footer)">Confidential</div>',
    )
    expect(found).toEqual([])
  })

  // A Jinja block inside an attribute: the canvas has no way to represent it,
  // where a macro at the top level survives as a raw region.
  const CODE_ONLY = '<td class="{% if wide %}wide{% endif %}">x</td>'

  it('says when applying would close Visual mode', () => {
    const found = proposalCaveats(PAGE.replace('%s', '') + CODE_ONLY)
    expect(found).toHaveLength(1)
    expect(found[0].cost).toContain('code-only')
  })

  it('reports both when both are true', () => {
    const found = proposalCaveats(
      PAGE.replace('%s', '@top-right { content: "DRAFT" }') + CODE_ONLY,
    )
    expect(found).toHaveLength(2)
  })
})

describe('what a change introduced', () => {
  const CELL = '<table><tr><td class="num">{{ item.amount }}%s</td></tr></table>'

  it('says nothing when the document was already code-only', () => {
    // The caveat is about the change, not about the file. A template that
    // could not open in Visual before the edit did not lose anything.
    const broken = CELL.replace('%s', '{% if item.paid %}x{% endif %}')
    expect(newCaveats(broken, broken + '<p>more</p>')).toEqual([])
  })

  it('names what an edit has just cost', () => {
    const found = newCaveats(
      CELL.replace('%s', ''),
      CELL.replace('%s', '{% if item.paid %}✓{% endif %}'),
    )
    expect(found).toHaveLength(1)
    expect(found[0].cost).toContain('code-only')
  })

  it('is quiet about an edit that keeps the document editable', () => {
    // The markup the checkbox preset writes: an expression, not a statement,
    // so there is no block to match against an element.
    const found = newCaveats(
      CELL.replace('%s', ''),
      CELL.replace('%s', "{{ '☑' if item.paid else '☐' }}"),
    )
    expect(found).toEqual([])
  })
})
