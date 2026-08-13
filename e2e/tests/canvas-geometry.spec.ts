import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, exampleHtml, openTemplate, uniqueCode } from './support'

/**
 * Where the canvas draws things, and how tall it thinks the document is.
 *
 * Both of these are measured against a real layout engine, so neither can be
 * checked in jsdom — and both went wrong in ways that only show up on a
 * template with page furniture, which is why the example with a running header
 * and a footer is the one used here.
 */

const CANVAS = 'iframe[title="template canvas"]'

test('the sheet does not grow a page every time you edit', async ({ page, request }) => {
  /**
   * The canvas measured its height from the iframe's scrollHeight — which is at
   * least the viewport, and the viewport is the height the measurement itself
   * decides. Each pass therefore handed the page count one extra bottom margin,
   * and the sheet grew by a page per edit with no page break in the document.
   */
  const code = uniqueCode('grow')
  // Deliberately not one of the examples: in the canvas a `{% for %}` is drawn
  // as the single row it is written as, so a template that prints on two pages
  // occupies one here. This one is taller than a page as authored, which is the
  // only way to have a boundary to watch.
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n' +
      '<h1>Report</h1>\n<div style="height: 400mm">tall block</div>\n<p>after</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  const boundaries = page.locator('.sheet-gap')
  const before = await boundaries.count()
  expect(before, 'this template is taller than one page and should say so').toBeGreaterThan(0)

  const heading = page.frameLocator(CANVAS).locator('h1').first()
  for (let i = 0; i < 3; i++) {
    await heading.click()
    await page.keyboard.press('End')
    await page.keyboard.type('x')
    // Past the debounce, so each edit is a separate settled burst — which is
    // exactly the cycle that used to add a page.
    await page.waitForTimeout(400)
  }

  expect(await boundaries.count(), 'the sheet grew while nothing was added to it').toBe(before)
})

test('the page area is where the canvas positions from, as it is in print', async ({
  page,
  request,
}) => {
  /**
   * `position: absolute; left: 0` means the corner of the PAGE AREA — inside the
   * @page margins — because in print the body box begins there. Measured against
   * the engine in tests/test_engine_capabilities.py; this is the canvas half of
   * the same claim.
   *
   * The canvas used to draw the margins as padding on the body, which put that
   * origin one margin away, at the corner of the sheet. Everything in flow still
   * looked right, so the difference only surfaced on export: a logo dragged into
   * the top-right corner of the canvas printed 18mm further right, over the edge
   * of the paper.
   */
  const code = uniqueCode('page-origin')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 26mm 18mm }</style>\n' +
      '<div id="flow">in flow</div>\n' +
      '<div id="probe" style="position:absolute; left:0; top:0; width:20mm; height:10mm; ' +
      'background:#000"></div>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  const probe = (await frame.locator('#probe').boundingBox())!
  const flow = (await frame.locator('#flow').boundingBox())!
  const sheet = (await page.locator(CANVAS).boundingBox())!

  // Compared with the first thing in normal flow, which starts at that same
  // corner: both are drawn at the canvas zoom, so the factor cancels.
  expect(Math.abs(probe.x - flow.x), 'the probe is not at the page-area left edge').toBeLessThan(2)
  expect(Math.abs(probe.y - flow.y), 'the probe is not at the page-area top edge').toBeLessThan(2)

  // And the page area is not the sheet: without this the assertions above would
  // also pass with both of them wrong in the same direction.
  expect(probe.x - sheet.x, 'the left margin is not being kept').toBeGreaterThan(10)
  expect(probe.y - sheet.y, 'the top margin is not being kept').toBeGreaterThan(10)
})

test('a resize handle sits on the edge it resizes', async ({ page, request }) => {
  /**
   * Handles are positioned in the canvas document's coordinates. The margin-box
   * strips above the sheet are in normal flow, so on any template with a running
   * header they pushed the canvas down and left every handle drawn that much too
   * high — visible, unusable, and only on templates that have page furniture.
   */
  const code = uniqueCode('handles')
  await createTemplate(request, code, exampleHtml('invoice'))
  await openTemplate(page, code)
  await enterVisual(page)

  // A cell of the document, not of the footer: the invoice's footer is a table
  // too now, and it sits in the bottom margin band rather than in the flow.
  const cell = page.frameLocator(CANVAS).locator('.parties td').first()
  await cell.click()

  const row = page.locator('.row-resize')
  const column = page.locator('.col-resize')
  await expect(row).toBeVisible()

  const cellBox = (await cell.boundingBox())!
  const rowBox = (await row.boundingBox())!
  const columnBox = (await column.boundingBox())!

  // Both boxes are in the page's coordinates, so they are directly comparable.
  // The handle straddles the edge by design, hence the few pixels of slack.
  expect(
    Math.abs(rowBox.y - (cellBox.y + cellBox.height)),
    'the row handle is not on the bottom edge of the row',
  ).toBeLessThan(6)
  expect(
    Math.abs(columnBox.x - (cellBox.x + cellBox.width)),
    'the column handle is not on the right edge of the column',
  ).toBeLessThan(6)
})

test('the page can be looked at closely, and handed back to the window', async ({
  page,
  request,
}) => {
  // The percentage in the toolbar used to be a read-out of a number nobody
  // could change: the only way to see 8pt small print, or to place something
  // against a margin, was to make the browser window bigger.
  const code = uniqueCode('zoom')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n<h1 id="title">Report</h1>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  const percent = page.locator('.zoom-value')
  const sheet = page.locator(CANVAS)
  const fitted = (await sheet.boundingBox())!.width
  const fittedText = await percent.textContent()

  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(percent).not.toHaveText(fittedText!)
  expect((await sheet.boundingBox())!.width).toBeGreaterThan(fitted)

  // The percentage is the way back: pressing it returns the size to the window.
  await percent.click()
  await expect(percent).toHaveText(fittedText!)
  expect((await sheet.boundingBox())!.width).toBeCloseTo(fitted, 0)
})
