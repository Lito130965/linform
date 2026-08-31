import { expect, test } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  latestDraftHtml,
  openTemplate,
  openTool,
  saveDraft,
  uniqueCode,
} from './support'

/**
 * Inserting into a table cell.
 *
 * Reported from use: with a cell selected, a preset landed *beside* the table
 * rather than in the cell — "after this cell" is a place a paragraph cannot be,
 * so the parser lifted it out. The unit tests state the rule; this one proves
 * the rule is the one the canvas actually follows, in a browser whose parser is
 * the thing that used to intervene.
 */

const CANVAS = 'iframe[title="template canvas"]'

const TABLE =
  '<table id="t" border="1">\n' +
  '  <tbody>\n' +
  '    <tr><td id="left">left</td><td id="flag">flag</td></tr>\n' +
  '  </tbody>\n' +
  '</table>\n'

test('a block inserted with a cell selected lands in that cell', async ({ page, request }) => {
  const code = uniqueCode('cell-insert')
  await createTemplate(request, code, TABLE)
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('#flag').click()

  // The palette is the same path a preset takes into the document.
  await openTool(page, 'Insert')
  await page.locator('.insert-tile', { hasText: 'Text' }).click()

  await expect(frame.locator('#flag p')).toHaveCount(1)
  await expect(frame.locator('#t p')).toHaveCount(1)

  await saveDraft(page, 'inserted into a cell')
  const saved = await latestDraftHtml(request, code)
  // The paragraph is inside the cell in the stored markup too, not hoisted out
  // of the table on the way through.
  expect(saved).toMatch(/<td id="flag">[\s\S]*<p>[\s\S]*<\/td>/)
})

test('dragging a block onto a cell drops it inside', async ({ page, request }) => {
  const code = uniqueCode('cell-drop')
  await createTemplate(request, code, `<p id="loose">move me</p>\n${TABLE}`)
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('#loose').click()

  const grip = page.locator('.el-toolbar .grip')
  const gripBox = (await grip.boundingBox())!
  const cellBox = (await frame.locator('#flag').boundingBox())!

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, { steps: 8 })
  // A cell offers an inside, so the indicator is the cell itself rather than a
  // line above or below it.
  await expect(page.locator('.drop-inside')).toHaveCount(1)
  await page.mouse.up()

  await expect(frame.locator('#flag #loose')).toHaveCount(1)
})
