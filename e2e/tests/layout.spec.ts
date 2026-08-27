import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, openTemplate, uniqueCode } from './support'

/**
 * How the editor divides its width.
 *
 * Both panes used to be `flex: 1`: an even split, with nothing to grab. On a
 * 1920 screen that left 570 px for a 794 px page, so the canvas opened at 70 %
 * — a form drawn smaller than it prints, on the widest screen anybody has.
 * Where the width goes is the author's business, and the editor has to remember
 * what they decided.
 */

test.use({ viewport: { width: 1920, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'
const DOC = '<style>@page { size: A4; margin: 20mm }</style>\n<h1 id="title">Report</h1>\n'

/** The canvas column, which is what all of this is for. */
const canvasColumn = (page: import('@playwright/test').Page) => page.locator('.code-pane')

test('the page gets the width, and opens at its true size', async ({ page, request }) => {
  const code = uniqueCode('layout')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  // The navigation folds to its rail once a document is open: the list of
  // templates is how you get here, not something to keep looking at.
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)

  const column = (await canvasColumn(page).boundingBox())!
  expect(column.width).toBeGreaterThanOrEqual(900)
  await expect(page.locator('.zoom-value')).toHaveText('100%')
})

test('the boundary moves, and is still there after a reload', async ({ page, request }) => {
  const code = uniqueCode('layout-drag')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)

  const splitter = page.getByRole('separator', { name: 'Resize the preview' })
  const before = (await page.locator('.preview-pane').boundingBox())!
  const grip = (await splitter.boundingBox())!
  await page.mouse.move(grip.x + 3, grip.y + 100)
  await page.mouse.down()
  await page.mouse.move(grip.x - 120, grip.y + 100, { steps: 8 })
  await page.mouse.up()

  const widened = (await page.locator('.preview-pane').boundingBox())!
  expect(widened.width).toBeGreaterThan(before.width + 80)

  // Remembered, so the next document opens the way this one was left.
  await page.reload()
  await openTemplate(page, code)
  const kept = (await page.locator('.preview-pane').boundingBox())!
  expect(Math.abs(kept.width - widened.width)).toBeLessThanOrEqual(2)
})

test('the arrows move the boundary too, and a double click puts it back', async ({
  page,
  request,
}) => {
  // Every boundary in the editor is reachable without a mouse; this is the
  // contract the bottom panel's edge already had, kept for all of them.
  const code = uniqueCode('layout-keys')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)

  const splitter = page.getByRole('separator', { name: 'Resize the preview' })
  await splitter.focus()
  await expect(splitter).toBeFocused()
  const start = (await page.locator('.preview-pane').boundingBox())!.width

  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  const nudged = (await page.locator('.preview-pane').boundingBox())!.width
  expect(nudged).toBeGreaterThan(start)

  await splitter.dblclick()
  expect((await page.locator('.preview-pane').boundingBox())!.width).toBeCloseTo(start, 0)
})

test('the preview folds away in one press, and the page re-fits both ways', async ({
  page,
  request,
}) => {
  const code = uniqueCode('layout-fold')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  const narrow = (await canvasColumn(page).boundingBox())!.width
  await page.keyboard.press('Control+\\')

  await expect(page.locator('.preview-pane')).toHaveCount(0)
  // Put away, not gone: the strip says what is behind it.
  await expect(page.locator('.pane-strip')).toContainText('PREVIEW')
  const wide = (await canvasColumn(page).boundingBox())!.width
  expect(wide).toBeGreaterThan(narrow + 300)

  await page.keyboard.press('Control+\\')
  await expect(page.locator('.preview-pane')).toHaveCount(1)
  expect((await canvasColumn(page).boundingBox())!.width).toBeCloseTo(narrow, 0)
})
