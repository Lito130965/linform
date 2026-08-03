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
