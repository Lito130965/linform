import { expect, test } from '@playwright/test'
import {
  backToCode,
  createTemplate,
  enterVisual,
  exampleData,
  exampleHtml,
  latestDraftHtml,
  normalizeBenign,
  openTemplate,
  saveDraft,
  uniqueCode,
} from './support'

/**
 * The bet this whole editor is placed on: opening a template in the visual
 * canvas and closing it again does not rewrite the author's markup.
 *
 * Unit tests already assert this over strings and jsdom. What they cannot
 * assert is that a REAL browser — with real layout, the real contenteditable
 * behaviour and the real canvas affordances — leaves the document alone. That
 * is what this does.
 *
 * The comparison goes through the API rather than reading CodeMirror's DOM:
 * CodeMirror virtualizes long documents, so the editor's visible text is not
 * the document. Saving and fetching the stored version is both exact and
 * closer to what a user would actually end up with.
 *
 * Two assertions, because they say different things:
 *  - the first visit may only make the NAMED benign normalizations the project
 *    documents (see normalizeBenign, mirroring spike.test.ts);
 *  - a second visit must change nothing at all, byte for byte. That is the
 *    guarantee that matters in practice: a template does not drift a little
 *    further every time somebody opens it.
 */
test.describe('visual round trip', () => {
  for (const example of ['invoice', 'govform', 'colormatrix']) {
    test(`${example}: a visual visit makes no unrecognised change`, async ({ page, request }) => {
      const code = uniqueCode(`rt-${example}`)
      const original = exampleHtml(example)
      await createTemplate(request, code, original)

      await openTemplate(page, code)
      await enterVisual(page)
      await backToCode(page)
      await saveDraft(page, 'visual visit, no edits')

      // Saving lands in a draft: a visual visit is work in progress until
      // somebody publishes it, which is exactly the point of the split.
      const after = await latestDraftHtml(request, code)

      expect(
        normalizeBenign(after),
        'the visual editor changed markup beyond the documented benign normalizations',
      ).toBe(normalizeBenign(original))
    })

    test(`${example}: a second visit changes nothing at all`, async ({ page, request }) => {
      const code = uniqueCode(`stable-${example}`)
      await createTemplate(request, code, exampleHtml(example))

      // First visit: settles the template into its normalized form.
      await openTemplate(page, code)
      await enterVisual(page)
      await backToCode(page)
      await saveDraft(page, 'first visit')
      const settled = await latestDraftHtml(request, code)

      // Second visit over that form must be a no-op, byte for byte.
      await page.reload()
      await openTemplate(page, code)
      await enterVisual(page)
      await backToCode(page)
      await saveDraft(page, 'second visit')
      const again = await latestDraftHtml(request, code)

      expect(again, 'the template drifts a little further on every visit').toBe(settled)
    })
  }
})

test('an edit in the canvas changes that text and nothing else', async ({ page, request }) => {
  const code = uniqueCode('edit')
  const original = exampleHtml('colormatrix')
  await createTemplate(request, code, original)

  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator('iframe[title="template canvas"]')
  const heading = frame.locator('h1').first()
  await expect(heading).toBeVisible()
  await heading.click()

  // Place the caret at the end of the heading's own text before typing.
  // Clicking alone selects the node in the editor's structural model, and a
  // bare End/type then lands wherever the caret happened to be — the first
  // version of this test silently typed into the following block.
  await heading.evaluate((el) => {
    const doc = el.ownerDocument
    const range = doc.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const selection = doc.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  // Real keystrokes from here: the app's own handlers do the work.
  await page.keyboard.type(' EDITED')
  await expect(heading).toContainText('EDITED')

  await backToCode(page)
  await saveDraft(page, 'edited the heading')
  const after = await latestDraftHtml(request, code)

  expect(after).toContain('EDITED')
  // Everything else survived: removing the insertion must return the document
  // the editor started from. Normalize FIRST — a space typed at the end of a
  // text node arrives as &nbsp;, so stripping " EDITED" from the raw bytes
  // would miss it and report the whole heading as changed.
  expect(normalizeBenign(after).replace(' EDITED', '')).toBe(normalizeBenign(original))
})

test('a Jinja loop survives a visual visit intact', async ({ page, request }) => {
  const code = uniqueCode('loop')
  const original = exampleHtml('invoice')
  await createTemplate(request, code, original)

  await openTemplate(page, code)
  await enterVisual(page)
  await backToCode(page)
  await saveDraft(page)

  const after = await latestDraftHtml(request, code)
  // The constructs the bridge folds into attributes and must unfold again.
  expect(after).toContain('{% for item in items %}')
  expect(after).toContain('{% endfor %}')
  expect(after).toContain('{% if discount %}')
  expect(after).toContain('{{ item.description }}')
  // And the loop still renders — with the example's own payload. A partial one
  // would fail on `{{ seller.name }}` even in non-strict mode, since Jinja's
  // default Undefined raises on attribute access, and that would look like a
  // round-trip defect when it is only a thin fixture.
  const rendered = await request.post(`/api/render`, {
    data: { html: after, data: JSON.parse(exampleData('invoice')), strict: false },
  })
  expect(rendered.ok(), `render after round trip: ${rendered.status()}`).toBeTruthy()
})
