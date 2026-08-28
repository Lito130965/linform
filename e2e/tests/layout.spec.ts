import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, openTemplate, openTool, uniqueCode } from './support'

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

test('a selection does not move the page by a pixel', async ({ page, request }) => {
  // The rule the whole inspector exists to make structural rather than
  // maintained. Properties used to be a bar above the canvas: it appeared with
  // the first selection and dropped the page 116 px, so the second click of a
  // double click landed somewhere else and editing a field by double-clicking
  // it never worked first time. The bar was then held at a fixed 150 px —
  // a fifth of the height, kept empty — to stop the layout moving. A side
  // column can grow and shrink without the page shifting at all.
  const code = uniqueCode('no-shift')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n' +
      '<p id="line">Bill to {{ customer }}</p>\n' +
      '<table id="grid"><tr><td>one</td><td>two</td></tr></table>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  const where = async () => (await frame.locator('#line').boundingBox())!
  const before = await where()

  // A table brings the most controls of any selection — rows, columns, merge,
  // borders — so it is the worst case for a panel that reserves height.
  await frame.locator('#grid td').first().click()
  await expect(page.locator('.inspector-properties')).toContainText('Cell')
  const after = await where()

  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1)
})

test('the inspector remembers its width and its tab', async ({ page, request }) => {
  const code = uniqueCode('inspector-memory')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  const splitter = page.getByRole('separator', { name: 'Resize the inspector' })
  const start = (await page.locator('.canvas-outline').boundingBox())!.width
  await splitter.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  const widened = (await page.locator('.canvas-outline').boundingBox())!.width
  expect(widened).toBeGreaterThan(start)

  await page.locator('.side-tab', { hasText: 'Structure' }).click()

  await page.reload()
  await openTemplate(page, code)
  await enterVisual(page)
  expect((await page.locator('.canvas-outline').boundingBox())!.width).toBeCloseTo(widened, 0)
  await expect(page.locator('.side-tab.active')).toHaveText('Structure')
})

test('the inspector folds away, and the page grows into the space', async ({ page, request }) => {
  // Resized inside the test rather than in a describe with its own viewport.
  // A describe that changes the viewport makes Playwright rebuild the browser
  // context, and the test that runs after it — in this file or the next one —
  // hangs on its first API call until the timeout. Measured twice, on two
  // different victims: layout's own last test, then lifecycle's first.
  const code = uniqueCode('inspector-fold')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  // At 1920 an A4 page fits at 100 % and zoom is capped there, so folding a
  // column could not show in the read-out however well it worked. Narrow the
  // window until the page is being scaled.
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.getByRole('separator', { name: 'Resize the inspector' }).focus()
  await page.keyboard.press('End')

  const zoom = page.locator('.zoom-value')
  await expect(zoom).not.toHaveText('100%')
  const before = await zoom.textContent()

  await page.keyboard.press('Control+.')
  await expect(page.locator('.canvas-outline')).toHaveCount(0)
  await expect(page.locator('.pane-strip', { hasText: 'INSPECTOR' })).toHaveCount(1)
  // Re-fitted rather than left at the size it had: the column it was sharing
  // with is gone.
  await expect(zoom).not.toHaveText(before!)

  await page.keyboard.press('Control+.')
  await expect(page.locator('.canvas-outline')).toHaveCount(1)
  await expect(zoom).toHaveText(before!)
})

test('a tool opens over the page, and the page does not move', async ({ page, request }) => {
  // The rule the flyout exists to make structural. The bottom panel took its
  // height out of the canvas, so opening the blocks re-laid the document out
  // and the page jumped — at the exact moment somebody is aiming at where a
  // block should go.
  const code = uniqueCode('tool-flyout')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  const zoom = await page.locator('.zoom-value').textContent()
  const before = (await frame.locator('#title').boundingBox())!

  await openTool(page, 'Insert')
  await expect(page.locator('.insert-tile').first()).toBeVisible()
  const during = (await frame.locator('#title').boundingBox())!
  expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(during.y - before.y)).toBeLessThanOrEqual(1)
  await expect(page.locator('.zoom-value')).toHaveText(zoom!)

  // Closing puts nothing back, because nothing was taken.
  await page.getByRole('button', { name: 'Close the panel' }).click()
  await expect(page.locator('.tool-flyout')).toHaveCount(0)
  const after = (await frame.locator('#title').boundingBox())!
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
  await expect(page.locator('.zoom-value')).toHaveText(zoom!)
})

test('the chosen tool survives a reload, and none is the default', async ({ page, request }) => {
  const code = uniqueCode('tool-memory')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)

  // Closed to begin with: the page is what the editor is for.
  await expect(page.locator('.tool-flyout')).toHaveCount(0)

  await openTool(page, 'Presets')
  await page.reload()
  await openTemplate(page, code)
  await expect(page.locator('.tool-flyout')).toContainText('Presets')

  // Pressing the same button again shuts it, and that is remembered too.
  await page.locator('.tool-button', { hasText: 'Presets' }).click()
  await expect(page.locator('.tool-flyout')).toHaveCount(0)
  await page.reload()
  await openTemplate(page, code)
  await expect(page.locator('.tool-flyout')).toHaveCount(0)
})
