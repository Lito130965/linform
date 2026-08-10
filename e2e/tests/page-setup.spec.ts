import { expect, test } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  exampleHtml,
  latestDraftHtml,
  openTemplate,
  saveDraft,
  uniqueCode,
} from './support'

/**
 * The page itself.
 *
 * There used to be a "Page: A4" menu here that changed the canvas and nothing
 * else: choose A5 and the sheet became A5 while the PDF went on printing A4,
 * with nothing anywhere saying so. Size, margins and background live in the
 * template's `@page` rule, and that is what these controls write — so the two
 * halves of this test, the canvas and the saved markup, are the same claim
 * checked from both ends.
 */

test.use({ viewport: { width: 1680, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'

const DOC =
  '<style>\n  @page { size: A4; margin: 20mm 15mm; }\n  body { font-size: 11pt; }\n</style>\n' +
  '<h1 id="title">Report</h1>\n'

async function openSetup(page: import('@playwright/test').Page) {
  await page.locator('.canvas-topbar button', { hasText: 'Page:' }).click()
  await expect(page.locator('.page-setup')).toBeVisible()
}

test('the page control says what the document says', async ({ page, request }) => {
  const code = uniqueCode('page-read')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  await expect(page.locator('.canvas-topbar button', { hasText: 'Page:' })).toHaveText(/A4/)
  await openSetup(page)
  await expect(page.locator('.page-setup input[aria-label="top margin in millimetres"]')).toHaveValue(
    '20',
  )
  await expect(
    page.locator('.page-setup input[aria-label="left margin in millimetres"]'),
  ).toHaveValue('15')
})

test('changing the size changes the sheet and the template together', async ({ page, request }) => {
  const code = uniqueCode('page-size')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  const sheetWidth = () =>
    page.locator(CANVAS).evaluate((el) => Number((el as HTMLIFrameElement).style.width.replace('px', '')))
  expect(await sheetWidth()).toBe(794) // A4 at 96dpi

  await openSetup(page)
  await page.locator('.page-setup select').selectOption('A5')
  await expect.poll(sheetWidth).toBe(559) // A5

  await page.locator('.page-setup button', { hasText: 'Landscape' }).click()
  await expect.poll(sheetWidth).toBe(794) // A5 turned on its side

  await page.keyboard.press('Escape')
  await saveDraft(page, 'A5 landscape')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toMatch(/size:\s*A5 landscape/)
  // And the rest of the stylesheet is where it was.
  expect(saved).toContain('body { font-size: 11pt; }')
})

test('a margin written here is the margin the canvas positions from', async ({ page, request }) => {
  const code = uniqueCode('page-margin')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  const titleLeft = async () => {
    const sheet = (await page.locator(CANVAS).boundingBox())!
    const title = (await frame.locator('#title').boundingBox())!
    return title.x - sheet.x
  }
  const before = await titleLeft()

  await openSetup(page)
  await page.locator('.page-setup input[aria-label="left margin in millimetres"]').fill('40')
  await page.keyboard.press('Enter')

  // The content moves because the body IS the page area (canvas-geometry.spec).
  await expect.poll(titleLeft).toBeGreaterThan(before + 20)

  await page.keyboard.press('Escape')
  await saveDraft(page, 'wider left margin')
  expect(await latestDraftHtml(request, code)).toMatch(/margin:\s*20mm 40mm 20mm 40mm|margin:[^;]*40mm/)
})

test('a page background can be set, and it reaches the PDF', async ({ page, request }) => {
  const code = uniqueCode('page-bg')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  await openSetup(page)
  await page.locator('.page-setup input[aria-label="Background colour"]').fill('#ffcc00')
  await page.keyboard.press('Escape')

  await saveDraft(page, 'a background')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toMatch(/@page[\s\S]*background:\s*#ffcc00/i)
})

test('it says when a block further down the stylesheet owns a margin', async ({ page, request }) => {
  // The report's header block reserves its own top margin with a second @page
  // rule. That rule wins in print, so the panel says so instead of appearing
  // not to work when the number it wrote does not take effect.
  const code = uniqueCode('page-override')
  await createTemplate(request, code, exampleHtml('report'))
  await openTemplate(page, code)
  await enterVisual(page)

  await openSetup(page)
  // Both, in that document: the header block reserves the top margin and the
  // footer and page-number blocks reserve the bottom.
  const note = page.locator('.page-setup .page-note').first()
  await expect(note).toContainText('top is')
  await expect(note).toContainText('bottom is')
  await expect(page.locator('.page-setup .page-overridden')).toHaveCount(2)
})
