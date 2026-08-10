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
 * What can be said about one element.
 *
 * The properties bar could set a font, a colour and a box. Everything else a
 * printed form is made of — the rule under a signature, the cell that spans
 * three columns, the label sitting at the bottom of its cell, a paragraph that
 * should have been a heading — was Code only.
 */

test.use({ viewport: { width: 1680, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'

const DOC =
  '<style>@page { size: A4; margin: 15mm }</style>\n' +
  '<p id="line">Signed by</p>\n' +
  '<table id="t"><tbody>\n' +
  '<tr><td id="a1">a1</td><td id="b1">b1</td><td id="c1">c1</td></tr>\n' +
  '<tr><td id="a2">a2</td><td id="b2">b2</td><td id="c2">c2</td></tr>\n' +
  '</tbody></table>\n'

test('one edge can be ruled without ruling the other three', async ({ page, request }) => {
  const code = uniqueCode('el-border')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#line').click()
  await page.locator('.border-sides button[aria-label="bottom edge"]').click()
  await page.locator('select[aria-label="Border style"]').selectOption('solid')
  await page.locator('input[aria-label="Border width"]').fill('2px')
  await page.keyboard.press('Enter')

  // The line is under the paragraph and nowhere else. Asserted on what the
  // element resolves to rather than on the spelling: the browser re-serialises
  // four separate declarations into whatever shorthands it prefers, and that
  // is its business.
  const edges = await frame.locator('#line').evaluate((el) => {
    const s = getComputedStyle(el)
    return [s.borderTopStyle, s.borderLeftStyle, s.borderBottomStyle, s.borderBottomWidth]
  })
  expect(edges).toEqual(['none', 'none', 'solid', '2px'])

  await saveDraft(page, 'a rule under the signature')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('solid')
  expect(saved).toMatch(/border-bottom-width:\s*2px|border-bottom:\s*2px/)
})

test('cells merge across and down, and split again', async ({ page, request }) => {
  const code = uniqueCode('el-merge')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#a1').click()
  await page.locator('.el-toolbar button[title="Merge with the cell to the right"]').click()
  await expect(frame.locator('#a1')).toHaveAttribute('colspan', '2')
  // What the swallowed cell said came along rather than being dropped.
  await expect(frame.locator('#a1')).toContainText('b1')
  await expect(frame.locator('#b1')).toHaveCount(0)

  await page.locator('.el-toolbar button[title="Merge with the cell below"]').click()
  await expect(frame.locator('#a1')).toHaveAttribute('rowspan', '2')

  await page.locator('.el-toolbar button[title="Split this merged cell"]').click()
  await expect(frame.locator('#a1')).not.toHaveAttribute('colspan', /.*/)
  await expect(frame.locator('#t tr').first().locator('td')).toHaveCount(3)

  await saveDraft(page, 'merged and split again')
  const saved = await latestDraftHtml(request, code)
  expect(saved).not.toContain('colspan')
})

test('a label can sit at the bottom of its cell', async ({ page, request }) => {
  const code = uniqueCode('el-valign')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  await frame.locator('#a1').click()
  await page.getByLabel('Align in cell').selectOption('bottom')
  await expect(frame.locator('#a1')).toHaveAttribute('style', /vertical-align:\s*bottom/)
})

test('a paragraph can become a heading, keeping what it holds', async ({ page, request }) => {
  const code = uniqueCode('el-retag')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n' +
      '<p id="line" style="color: rgb(51, 51, 51)">Totals for {{ period }}</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)
  const frame = page.frameLocator(CANVAS)

  // At the start of the line: the middle of it is the field, and clicking a
  // field selects the field rather than the paragraph around it.
  await frame.locator('#line').click({ position: { x: 4, y: 6 } })
  await page.getByLabel('Block style').selectOption('h2')

  const heading = frame.locator('h2#line')
  await expect(heading).toHaveCount(1)
  // The field, the inline style and the text all came across.
  await expect(heading.locator('[data-jinja-expr]')).toHaveCount(1)
  await expect(heading).toHaveAttribute('style', /color/)

  await saveDraft(page, 'a heading now')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toMatch(/<h2[^>]*>Totals for \{\{ period \}\}<\/h2>/)
})
