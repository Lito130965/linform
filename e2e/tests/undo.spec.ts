import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, openTemplate, uniqueCode } from './support'

/**
 * What one press of undo takes back.
 *
 * The unit of undo has to be the unit of intent. A drag is one action however
 * many mutations it makes on the way, and an undo that lands halfway through a
 * resize reads as a program that is broken rather than one that is precise —
 * it is among the fastest ways to lose trust in an editor.
 *
 * Escape belongs to the same idea from the other end: having started a drag and
 * thought better of it, you should be able to say so without letting go of the
 * mouse and then undoing.
 */

const CANVAS = 'iframe[title="template canvas"]'

const TEMPLATE =
  '<style>@page { size: A4; margin: 20mm }</style>\n' +
  '<table><tbody><tr><td id="cell">narrow</td></tr></tbody></table>\n'

const cellWidth = (page: import('@playwright/test').Page): Promise<number> =>
  page
    .frameLocator(CANVAS)
    .locator('#cell')
    .evaluate((el) => Math.round(el.getBoundingClientRect().width))

async function dragBy(page: import('@playwright/test').Page, dx: number) {
  await page.frameLocator(CANVAS).locator('#cell').click()
  const handle = page.locator('.col-resize')
  await expect(handle).toBeVisible()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // In steps, and slowly enough that the change debounce would have fired
  // several times over during the drag if history were not held open.
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(box.x + box.width / 2 + (dx * i) / 4, box.y + box.height / 2)
    await page.waitForTimeout(200)
  }
  return box
}

test('one drag is one press of undo', async ({ page, request }) => {
  const code = uniqueCode('undo-drag')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)

  const before = await cellWidth(page)
  await dragBy(page, 160)
  await page.mouse.up()

  const after = await cellWidth(page)
  expect(after).toBeGreaterThan(before + 100)

  await page.locator('button[title^="Undo"]').click()
  // All the way back in one press — not to some width the drag passed through.
  await expect.poll(() => cellWidth(page)).toBe(before)
})

test('escape puts a drag back without letting go of the mouse', async ({ page, request }) => {
  const code = uniqueCode('undo-escape')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)

  const before = await cellWidth(page)
  await dragBy(page, 160)
  expect(await cellWidth(page)).toBeGreaterThan(before + 100)

  await page.keyboard.press('Escape')
  await expect.poll(() => cellWidth(page)).toBe(before)

  // The gesture is over: releasing the button changes nothing further.
  await page.mouse.up()
  expect(await cellWidth(page)).toBe(before)
})

test('an abandoned drag leaves nothing to undo', async ({ page, request }) => {
  const code = uniqueCode('undo-none')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)

  const before = await cellWidth(page)
  await dragBy(page, 120)
  await page.keyboard.press('Escape')
  await page.mouse.up()

  // Undo is either disabled or takes back something older — either way the
  // cancelled gesture is not sitting in the history as a step of its own.
  const undo = page.locator('button[title^="Undo"]')
  if (await undo.isEnabled()) await undo.click()
  await expect.poll(() => cellWidth(page)).toBe(before)
})
