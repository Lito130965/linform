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
  // The body IS the page area — it is inset by the @page margins, exactly as it
  // is in print — so its own right edge is the one an edge should fall onto.
  // Sheet coordinates, like every other measurement here.
  return frame.locator('body').evaluate((body) => body.getBoundingClientRect().right)
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

test('a column dragged near the page margin lands the table on it', async ({ page, request }) => {
  /**
   * What "on the margin" can mean here is decided by the box model, not by us.
   * A table with an automatic width may not exceed its container's content
   * width, and `border-spacing` sits between the last cell and the table's own
   * edge — so a cell in a table that is already flush with the margin is
   * necessarily that spacing short of it, and asking for the cell's edge to
   * touch the margin is asking for something no browser will do.
   *
   * The table's edge is the one that lands, and the table's edge is what a
   * person means by "make it reach the margin".
   */
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

  const landed = await frame
    .locator('#cell')
    .evaluate((el) => {
      const table = el.closest('table')!
      return {
        table: table.getBoundingClientRect().right,
        cell: el.getBoundingClientRect().right,
        spacing: parseFloat(getComputedStyle(table).borderSpacing) || 0,
      }
    })

  expect(
    Math.abs(landed.table - margin),
    `table=${landed.table} margin=${margin}`,
  ).toBeLessThan(1.5)
  // And the cell is inside it by exactly the spacing — stated, so that if a
  // future change starts overshooting the margin the difference is visible
  // rather than absorbed into a tolerance.
  expect(Math.abs(landed.table - landed.cell - landed.spacing)).toBeLessThan(1)
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

  // Nothing was CAUGHT: the lines that remain are the block's own edges, which
  // say where it is rather than what it landed on, and with Alt held there are
  // no targets drawn at all.
  await expect(page.locator('.snap-guide:not(.moving):not(.hint)')).toHaveCount(0)
  await expect(page.locator('.snap-guide.hint')).toHaveCount(0)
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

test('a drag draws three kinds of line, and leaves none behind', async ({ page, request }) => {
  // The canvas draws a lot of lines while something is moved, and they mean
  // different things: the grid is the paper's ruling, one pair is where the
  // block IS, the rest are what it could land on. All three were the same blue,
  // so telling them apart meant watching which one moved with the pointer.
  const code = uniqueCode('guide-colours')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 20mm }</style>\n' +
      '<div id="anchor" style="width: 63.7mm; height: 12mm; background: #eee"></div>\n' +
      '<img id="mark" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" ' +
      'style="position: absolute; left: 10mm; top: 60mm; width: 30mm; height: 20mm">\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#mark').click()
  const start = (await frame.locator('#mark').boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  // Up and to the left, towards the block above it.
  await page.mouse.move(start.x + start.width / 2 - 40, start.y + start.height / 2 - 120, {
    steps: 12,
  })

  // Both ends of both axes, in the colour of the thing being moved.
  await expect(page.locator('.snap-guide.moving')).toHaveCount(4)
  // And the grid, which belongs to the page rather than to the gesture.
  await expect(page.locator('.canvas-grid')).toHaveCount(1)

  // At most one target per moving edge, and only while it is near one. The
  // first version drew every line within reach, which on a page of forty rows
  // is a second grid: a screen of hairlines that says nothing about which one
  // you are approaching.
  expect(await page.locator('.snap-guide.hint').count()).toBeLessThanOrEqual(4)

  // Thick enough to be read over the grid rather than lost in it.
  const width = await page
    .locator('.snap-guide.moving.vertical')
    .first()
    .evaluate((el) => getComputedStyle(el).width)
  expect(parseFloat(width)).toBeGreaterThanOrEqual(2)

  await page.mouse.up()

  // Nothing is left drawn on a page that does not have it.
  await expect(page.locator('.snap-guide')).toHaveCount(0)
  await expect(page.locator('.canvas-grid')).toHaveCount(0)
})
