import { expect, test } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  exampleHtml,
  inspectorTab,
  latestDraftHtml,
  openTemplate,
  saveDraft,
  uniqueCode,
} from './support'

/**
 * Headers and footers, where they print.
 *
 * `position: running(name)` parks an element in a `@page` margin box, and no
 * browser implements it — so in the canvas a footer authored at the top of the
 * body appeared at the top of the document, while the margin band showed a grey
 * "⟨element lf-footer⟩" that could not be clicked, edited or found in the
 * structure. Reported exactly that way, on the report example.
 */

test.use({ viewport: { width: 1680, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'

/** Small on purpose: the report has content near the bands, and a test about
 * where a footer lands should not also depend on what it lands beside. */
const DOC =
  '<style>@page { size: A4; margin: 20mm; margin-bottom: 26mm;\n' +
  '  @bottom-left { content: element(lf-footer) }\n' +
  '  @top-center { content: element(lf-head) } }</style>\n' +
  '<div id="foot" style="position: running(lf-footer)">Confidential</div>\n' +
  '<div id="head" style="position: running(lf-head)">Quarterly report</div>\n' +
  '<h1 id="title">Body of the document</h1>\n'

test('a header and a footer sit in the bands they print in', async ({ page, request }) => {
  const code = uniqueCode('furniture')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await expect(frame.locator('#foot')).toHaveAttribute('data-lf-running', 'bottom-left')
  await expect(frame.locator('#head')).toHaveAttribute('data-lf-running', 'top-center')

  const sheet = (await page.locator(CANVAS).boundingBox())!
  const foot = (await frame.locator('#foot').boundingBox())!
  const head = (await frame.locator('#head').boundingBox())!
  const title = (await frame.locator('#title').boundingBox())!

  // As fractions of the sheet, so the canvas zoom does not enter into it.
  const down = (box: { y: number }) => (box.y - sheet.y) / sheet.height
  expect(down(head)).toBeLessThan(0.1)
  expect(down(title)).toBeGreaterThan(down(head))
  expect(down(foot)).toBeGreaterThan(0.85)
})

test('the strip no longer shows a copy of what is drawn in the page', async ({ page, request }) => {
  // A margin box holding TEXT is still previewed above the sheet — there is no
  // element to draw for it. One holding an element is not: the element itself
  // is in the page now, and a grey copy of it beside the real thing is worse
  // than nothing.
  const code = uniqueCode('furniture-strip')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 20mm; margin-bottom: 26mm;\n' +
      '  @bottom-left { content: element(lf-footer) }\n' +
      '  @top-right { content: \"DRAFT\" } }</style>\n' +
      '<div id=\"foot\" style=\"position: running(lf-footer)\">Confidential</div>\n' +
      '<h1>Report</h1>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  const strips = (await page.locator('.furniture-strip').allInnerTexts()).join(' ')
  expect(strips).toContain('DRAFT')
  expect(strips).not.toContain('element')
  // …and the element is in the page, where it can be clicked.
  await expect(page.frameLocator(CANVAS).locator('#foot')).toHaveAttribute(
    'data-lf-running',
    'bottom-left',
  )
})

test('a footer can be typed into, and is in the structure', async ({ page, request }) => {
  const code = uniqueCode('furniture-edit')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  const footer = frame.locator('#foot')
  await footer.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' — draft')
  await expect(footer).toContainText('draft')

  await inspectorTab(page, 'Structure')
  const outline = page.locator('.canvas-outline .outline-label')
  await expect(outline.filter({ hasText: 'Page header' })).toHaveCount(1)
  await expect(outline.filter({ hasText: 'Page footer' })).toHaveCount(1)

  await saveDraft(page, 'edited the footer')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('draft')
  // Nothing the canvas added to place it went into the template.
  expect(saved).not.toContain('data-lf-running')
})

test('the band itself cannot be nudged, but what is in it can', async ({ page, request }) => {
  // The band is as tall and as wide as the page margin it occupies; a margin on
  // the element would move the whole thing off the corner it is anchored to.
  // Everything inside it is edited like any other content.
  const code = uniqueCode('furniture-locked')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#foot').click()
  await expect(page.locator('.inspector-properties')).toContainText('as tall as the page margin')
  await expect(page.locator('.inspector-properties .box-model')).toHaveCount(0)
  await expect(page.locator('.running-grip')).toHaveCount(0)

  // A paragraph inside it keeps its own box.
  await inspectorTab(page, 'Structure')
  await page.locator('.canvas-outline .outline-row', { hasText: 'Page footer' }).click()
  await page.locator('.insert-tile', { hasText: 'Text' }).click()
  await frame.locator('#foot p').click()
  await inspectorTab(page, 'Properties')
  await expect(page.locator('.inspector-properties .box-model')).toHaveCount(1)
})

test('a Jinja expression is edited in a dialog, not a browser prompt', async ({ page, request }) => {
  const code = uniqueCode('furniture-expr')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n<p id="line">Bill to {{ customer }}</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  // A prompt would block the page and never resolve; if this test can carry on
  // clicking, the dialog is in the document.
  await frame.locator('#line [data-jinja-expr]').dblclick()
  const dialog = page.getByRole('dialog', { name: 'Field' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // The same dialog from the properties bar, for anyone who does not know that
  // a double click does anything.
  await frame.locator('#line [data-jinja-expr]').click()
  await page.locator('.inspector-properties button', { hasText: 'Expression' }).click()
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Field expression').fill('customer.name')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toHaveCount(0)

  await expect(frame.locator('#line [data-jinja-expr]')).toHaveAttribute(
    'data-jinja-expr',
    'customer.name',
  )
  await expect(frame.locator('#line')).toContainText('{{ customer.name }}')

  await saveDraft(page, 'renamed the field')
  expect(await latestDraftHtml(request, code)).toContain('{{ customer.name }}')

})

test('selecting something does not move the page under the pointer', async ({ page, request }) => {
  // Everything above the canvas has to keep its height when a selection
  // appears. It did not: the properties bar arrived with the first click and
  // dropped the sheet 116px, so the second click of a double click landed
  // somewhere else and the canvas document never saw it — which is why editing
  // a field by double-clicking it never worked on the first try.
  const code = uniqueCode('no-jump')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n' +
      '<p id="line">Bill to {{ customer }}</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  const where = async () => (await page.locator(CANVAS).boundingBox())!.y
  const before = await where()
  await frame.locator('#line').click()
  await expect(page.locator('.inspector-properties .props-kind, .inspector-properties .crumbs')).not.toHaveCount(0)
  expect(await where()).toBe(before)

  // And a table cell, which brings the most controls of any selection.
  await frame.locator('#line [data-jinja-expr]').click()
  expect(await where()).toBe(before)
})

test('a header is switched on from the page panel and filled like any block', async ({
  page,
  request,
}) => {
  // The shape somebody actually asks for: a name on the left, a page number in
  // the middle, a code on the right. That is a three-column block inside the
  // header — made of the same parts as the rest of the document, which is why
  // the header is a container rather than a special kind of thing.
  const code = uniqueCode('furniture-on')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 20mm; }</style>\n<h1 id="title">Report</h1>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  await page.locator('.canvas-topbar button', { hasText: 'Page:' }).click()
  await page.locator('.page-setup .furniture-row', { hasText: 'Header' }).getByRole('checkbox').check()

  const frame = page.frameLocator(CANVAS)
  const header = frame.locator('div[style*="running(lf-header)"]')
  await expect(header).toHaveAttribute('data-lf-running', 'top-center')

  // Its height is the top margin, set where the band is switched on.
  await page.locator('.canvas-topbar button', { hasText: 'Page:' }).click()
  await page.getByLabel('Header height in millimetres').fill('30')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await header.boundingBox())!.height).toBeGreaterThan(
    (await frame.locator('#title').boundingBox())!.height,
  )
  await page.keyboard.press('Escape')

  // Three columns inside it, from the palette.
  await inspectorTab(page, 'Structure')
  await page.locator('.canvas-outline .outline-row', { hasText: 'Page header' }).click()
  await page.locator('.insert-tile', { hasText: '3 columns' }).click()
  await expect(header.locator('table td')).toHaveCount(3)

  await saveDraft(page, 'a header with three columns')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('@top-center')
  expect(saved).toContain('running(lf-header)')
  expect(saved).toMatch(/margin[^;]*30mm/)
})

test('switching a header off takes both halves with it', async ({ page, request }) => {
  const code = uniqueCode('furniture-off')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)
  await expect(frame.locator('#head')).toHaveCount(1)

  await page.locator('.canvas-topbar button', { hasText: 'Page:' }).click()
  await page
    .locator('.page-setup .furniture-row', { hasText: 'Header' })
    .getByRole('checkbox')
    .uncheck()

  await expect(frame.locator('#head')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await saveDraft(page, 'no header')
  const saved = await latestDraftHtml(request, code)
  expect(saved).not.toContain('lf-head')
  // The footer is not this switch's business.
  expect(saved).toContain('lf-footer')
})

/**
 * The shape the examples have, and the reason the switch failed on them: the
 * `@page` rule that pulls the element sits in a <style> INSIDE the body, beside
 * the element it belongs to. That is the canvas's document, not the shell's
 * copy of the template — see examples/report.html, which is written this way so
 * that a header carries its own rule.
 */
const IN_BODY =
  '<html>\n<head>\n<style>@page { size: A4; margin: 20mm; }</style>\n</head>\n<body>\n' +
  '  <style>@page { margin-top: 24mm; @top-center { content: element(lf-header); width: 100%; } }</style>\n' +
  '  <div id="head" style="position: running(lf-header)">Head</div>\n' +
  '  <style>@page { margin-bottom: 24mm; @bottom-center { content: element(lf-footer); width: 100%; } }</style>\n' +
  '  <div id="foot" style="position: running(lf-footer)">Foot</div>\n' +
  '  <h1 id="title">Body</h1>\n</body>\n</html>\n'

test('both bands can be off at once', async ({ page, request }) => {
  // Reported: uncheck one, then the other, and the tick jumps back to the first
  // — always one band checked, however many times it is cleared. The template
  // was right and the canvas was not: the rule in the body belongs to the
  // canvas, the shell's rewrite never reached it, and the canvas reported the
  // box back on its next change.
  const code = uniqueCode('furniture-both-off')
  await createTemplate(request, code, IN_BODY)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)
  const row = (name: string) =>
    page.locator('.page-setup .furniture-row', { hasText: name }).getByRole('checkbox')

  await page.locator('.canvas-topbar button', { hasText: 'Page:' }).click()
  await row('Header').uncheck()
  await row('Footer').uncheck()

  // Both, at the same time, and still so after the canvas has reported back.
  await expect(row('Header')).not.toBeChecked()
  await expect(row('Footer')).not.toBeChecked()
  await expect(frame.locator('#head')).toHaveCount(0)
  await expect(frame.locator('#foot')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await saveDraft(page, 'no bands at all')
  const saved = await latestDraftHtml(request, code)
  expect(saved).not.toContain('lf-header')
  expect(saved).not.toContain('lf-head')
  expect(saved).not.toContain('lf-footer')
  expect(saved).not.toContain('element(')
})

test('styling a footer does not stop it being a footer', async ({ page, request }) => {
  // `position: running(lf-footer)` is what makes it one, and no browser parses
  // it — so it lives only in the style attribute, and any write through
  // el.style rebuilds that attribute from the declarations the parser kept and
  // drops it. Aligning a footer, or changing its font, quietly turned it into
  // an ordinary block that printed in the body. This is the half of
  // src/editor/style-attr.test.ts that jsdom cannot express: its CSSOM keeps
  // what a browser throws away, so only a real browser can fail here.
  const code = uniqueCode('furniture-styled')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)
  const footer = frame.locator('#foot')

  await footer.click()
  await page.locator('.canvas-topbar button[title="Align right"]').click()
  await expect(footer).toHaveCSS('text-align', 'right')
  await expect(footer).toHaveAttribute('data-lf-running', 'bottom-left')

  await footer.click()
  await page.locator('.inspector-properties select').first().selectOption('monospace')
  await expect(footer).toHaveAttribute('data-lf-running', 'bottom-left')

  await saveDraft(page, 'aligned the footer')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('running(lf-footer)')
  expect(saved).toContain('text-align: right')
})

test('a page number is a block, and it goes in the footer', async ({ page, request }) => {
  // It used to be a string inside an @page margin box: it printed, and nothing
  // in the editor could touch it. As content it goes wherever it is wanted —
  // here, into the footer — and can be selected, styled and moved.
  const code = uniqueCode('page-no')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  // Put the caret in the footer, then take the preset.
  await frame.locator('#foot').click()
  await page.keyboard.press('End')
  await page.locator('.panel-tab', { hasText: 'Presets' }).click()
  await page.locator('.preset-card', { hasText: 'Page number' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('.btn.primary').click()

  // In the footer, not beside it.
  await expect(frame.locator('#foot .lf-page-no')).toHaveCount(1)
  await expect(frame.locator('#foot .lf-page-count')).toHaveCount(1)

  await saveDraft(page, 'a page number in the footer')
  const saved = await latestDraftHtml(request, code)
  // The span and the rule that fills it both travel with the template.
  expect(saved).toContain('lf-page-no')
  expect(saved).toContain('counter(page)')
  expect(saved).toContain('counter(pages)')
})

test('the palette no longer offers a header or a footer', async ({ page, request }) => {
  // They are a property of the page — a switch in the page panel — and offering
  // them here as well would be two ways to make one thing, one of which writes
  // only half of it.
  const code = uniqueCode('no-furniture-tiles')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  const tiles = page.locator('.insert-tile')
  await expect(tiles.filter({ hasText: 'Page header' })).toHaveCount(0)
  await expect(tiles.filter({ hasText: 'Page footer' })).toHaveCount(0)
  await expect(tiles.filter({ hasText: 'Table' })).toHaveCount(1)
})
