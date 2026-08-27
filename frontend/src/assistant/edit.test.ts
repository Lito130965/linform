import { describe, expect, it } from 'vitest'
import { applyEdit, describeEdit } from './edit'

const DOC = [
  '<table class="data">',
  '  <thead>',
  '    <tr><th>Metric</th><th class="num">This quarter</th></tr>',
  '  </thead>',
  '  <tbody>',
  '    {% for row in metrics %}<tr><td>{{ row.name }}</td></tr>{% endfor %}',
  '  </tbody>',
  '</table>',
].join('\n')

describe('changing one part of a document', () => {
  it('puts the new text exactly where the old text was', () => {
    const result = applyEdit(
      DOC,
      '<th class="num">This quarter</th>',
      '<th class="num">This quarter</th><th>Flag</th>',
    )
    expect('html' in result && result.html).toContain('This quarter</th><th>Flag</th>')
    // And nothing else moved.
    expect('html' in result && result.html.split('\n').length).toBe(DOC.split('\n').length)
  })

  it('does not mind how the quoted text was wrapped', () => {
    // Models reflow markup as they quote it. Refusing an edit over a line break
    // would make this useless for exactly the templates it is for.
    const result = applyEdit(DOC, '<tr><th>Metric</th>\n   <th class="num">This quarter</th></tr>', '<tr><th>Metric</th></tr>')
    expect('html' in result).toBe(true)
  })

  it('refuses text that is not there, by name', () => {
    const result = applyEdit(DOC, '<th>Total</th>', '<th>Sum</th>')
    expect('error' in result && result.error).toContain('not in the document')
  })

  it('refuses text that names more than one place', () => {
    // Changing the first of three identical rows and calling it done is the
    // failure this exists to avoid.
    const three = '<td>x</td>\n<td>x</td>\n<td>x</td>'
    const result = applyEdit(three, '<td>x</td>', '<td>y</td>')
    expect('error' in result && result.error).toContain('appears 3 times')
  })

  it('leaves dollar signs in the new text alone', () => {
    // `$&` in a replacement string means "the match" — a template full of
    // prices would quietly grow copies of itself.
    const result = applyEdit('<p>total</p>', '<p>total</p>', '<p>$& and $1</p>')
    expect('html' in result && result.html).toBe('<p>$& and $1</p>')
  })

  it('splices into the original bytes, so the rest is untouched', () => {
    // Matching happens on a whitespace-normalised copy. If the edit were
    // applied there, every document would come back reformatted by the act of
    // changing one cell in it.
    const spaced = '<div>\n\n    <p>one</p>\n\n    <p>two</p>\n\n</div>'
    const result = applyEdit(spaced, '<p>one</p>', '<p>ONE</p>')
    expect('html' in result && result.html).toBe(
      '<div>\n\n    <p>ONE</p>\n\n    <p>two</p>\n\n</div>',
    )
  })

  it('refuses an empty search rather than matching everywhere', () => {
    expect('error' in applyEdit(DOC, '   ', 'x')).toBe(true)
  })
})

describe('saying what an edit does', () => {
  it('says what is being removed', () => {
    expect(describeEdit('<th>Flag</th>', '')).toContain('Remove')
  })

  it('says what is being added, not merely where', () => {
    // The anchor alone leaves somebody to work out what became of it; the new
    // column is the thing they asked for.
    const line = describeEdit('<th>A</th>', '<th>A</th><th>Flag</th>')
    expect(line).toContain('Add')
    expect(line).toContain('<th>Flag</th>')
    expect(line).toContain('after')
    expect(describeEdit('<td>x</td>', '<td>new</td><td>x</td>')).toContain('before')
  })

  it('says both halves when something is genuinely replaced', () => {
    const line = describeEdit('<h1>Report</h1>', '<h1>Quarterly report</h1>')
    expect(line).toContain('Report')
    expect(line).toContain('Quarterly report')
  })
})
