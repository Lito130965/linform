import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders the formatting the assistant actually uses', () => {
    const html = renderMarkdown('**Placeholders:** `day`, `month`\n\n- one\n- two')
    expect(html).toContain('<strong>Placeholders:</strong>')
    expect(html).toContain('<code>day</code>')
    expect(html).toContain('<li>one</li>')
  })

  it('renders fenced code blocks, e.g. the example JSON', () => {
    const html = renderMarkdown('```json\n{"a": 1}\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('{&quot;a&quot;: 1}')
  })

  it('escapes raw HTML instead of trusting model output', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">hi')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('escapes html inside code fences too', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps the template marker readable', () => {
    expect(renderMarkdown('Added a footer.\n\n⟨template⟩')).toContain('⟨template⟩')
  })
})
