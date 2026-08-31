import { expect, test } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  inspectorTab,
  openTemplate,
  openTool,
  uniqueCode,
} from './support'

/**
 * Putting a block into another block, and taking it back out.
 *
 * Without this a document is a flat list of paragraphs: everything could only
 * ever land beside something, so a section was a thing you could make and never
 * fill. A drag says which it means by where it hovers — near an edge is beside,
 * the middle is inside — and that same rule is what lets a block escape a
 * container it is in.
 */

test.use({ viewport: { width: 1680, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'

const DOC =
  '<style>@page { size: A4; margin: 15mm }</style>\n' +
  '<p id="loose">move me</p>\n' +
  '<div id="card" style="border: 1px solid #888; padding: 10mm; min-height: 30mm">' +
  '<p id="inside">already in the card</p></div>\n'

test('the palette puts a block inside the container that is selected', async ({ page, request }) => {
  const code = uniqueCode('into-block')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  // Selected from the structure panel, so the click cannot be read as aiming at
  // the paragraph inside it.
  await inspectorTab(page, 'Structure')
  await page.locator('.canvas-outline .outline-row', { hasText: 'Block' }).first().click()
  await openTool(page, 'Insert')
  await page.locator('.insert-tile', { hasText: 'Heading' }).click()

  await expect(frame.locator('#card h2')).toHaveCount(1)
  await expect(frame.locator('body > h2')).toHaveCount(0)
})

test('dragging into the middle of a container drops the block inside it', async ({
  page,
  request,
}) => {
  const code = uniqueCode('drag-in')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#loose').click()
  const grip = page.locator('.el-toolbar .grip')
  const gripBox = (await grip.boundingBox())!
  const cardBox = (await frame.locator('#card').boundingBox())!

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 10 })
  // The indicator is the container itself, not a line above or below it.
  await expect(page.locator('.drop-inside')).toHaveCount(1)
  await page.mouse.up()

  await expect(frame.locator('#card #loose')).toHaveCount(1)
})

test('dragging to the edge of a container takes a block back out of it', async ({
  page,
  request,
}) => {
  const code = uniqueCode('drag-out')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await expect(frame.locator('#card #inside')).toHaveCount(1)
  await frame.locator('#inside').click()

  const grip = page.locator('.el-toolbar .grip')
  const gripBox = (await grip.boundingBox())!
  const cardBox = (await frame.locator('#card').boundingBox())!

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  // The top few pixels of the card: beside it, at the level the card is on.
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 4, { steps: 10 })
  await expect(page.locator('.drop-line')).toHaveCount(1)
  await page.mouse.up()

  await expect(frame.locator('#card #inside')).toHaveCount(0)
  await expect(frame.locator('body > #inside')).toHaveCount(1)
})
