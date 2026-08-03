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
  await createTemplate(request, code, exampleHtml('invoice'))
  await openTemplate(page, code)
  await enterVisual(page)

  const boundaries = page.locator('.page-boundary')
  const before = await boundaries.count()
  expect(before, 'this example is supposed to paginate at all').toBeGreaterThan(0)

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

  const cell = page.frameLocator(CANVAS).locator('td').first()
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
