import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, latestDraftHtml, openTemplate, saveDraft, uniqueCode } from './support'

/**
 * The right-click menu over the canvas.
 *
 * Everything in it exists elsewhere — the properties bar, the structure panel,
 * the Alt shortcuts — and every one of those had to be looked for first. A
 * context menu is where people look before they look anywhere else, and it is
 * the only place that can show what applies to THIS element without a bar of
 * controls that mostly do not.
 */

test.use({ viewport: { width: 1680, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'

const DOC =
  '<style>@page { size: A4; margin: 20mm }</style>\n' +
  '<h1 id="title">Report</h1>\n' +
  '<p id="first">First paragraph</p>\n' +
  '<p id="field">Bill to {{ customer }}</p>\n'

test('right-click selects what is under the pointer and offers what fits it', async ({
  page,
  request,
}) => {
  const code = uniqueCode('menu')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#first').click({ button: 'right' })
  const menu = page.locator('.canvas-menu')
  await expect(menu).toBeVisible()
  // The menu and the properties bar are about the same element: right-clicking
  // selects, so the two can never disagree.
  await expect(frame.locator('[data-lf-selected]')).toHaveText('First paragraph')
  await expect(menu).toContainText('Duplicate')
  await expect(menu).toContainText('Delete')
  // A paragraph carries no Jinja, so there is nothing to edit as an expression.
  await expect(menu.getByRole('menuitem', { name: 'Edit expression…' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('a field offers its expression, and the menu edits it', async ({ page, request }) => {
  const code = uniqueCode('menu-expr')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#field [data-jinja-expr]').click({ button: 'right' })
  await page.locator('.canvas-menu').getByRole('menuitem', { name: 'Edit expression…' }).click()
  // Choosing an item puts the menu away — a menu that stays open over the thing
  // it just changed hides the result of the change.
  await expect(page.locator('.canvas-menu')).toHaveCount(0)

  const dialog = page.getByRole('dialog', { name: 'Field' })
  await dialog.getByLabel('Field expression').fill('customer.name')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(frame.locator('#field')).toContainText('{{ customer.name }}')
})

test('delete from the menu removes the element from the document', async ({ page, request }) => {
  const code = uniqueCode('menu-delete')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#first').click({ button: 'right' })
  await page.locator('.canvas-menu').getByRole('menuitem', { name: 'Delete' }).click()
  await expect(frame.locator('#first')).toHaveCount(0)

  await saveDraft(page, 'deleted from the context menu')
  const saved = await latestDraftHtml(request, code)
  expect(saved).not.toContain('First paragraph')
  expect(saved).toContain('Report')
})

test('the page margin keeps the browser its own menu', async ({ page, request }) => {
  // Outside the document there is nothing structural to act on, and the
  // browser's menu still carries spelling suggestions and the clipboard.
  // Replacing that with nothing would be a loss.
  const code = uniqueCode('menu-margin')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  const sheet = (await page.locator(CANVAS).boundingBox())!
  await page.mouse.click(sheet.x + sheet.width / 2, sheet.y + 6, { button: 'right' })
  await expect(page.locator('.canvas-menu')).toHaveCount(0)
})
