import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, openTemplate, uniqueCode } from './support'

/**
 * Making the selection predictable.
 *
 * A click takes the nearest structural node under the pointer, which is a
 * reasonable rule and an invisible one: the canvas was a surface you pressed to
 * find out. Three things answer that — the outline showing what a click would
 * take before you take it, the path saying what the selection sits inside, and
 * Escape walking back out through it.
 */

const CANVAS = 'iframe[title="template canvas"]'

const TEMPLATE =
  '<h1>Report</h1>\n' +
  '<table><tbody><tr><td id="cell"><p id="inner">deep</p></td></tr></tbody></table>\n'

const selectedTag = (page: import('@playwright/test').Page): Promise<string> =>
  page
    .frameLocator(CANVAS)
    .locator('[data-lf-selected]')
    .evaluate((el) => el.tagName.toLowerCase())

test('the outline says what a click would take, before the click', async ({ page, request }) => {
  const code = uniqueCode('hover')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)

  await expect(page.locator('.hover-outline')).toHaveCount(0)
  await page.frameLocator(CANVAS).locator('#inner').hover()

  const outline = page.locator('.hover-outline')
  await expect(outline).toBeVisible()
  await expect(outline).toContainText('Block')
})

test('the path shows what the selection is inside, and walks back through it', async ({
  page,
  request,
}) => {
  const code = uniqueCode('crumbs')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)

  await page.frameLocator(CANVAS).locator('#inner').click()
  expect(await selectedTag(page)).toBe('p')

  const crumbs = page.locator('.crumbs .crumb')
  // Table › Row › Cell › Block — what it is inside, outermost first.
  await expect(crumbs).toHaveText(['Table', 'Row', 'Cell', 'Block'])

  await crumbs.filter({ hasText: 'Row' }).click()
  expect(await selectedTag(page)).toBe('tr')
  await expect(page.locator('.crumbs .crumb')).toHaveText(['Table', 'Row'])
})

test('escape steps out one level at a time, then lets go', async ({ page, request }) => {
  const code = uniqueCode('escape')
  await createTemplate(request, code, TEMPLATE)
  await openTemplate(page, code)
  await enterVisual(page)

  await page.frameLocator(CANVAS).locator('#inner').click()
  expect(await selectedTag(page)).toBe('p')

  for (const tag of ['td', 'tr', 'table']) {
    await page.keyboard.press('Escape')
    expect(await selectedTag(page), `Escape should have reached ${tag}`).toBe(tag)
  }

  await page.keyboard.press('Escape')
  await expect(page.frameLocator(CANVAS).locator('[data-lf-selected]')).toHaveCount(0)
})
