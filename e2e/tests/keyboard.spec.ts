import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, latestDraftHtml, openTemplate, saveDraft, uniqueCode } from './support'

/**
 * The visual canvas, driven without a mouse.
 *
 * Unit tests already decide what each key means. What they cannot show is that
 * the keys arrive at all: the canvas lives in an iframe, its document is
 * contenteditable, and a browser has opinions about all three. So this drives a
 * real Chromium and only ever presses keys.
 *
 * Not one click, not even on empty background: focus goes to the canvas the way
 * Tab would leave it, and every selection after that is the keyboard's doing.
 * (The first version of this file clicked at 5,5 to "focus without selecting",
 * which selected the first element — these templates carry no page margins, so
 * the very corner of the sheet is already inside the heading.)
 */

const CANVAS = 'iframe[title="template canvas"]'

test('select, enter and remove an element with the keyboard alone', async ({ page, request }) => {
  const code = uniqueCode('kbd')
  await createTemplate(
    request,
    code,
    '<h1>Report</h1>\n<p>First paragraph</p>\n<p>Second paragraph</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('body').focus()
  await expect(frame.locator('[data-lf-selected]')).toHaveCount(0)

  // Alt+Down with nothing selected is the way in.
  await page.keyboard.press('Alt+ArrowDown')
  await expect(frame.locator('[data-lf-selected]')).toHaveText('Report')

  await page.keyboard.press('Alt+ArrowDown')
  await expect(frame.locator('[data-lf-selected]')).toHaveText('First paragraph')

  await page.keyboard.press('Alt+ArrowUp')
  await expect(frame.locator('[data-lf-selected]')).toHaveText('Report')

  // Escape lets go.
  await page.keyboard.press('Escape')
  await expect(frame.locator('[data-lf-selected]')).toHaveCount(0)

  // Down twice to the first paragraph, then remove it.
  await page.keyboard.press('Alt+ArrowDown')
  await page.keyboard.press('Alt+ArrowDown')
  await expect(frame.locator('[data-lf-selected]')).toHaveText('First paragraph')
  await page.keyboard.press('Alt+Delete')

  await expect(frame.locator('p', { hasText: 'First paragraph' })).toHaveCount(0)
  await expect(frame.locator('p', { hasText: 'Second paragraph' })).toHaveCount(1)

  await saveDraft(page, 'removed a paragraph with the keyboard')
  const saved = await latestDraftHtml(request, code)
  expect(saved).not.toContain('First paragraph')
  expect(saved).toContain('Second paragraph')
  expect(saved).toContain('Report')
})

test('alt+enter hands the selected element to the caret', async ({ page, request }) => {
  const code = uniqueCode('kbd-edit')
  await createTemplate(request, code, '<h1>Heading</h1>\n<p>Body text</p>\n')
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('body').focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(frame.locator('[data-lf-selected]')).toHaveText('Heading')

  // Alt+Enter puts the caret at the end of the node; typing then goes there and
  // nowhere else, which is the whole point of separating the two modes.
  await page.keyboard.press('Alt+Enter')
  await page.keyboard.type(' EDITED')
  await expect(frame.locator('h1')).toHaveText('Heading EDITED')
  await expect(frame.locator('p')).toHaveText('Body text')

  await saveDraft(page, 'typed after alt+enter')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('EDITED')
})

test('an edit in the canvas is reported while the canvas is still open', async ({ page, request }) => {
  /**
   * The canvas reports its changes to the editor on a debounce. Every other
   * test in this suite happened to leave visual mode before saving, and leaving
   * flushes — so nothing here has ever checked that the report arrives on its
   * own. The live preview and the unsaved marker both depend on it.
   */
  const code = uniqueCode('kbd-dirty')
  await createTemplate(request, code, '<h1>Heading</h1>\n<p>Body</p>\n')
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('body').focus()
  await page.keyboard.press('Alt+ArrowDown')
  await page.keyboard.press('Alt+ArrowDown')
  await page.keyboard.press('Alt+Delete')

  await expect(page.locator('.dirty-badge')).toHaveCount(1)
})

test('the shortcuts are written down where somebody can find them', async ({ page, request }) => {
  // A shortcut nobody can discover is a shortcut nobody has, and the canvas
  // offers no other hint that Alt does anything at all.
  const code = uniqueCode('kbd-hint')
  await createTemplate(request, code, '<p>anything</p>')
  await openTemplate(page, code)
  await enterVisual(page)

  const hint = page.locator('.canvas-keys')
  await expect(hint.locator('summary')).toBeVisible()
  await hint.locator('summary').click()
  await expect(hint).toContainText('Alt + Enter')
  await expect(hint).toContainText('Esc')
})
