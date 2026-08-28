import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, openTemplate, uniqueCode } from './support'

/**
 * The layout at sizes other than this suite's own.
 *
 * A file of its own, and named to sort last, for a reason that cost an
 * afternoon: a spec that changes the viewport leaves the FIRST API call of the
 * next file hanging until the timeout. Measured directly — menu.spec then
 * preview.spec passes, layout.spec then preview.spec fails on preview's first
 * line, and putting the window back at the end of each test does not help. So
 * every test that resizes lives here, where the only thing after it is the end
 * of the run.
 */

test.use({ viewport: { width: 1920, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'
const DOC = "<style>@page { size: A4; margin: 20mm }</style>\n<h1 id='title'>Report</h1>\n"

test('the inspector folds away, and the page grows into the space', async ({ page, request }) => {
  // Resized inside the test rather than in a describe with its own viewport.
  // A describe that changes the viewport makes Playwright rebuild the browser
  // context, and the test that runs after it — in this file or the next one —
  // hangs on its first API call until the timeout. Measured twice, on two
  // different victims: layout's own last test, then lifecycle's first.
  const code = uniqueCode('inspector-fold')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  // At 1920 an A4 page fits at 100 % and zoom is capped there, so folding a
  // column could not show in the read-out however well it worked. Narrow the
  // window until the page is being scaled — but stay above 1280, where the
  // inspector stops being a column at all.
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.getByRole('separator', { name: 'Resize the inspector' }).focus()
  await page.keyboard.press('End')

  const zoom = page.locator('.zoom-value')
  await expect(zoom).not.toHaveText('100%')
  const before = await zoom.textContent()

  await page.keyboard.press('Control+.')
  await expect(page.locator('.canvas-outline')).toHaveCount(0)
  await expect(page.locator('.pane-strip', { hasText: 'INSPECTOR' })).toHaveCount(1)
  // Re-fitted rather than left at the size it had: the column it was sharing
  // with is gone.
  await expect(zoom).not.toHaveText(before!)

  await page.keyboard.press('Control+.')
  await expect(page.locator('.canvas-outline')).toHaveCount(1)
  await expect(zoom).toHaveText(before!)
  await page.setViewportSize({ width: 1920, height: 1000 })
})

test('at a laptop width the page keeps the room, and the columns give way', async ({
  page,
  request,
}) => {
  // 1280 is the commonest laptop width there is. Two columns beside an A4 sheet
  // leave neither worth looking at, so at this size the preview becomes a
  // choice — canvas or preview — and the inspector is drawn over the page
  // rather than taking width from it.
  const code = uniqueCode('narrow')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await page.setViewportSize({ width: 1280, height: 860 })

  await expect(page.locator('.preview-pane')).toHaveCount(0)
  const column = (await page.locator('.code-pane').boundingBox())!
  expect(column.width).toBeGreaterThanOrEqual(1100)
  await expect(page.locator('.zoom-value')).toHaveText('100%')

  // The inspector is over the page, so the page keeps its width whether it is
  // open or shut.
  await expect(page.locator('.canvas-outline.overlay')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.canvas-outline')).toHaveCount(0)
  expect((await page.locator('.code-pane').boundingBox())!.width).toBeCloseTo(column.width, 0)

  // One of the two, chosen.
  await page.getByRole('tab', { name: 'Preview' }).click()
  await expect(page.locator('.preview')).toBeVisible()
  await expect(page.locator(CANVAS)).toHaveCount(0)
  await page.getByRole('tab', { name: 'Canvas' }).click()
  await expect(page.locator(CANVAS)).toHaveCount(1)
  await page.setViewportSize({ width: 1920, height: 1000 })
})

test('a 950px window opens the editor instead of refusing it', async ({ page, request }) => {
  // The floor was 1000 while the columns took width unconditionally. They no
  // longer do, and a whole A4 page fits here — refusing to open was the editor
  // being careful about a problem it does not have any more.
  const code = uniqueCode('narrow-floor')
  await createTemplate(request, code, DOC)
  await page.setViewportSize({ width: 950, height: 860 })
  await openTemplate(page, code)

  await expect(page.locator('.too-narrow')).toHaveCount(0)
  await enterVisual(page)
  await expect(page.locator(CANVAS)).toHaveCount(1)
  // Put the window back. A test that ends at a size of its own leaves the next
  // one's first API call hanging until the timeout — measured three times now,
  // on three different victims, and cheaper to avoid than to explain.
  await page.setViewportSize({ width: 1920, height: 1000 })
})
