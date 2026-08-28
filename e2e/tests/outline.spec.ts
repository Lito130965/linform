import { expect, test, type Page } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  inspectorTab,
  latestDraftHtml,
  openTemplate,
  saveDraft,
  uniqueCode,
} from './support'

/**
 * The structure panel.
 *
 * It exists because a click can only ever take one of the several things
 * sharing a cell's pixels. So the claims worth holding are: the list names all
 * of them, taking one from the list selects exactly that one, a selection made
 * in the canvas can be found in the list, and hiding a row changes what you see
 * without changing the template.
 *
 * Wide on purpose. The panel reserves a column of its own, so below 1600px it
 * starts closed rather than squeezing the canvas — the toggle test below is the
 * one that covers the other state.
 */

test.use({ viewport: { width: 1680, height: 1000 } })

const CANVAS = 'iframe[title="template canvas"]'

const NESTED =
  '<style>@page { size: A4; margin: 15mm }</style>\n' +
  '<h1>Report</h1>\n' +
  '<table><tr><td>the cell</td></tr></table>\n'

test('it names every level, including the ones a click cannot reach', async ({ page, request }) => {
  const code = uniqueCode('outline')
  await createTemplate(request, code, NESTED)
  await openTemplate(page, code)
  await enterVisual(page)
  // The inspector opens on Properties; the structure is the tab beside it.
  await inspectorTab(page, 'Structure')

  const labels = page.locator('.canvas-outline .outline-label')
  await expect(labels).toHaveText(['Heading 1', 'Table', 'Row', 'Cell'])

  // The <tbody> the parser inserted is not among them: a level nobody can
  // select is a level nobody wants to walk past.
  await expect(labels.filter({ hasText: 'Block' })).toHaveCount(0)
})

test('taking a row from the list selects that element and not its neighbour', async ({
  page,
  request,
}) => {
  const code = uniqueCode('outline-pick')
  await createTemplate(request, code, NESTED)
  await openTemplate(page, code)
  await enterVisual(page)
  // The inspector opens on Properties; the structure is the tab beside it.
  await inspectorTab(page, 'Structure')

  // The row — not the cell inside it, not the table around it. That is the pick
  // a click in the canvas cannot express.
  await page.locator('.canvas-outline .outline-row', { hasText: 'Row' }).click()

  const chosen = page.frameLocator(CANVAS).locator('[data-lf-selected]')
  await expect(chosen).toHaveCount(1)
  expect(await chosen.evaluate((el) => el.tagName)).toBe('TR')
})

test('a selection made in the canvas is findable in the list', async ({ page, request }) => {
  const code = uniqueCode('outline-sync')
  await createTemplate(request, code, NESTED)
  await openTemplate(page, code)
  await enterVisual(page)
  // The inspector opens on Properties; the structure is the tab beside it.
  await inspectorTab(page, 'Structure')

  await page.frameLocator(CANVAS).locator('td').first().click()
  const current = page.locator('.canvas-outline .outline-item.current')
  await expect(current).toHaveCount(1)
  await expect(current.locator('.outline-label')).toHaveText('Cell')
})

/** Hide the first block whose row says `label`. */
async function hideRow(page: Page, label: string) {
  const row = page.locator('.canvas-outline .outline-item', { hasText: label })
  await row.hover()
  await row.locator('.outline-eye').click()
}

test('hiding a block takes it out of sight without moving anything', async ({ page, request }) => {
  const code = uniqueCode('outline-hide')
  await createTemplate(request, code, NESTED)
  await openTemplate(page, code)
  await enterVisual(page)
  // The inspector opens on Properties; the structure is the tab beside it.
  await inspectorTab(page, 'Structure')

  const heading = page.frameLocator(CANVAS).locator('h1')
  const tableTop = () =>
    page
      .frameLocator(CANVAS)
      .locator('table')
      .evaluate((el) => el.getBoundingClientRect().top)

  await expect(heading).toBeVisible()
  const before = await tableTop()

  await hideRow(page, 'Heading 1')
  await expect(heading).toBeHidden()

  // Hidden, not removed. The box keeps its size, so nothing below it moved —
  // which is what lets the canvas go on telling the truth about page breaks
  // while a full-bleed background is out of the way.
  expect(Math.abs((await tableTop()) - before)).toBeLessThan(1)
  await expect(page.locator('.canvas-outline .outline-note')).toContainText('still print')

  await page.locator('.canvas-outline .outline-note .linkish').click()
  await expect(heading).toBeVisible()
  await expect(page.locator('.canvas-outline .outline-note')).toHaveCount(0)
})

test('what is hidden in the canvas never reaches the template', async ({ page, request }) => {
  const code = uniqueCode('outline-hide-save')
  await createTemplate(request, code, NESTED)
  await openTemplate(page, code)
  await enterVisual(page)
  // The inspector opens on Properties; the structure is the tab beside it.
  await inspectorTab(page, 'Structure')

  await hideRow(page, 'Heading 1')
  await expect(page.frameLocator(CANVAS).locator('h1')).toBeHidden()

  await saveDraft(page, 'saved with a block hidden')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('<h1>Report</h1>')
  expect(saved).not.toContain('data-lf-hidden')

  // Saving a new draft re-opens the editor on it, and the canvas is built again
  // from the saved markup — so the hiding, which lives only in the canvas, is
  // gone. That is the same fact from the other side, and the reason nothing
  // here is worth worrying about losing.
  await expect(page.frameLocator(CANVAS).locator('h1')).toBeVisible()
})

test('the panel can be put away and brought back', async ({ page, request }) => {
  const code = uniqueCode('outline-toggle')
  await createTemplate(request, code, NESTED)
  await openTemplate(page, code)
  await enterVisual(page)
  // The inspector opens on Properties; the structure is the tab beside it.
  await inspectorTab(page, 'Structure')

  const panel = page.locator('.canvas-outline')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Hide the side panel' }).click()
  await expect(panel).toHaveCount(0)

  await page.locator('.canvas-topbar button', { hasText: 'Panel' }).click()
  await expect(panel).toBeVisible()
})
