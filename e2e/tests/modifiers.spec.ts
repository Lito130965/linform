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
 * The modifier keys, checked where they meet the document.
 *
 * The arithmetic is unit-tested. What a browser is needed for is the part that
 * touches the markup: dragging with Ctrl has to leave the original where it was
 * and put a copy at the drop, and the copy has to arrive clean — carrying the
 * editor's own selection marker into the document would be a leak of the canvas
 * into the template.
 */

const CANVAS = 'iframe[title="template canvas"]'

const TEMPLATE =
  '<p id="source">copy me</p>\n' +
  '<p id="target">somewhere else</p>\n' +
  '<p id="last">the end</p>\n'

test('ctrl and drag leaves the original and drops a copy', async ({ page, request }) => {
  const code = uniqueCode('copy-drag')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('#source').click()

  const grip = page.locator('.el-toolbar .grip')
  const from = (await grip.boundingBox())!
  const to = (await frame.locator('#last').boundingBox())!

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 2, { steps: 8 })
  await page.keyboard.down('Control')
  // Pressed once the destination is visible, which is when people reach for it.
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 1, { steps: 2 })
  await expect(page.locator('.drag-readout')).toContainText('copy here')
  await page.mouse.up()
  await page.keyboard.up('Control')

  // Two paragraphs saying "copy me": the original, still where it was, and one
  // at the drop.
  await expect(frame.locator('p', { hasText: 'copy me' })).toHaveCount(2)
  await expect(frame.locator('#source')).toHaveCount(1)

  await saveDraft(page, 'duplicated a block')
  const saved = await latestDraftHtml(request, code)
  expect(saved.match(/copy me/g)).toHaveLength(2)
  // The canvas's own selection marker is an affordance, not content.
  expect(saved).not.toContain('data-lf-selected')
})

test('a plain drag still moves rather than copies', async ({ page, request }) => {
  const code = uniqueCode('move-drag')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('#source').click()

  const grip = page.locator('.el-toolbar .grip')
  const from = (await grip.boundingBox())!
  const to = (await frame.locator('#last').boundingBox())!

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 2, { steps: 8 })
  await expect(page.locator('.drag-readout')).toContainText('move here')
  await page.mouse.up()

  await expect(frame.locator('p', { hasText: 'copy me' })).toHaveCount(1)
})

test('the modifiers are written down with the shortcuts', async ({ page, request }) => {
  const code = uniqueCode('mod-hint')
  await createTemplate(request, code, '<p>anything</p>')
  await openTemplate(page, code)
  await enterVisual(page)

  const hint = page.locator('.canvas-keys')
  await hint.locator('summary').click()
  await expect(hint).toContainText('Shift + drag')
  await expect(hint).toContainText('Alt + drag')
  await expect(hint).toContainText('Ctrl + drag')
})
