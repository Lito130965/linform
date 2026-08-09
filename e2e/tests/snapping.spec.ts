import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { createTemplate, enterVisual, openTemplate, uniqueCode } from './support'

/**
 * Snapping, measured in the canvas's own coordinates.
 *
 * The arithmetic is unit-tested; what cannot be checked there is whether the
 * lines a real page offers are the ones the drag is given, and whether an edge
 * dragged near a page margin actually lands on it. Both are properties of a
 * laid-out document, so they are checked in a browser against the geometry the
 * engine produced.
 */

const CANVAS = 'iframe[title="template canvas"]'

const TEMPLATE =
  '<style>@page { size: A4; margin: 20mm }</style>\n' +
  '<table><tbody><tr><td id="cell">narrow</td></tr></tbody></table>\n'

/** Canvas pixels per screen pixel: the sheet is scaled to fit the pane, and
 * every screen distance in this file has to be converted through it. */
async function zoomOf(frame: FrameLocator, page: Page): Promise<number> {
  const onScreen = (await frame.locator('#cell').boundingBox())!
  const inCanvas = await frame.locator('#cell').evaluate((el) => el.getBoundingClientRect().width)
  void page
  return onScreen.width / inCanvas
}

/** Where the page's content band ends, in canvas coordinates — the margin an
 * edge should fall onto. */
async function bandRight(frame: FrameLocator): Promise<number> {
  return frame
    .locator('body')
    .evaluate((body) => body.clientWidth - parseFloat(getComputedStyle(body).paddingRight))
}

const cellRight = (frame: FrameLocator): Promise<number> =>
  frame.locator('#cell').evaluate((el) => el.getBoundingClientRect().right)

async function dragColumnEdge(page: Page, frame: FrameLocator, byCanvasPx: number, alt = false) {
  await frame.locator('#cell').click()
  const handle = page.locator('.col-resize')
  await expect(handle).toBeVisible()
  const box = (await handle.boundingBox())!
  const zoom = await zoomOf(frame, page)

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(box.x + box.width / 2 + byCanvasPx * zoom, box.y + box.height / 2, {
    steps: 6,
  })
  return async () => {
    await page.mouse.up()
    if (alt) await page.keyboard.up('Alt')
  }
}

test('an edge dragged near the page margin lands on it', async ({ page, request }) => {
  const code = uniqueCode('snap')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  const margin = await bandRight(frame)
  const from = await cellRight(frame)
  // Stop three canvas pixels short: inside the pull, nowhere near it by eye.
  const finish = await dragColumnEdge(page, frame, margin - from - 3)

  await expect(page.locator('.snap-guide.page')).toHaveCount(1)
  await finish()

  expect(Math.abs((await cellRight(frame)) - margin)).toBeLessThan(1.5)
})

test('holding alt drags past the margin instead of onto it', async ({ page, request }) => {
  // Snapping that cannot be refused is snapping that fights you.
  const code = uniqueCode('snap-off')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  const margin = await bandRight(frame)
  const from = await cellRight(frame)
  const finish = await dragColumnEdge(page, frame, margin - from - 3, true)

  await expect(page.locator('.snap-guide')).toHaveCount(0)
  await finish()

  const landed = await cellRight(frame)
  expect(Math.abs(landed - margin)).toBeGreaterThan(1.5)
  expect(Math.abs(landed - (margin - 3))).toBeLessThan(2)
})

test('the drag says how big it is, in millimetres', async ({ page, request }) => {
  const code = uniqueCode('readout')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  const finish = await dragColumnEdge(page, frame, 40)
  const readout = page.locator('.drag-readout')
  await expect(readout).toBeVisible()
  await expect(readout).toContainText('mm')
  await finish()

  // It belongs to the gesture, so it goes when the gesture does.
  await expect(readout).toHaveCount(0)
})
