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

/**
 * A4 with 20mm margins holds about 257mm of content.
 *
 * Both fixtures are things the canvas CANNOT move out of the way, which is what
 * makes a warning worth drawing: a spacer cannot live between table rows, and
 * nothing can make a block taller than a page fit on one. Everything else is
 * moved to the next sheet now, and shown there — a warning about content the
 * canvas has already placed correctly would be noise.
 */
const CROSSING_TABLE =
  '<style>@page { size: A4; margin: 20mm }\n' +
  'table { width: 100%; border-collapse: collapse }\n' +
  'td { border: 1px solid #999; height: 30mm }</style>\n' +
  '<table><tbody>\n' +
  '  <tr><td>row one</td></tr><tr><td>row two</td></tr><tr><td>row three</td></tr>\n' +
  '  <tr><td>row four</td></tr><tr><td>row five</td></tr><tr><td>row six</td></tr>\n' +
  '  <tr><td>row seven</td></tr><tr><td>row eight</td></tr><tr><td>row nine</td></tr>\n' +
  '</tbody></table>\n'

const CROSSING_TEXT =
  '<style>@page { size: A4; margin: 20mm }</style>\n' +
  '<p style="height: 400mm">a paragraph too tall for any page to hold</p>\n'

test('a row that will move to the next page whole says so', async ({ page, request }) => {
  const code = uniqueCode('break-row')
  await createTemplate(request, code, CROSSING_TABLE)
  await openTemplate(page, code)
  await enterVisual(page)

  // There is a page break to cross in the first place.
  await expect(page.locator('.sheet-edge')).not.toHaveCount(0)

  const warning = page.locator('.break-warning.moves')
  await expect(warning).toHaveCount(1)
  await expect(warning).toContainText('moves to the next page whole')

  // It is drawn over the row, not over the whole table: a table crossing a page
  // is not news, the row that lands on the line is.
  const warned = (await warning.boundingBox())!
  const anyRow = (await page.frameLocator(CANVAS).locator('tr').first().boundingBox())!
  expect(Math.abs(warned.height - anyRow.height)).toBeLessThan(6)
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

test('the space between two sheets is real, and shows what the furniture costs', async ({
  page,
  request,
}) => {
  // The strip used to run the content bands together with a line between them:
  // the margins between sheets existed in the arithmetic and nowhere on screen,
  // so a header could only ever be seen on page one.
  const code = uniqueCode('sheet-gap')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 20mm; margin-bottom: 26mm;\n' +
      '  @top-center { content: element(lf-head) } }</style>\n' +
      '<div id="head" style="position: running(lf-head)">Quarterly report</div>\n' +
      '<div id="first" style="height: 200mm">first</div>\n' +
      '<div id="second" style="height: 60mm">second</div>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  // Two sheets, with the gap drawn between them.
  const gap = page.locator('.sheet-gap')
  await expect(gap).toHaveCount(1)
  await expect(gap.locator('.sheet-band.head')).toContainText('header')
  await expect(gap.locator('.sheet-edge')).toContainText('page 2')

  // The block that would not fit starts below the gap, on the next page's band
  // — not straddling the paper edge.
  const gapBox = (await gap.boundingBox())!
  const second = (await frame.locator('#second').boundingBox())!
  expect(second.y).toBeGreaterThan(gapBox.y + gapBox.height - 2)
})

test('the sheet does not grow a page while nothing is added', async ({ page, request }) => {
  // Pagination inserts spacing into the flow it measures, so it has to be
  // self-consistent or it feeds its own output back in. This is that, typed at.
  const code = uniqueCode('no-growth')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n' +
      '<h1 id="title">Report</h1>\n' +
      '<div style="height: 150mm">one</div>\n<div style="height: 150mm">two</div>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  const gaps = page.locator('.sheet-gap')
  const before = await gaps.count()
  expect(before).toBeGreaterThan(0)

  for (let i = 0; i < 3; i++) {
    await page.frameLocator(CANVAS).locator('#title').click()
    await page.keyboard.press('End')
    await page.keyboard.type('x')
    await page.waitForTimeout(400)
  }
  expect(await gaps.count(), 'the strip grew a sheet while nothing was added').toBe(before)
})
