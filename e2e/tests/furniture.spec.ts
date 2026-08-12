import { expect, test } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  exampleHtml,
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
  const code = uniqueCode('furniture-strip')
  await createTemplate(request, code, exampleHtml('report'))
  await openTemplate(page, code)
  await enterVisual(page)

  const strips = (await page.locator('.furniture-strip').allInnerTexts()).join(' ')
  expect(strips).not.toContain('element')
  // The page number is not an element, so it is still previewed there.
  expect(strips).toContain('Page')
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

  const outline = page.locator('.canvas-outline .outline-label')
  await expect(outline.filter({ hasText: 'Page header' })).toHaveCount(1)
  await expect(outline.filter({ hasText: 'Page footer' })).toHaveCount(1)

  await saveDraft(page, 'edited the footer')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('draft')
  // Nothing the canvas added to place it went into the template.
  expect(saved).not.toContain('data-lf-running')
})

test('a footer can be nudged from the edge, in millimetres the renderer obeys', async ({
  page,
  request,
}) => {
  const code = uniqueCode('furniture-move')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#foot').click()
  const grip = page.locator('.running-grip')
  await expect(grip).toBeVisible()

  await grip.hover()
  const box = (await grip.boundingBox())!
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  // Written as the element's own margin, which is what moves it in print too.
  await expect(frame.locator('#foot')).toHaveAttribute('style', /margin-left:\s*\d+(\.\d+)?mm/)
  await saveDraft(page, 'nudged the footer')
  expect(await latestDraftHtml(request, code)).toMatch(/margin-left:\s*\d/)
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
  await page.locator('.canvas-props button', { hasText: 'Expression' }).click()
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
  await expect(page.locator('.canvas-props .props-kind, .canvas-props .crumbs')).not.toHaveCount(0)
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
