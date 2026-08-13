import { describe, expect, it } from 'vitest'
import { proposalCaveats } from './proposal'

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
