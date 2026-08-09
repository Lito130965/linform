import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, openTemplate, uniqueCode } from './support'

/**
 * Saying what a page break will do to what it crosses.
 *
 * The canvas draws the document as one continuous strip and marks where each
 * printed page ends. That line is honest about the boundary and silent about
 * the consequence, and "it looked right in the editor and printed differently"
 * is the complaint this class of tool collects. The gap cannot be closed
 * without laying the document out twice; it can be made predictable.
 *
 * Which unit a break is about, and whether it moves or splits, is unit-tested.
 * What needs a browser is whether the boundary lands where the engine puts it
 * and whether the right element is picked out of a real layout.
 */

const CANVAS = 'iframe[title="template canvas"]'

/** A4 with 20mm margins holds about 257mm of content, so a block of 240mm plus
 * a table pushes the table across the first boundary. */
const CROSSING_TABLE =
  '<style>@page { size: A4; margin: 20mm }\n' +
  'table { width: 100%; border-collapse: collapse }\n' +
  'td { border: 1px solid #999; height: 30mm }</style>\n' +
  '<div style="height: 240mm">tall block</div>\n' +
  '<table><tbody>\n' +
  '  <tr><td>row one</td></tr>\n' +
  '  <tr><td>row two</td></tr>\n' +
  '</tbody></table>\n'

const CROSSING_TEXT =
  '<style>@page { size: A4; margin: 20mm }</style>\n' +
  '<div style="height: 240mm">tall block</div>\n' +
  '<p style="height: 60mm">a paragraph long enough to reach across the break</p>\n'

test('a row that will move to the next page whole says so', async ({ page, request }) => {
  const code = uniqueCode('break-row')
  await createTemplate(request, code, CROSSING_TABLE)
  await openTemplate(page, code)
  await enterVisual(page)

  // There is a page break to cross in the first place.
  await expect(page.locator('.page-boundary')).not.toHaveCount(0)

  const warning = page.locator('.break-warning.moves')
  await expect(warning).toHaveCount(1)
  await expect(warning).toContainText('moves to the next page whole')

  // It is drawn over the row, not over the whole table: a table crossing a page
  // is not news, the row that lands on the line is.
  const warned = (await warning.boundingBox())!
  const row = (await page.frameLocator(CANVAS).locator('tr').first().boundingBox())!
  expect(Math.abs(warned.height - row.height)).toBeLessThan(6)
})

test('a paragraph that will simply flow on says that instead', async ({ page, request }) => {
  const code = uniqueCode('break-text')
  await createTemplate(request, code, CROSSING_TEXT)
  await openTemplate(page, code)
  await enterVisual(page)

  const warning = page.locator('.break-warning.splits')
  await expect(warning).toHaveCount(1)
  await expect(warning).toContainText('splits across the break')
  await expect(page.locator('.break-warning.moves')).toHaveCount(0)
})

test('nothing is marked when the break falls between elements', async ({ page, request }) => {
  const code = uniqueCode('break-clean')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 20mm }</style>\n<p>short</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  await expect(page.locator('.break-warning')).toHaveCount(0)
})
