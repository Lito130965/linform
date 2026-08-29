import { expect, test } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  latestDraftHtml,
  openTemplate,
  saveDraft,
  uniqueCode,
} from './support'

/**
 * Setting a size and a spacing from the canvas.
 *
 * The unit tests decide what a typed value means. What they cannot show is that
 * the control is reachable at all — which was the actual complaint: width and
 * height existed as two boxes labelled `W` and `H`, and nobody found them.
 */

const CANVAS = 'iframe[title="template canvas"]'

test('spacing and size can be set on a block and survive a save', async ({ page, request }) => {
  const code = uniqueCode('box')
  await createTemplate(request, code, '<h1>Heading</h1>\n<p id="body">Body text</p>\n')
  await openTemplate(page, code)
  await enterVisual(page)

  await page.frameLocator(CANVAS).locator('#body').click()

  // Named, not positional: a person looking for "margin top" should find a
  // control that says so.
  await page.getByLabel('Margin top', { exact: true }).fill('12')
  await page.keyboard.press('Enter')
  await page.getByLabel('Width', { exact: true }).fill('120')
  await page.keyboard.press('Enter')

  const paragraph = page.frameLocator(CANVAS).locator('#body')
  await expect(paragraph).toHaveAttribute('style', /margin-top:\s*12mm/)
  await expect(paragraph).toHaveAttribute('style', /width:\s*120mm/)

  await saveDraft(page, 'set spacing from the box')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toMatch(/margin-top:\s*12mm/)
  expect(saved).toMatch(/width:\s*120mm/)
})

test('clearing a box returns the property to the stylesheet', async ({ page, request }) => {
  const code = uniqueCode('box-clear')
  await createTemplate(
    request,
    code,
    '<style>p { margin-top: 4mm }</style>\n<p id="body">Body text</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)
  await page.frameLocator(CANVAS).locator('#body').click()

  const marginTop = page.getByLabel('Margin top', { exact: true })
  await marginTop.fill('20')
  await page.keyboard.press('Enter')
  await expect(page.frameLocator(CANVAS).locator('#body')).toHaveAttribute(
    'style',
    /margin-top:\s*20mm/,
  )

  // Emptying it must not write a zero — the stylesheet's 4mm should come back.
  await marginTop.fill('')
  await page.keyboard.press('Enter')
  await expect(page.frameLocator(CANVAS).locator('#body')).not.toHaveAttribute(
    'style',
    /margin-top/,
  )
  await expect(marginTop).toHaveAttribute('placeholder', '4')
})

test('a value can be edited, not only replaced', async ({ page, request }) => {
  // Reported from use: with 50 in the box you could not delete the 0 and type
  // 5 to get 55 — the field was re-seeded from a document that was mutating
  // under it, so every keystroke fought whoever was typing.
  const code = uniqueCode('box-edit')
  await createTemplate(request, code, '<p id="body">Body text</p>\n')
  await openTemplate(page, code)
  await enterVisual(page)
  await page.frameLocator(CANVAS).locator('#body').click()

  const marginTop = page.getByLabel('Margin top', { exact: true })
  await marginTop.fill('50')
  await page.keyboard.press('Enter')

  await marginTop.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('5')
  await expect(marginTop).toHaveValue('55')

  await page.keyboard.press('Enter')
  await expect(page.frameLocator(CANVAS).locator('#body')).toHaveAttribute(
    'style',
    /margin-top:\s*55mm/,
  )
})

test('a spacing can be found by dragging or by arrow keys', async ({ page, request }) => {
  // Nobody knows a gap wants 6.5mm; they know it when they see it. Both of
  // these change the document live, which is the point.
  const code = uniqueCode('box-drag')
  await createTemplate(request, code, '<p id="body">Body text</p>\n')
  await openTemplate(page, code)
  await enterVisual(page)
  await page.frameLocator(CANVAS).locator('#body').click()

  const marginTop = page.getByLabel('Margin top', { exact: true })
  await marginTop.fill('10')
  await page.keyboard.press('Enter')

  await marginTop.press('ArrowUp')
  await expect(marginTop).toHaveValue('11')
  await marginTop.press('ArrowDown')
  await marginTop.press('ArrowDown')
  await expect(marginTop).toHaveValue('9')

  const box = (await marginTop.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // Half a millimetre per pixel.
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2)
  await page.mouse.up()

  await expect(marginTop).toHaveValue('19')
  await expect(page.frameLocator(CANVAS).locator('#body')).toHaveAttribute(
    'style',
    /margin-top:\s*19mm/,
  )
})

test('the millimetre grid can be turned on over the sheet', async ({ page, request }) => {
  const code = uniqueCode('grid')
  await createTemplate(request, code, '<p>anything</p>')
  await openTemplate(page, code)
  await enterVisual(page)

  await expect(page.locator('.canvas-grid')).toHaveCount(0)
  await page.getByRole('button', { name: 'Grid' }).click()
  await expect(page.locator('.canvas-grid')).toHaveCount(1)
  await page.getByRole('button', { name: 'Grid' }).click()
  await expect(page.locator('.canvas-grid')).toHaveCount(0)
})

test('a spacing being changed shows what it could line up with, and lands on it', async ({
  page,
  request,
}) => {
  // Dragging a block has had guides and snapping since the canvas was built;
  // scrubbing a margin — the other way to move something — had a ruler and
  // nothing to line up against. It is the same question either way: where does
  // this edge want to be.
  const code = uniqueCode('box-snap')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 20mm }</style>\n' +
      '<div id="anchor" style="width: 63.7mm; height: 10mm; background: #eee"></div>\n' +
      '<p id="mover">Move me</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#mover').click()
  const input = page.getByLabel('Margin left', { exact: true })

  // Reaching for the number is enough: the ruler comes up, and so do the lines
  // of everything else on the page.
  await input.focus()
  await expect(page.locator('.canvas-grid')).toHaveCount(1)
  expect(await page.locator('.snap-guide.hint').count()).toBeGreaterThan(2)

  // Scrub right until the edge catches something that is not the grid. The
  // anchor is 63.7mm wide, so its centre is at 31.85mm — a number nobody would
  // land on by hand.
  const box = (await input.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  let caught = ''
  for (let dx = 4; dx <= 140 && !caught; dx += 4) {
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2)
    const centre = page.locator('.snap-guide.center')
    if ((await centre.count()) > 0) caught = await input.inputValue()
  }
  await page.mouse.up()
  expect(caught, 'the scrub never caught the block centre').toBe('31.9')

  // Letting go of the field puts both away: they are help while adjusting, not
  // decoration.
  await input.blur()
  await expect(page.locator('.snap-guide')).toHaveCount(0)
})
