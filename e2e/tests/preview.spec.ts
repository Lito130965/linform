import { expect, test } from '@playwright/test'
import { createTemplate, openTemplate, showPreview, uniqueCode } from './support'

/**
 * The preview keeps the page you were reading.
 *
 * Every render produces a new object URL; the iframe reloads, and the built-in
 * viewer starts again at page one. With a 700 ms debounce that meant working on
 * page three of a document and never seeing page three — you would scroll to
 * it, type a word, and be thrown back to the top.
 *
 * What is checked here is the contract this side owns: the page the editor
 * believes it is on, and the fragment it hands the viewer. Whether Chrome's PDF
 * plugin honours `#page=` is the plugin's business and cannot be read from
 * outside the frame.
 */

const THREE_PAGES =
  '<style>@page { size: A4; margin: 15mm } .sheet { page-break-after: always }</style>\n' +
  '<div class="sheet"><h1 id="title">Page one</h1></div>\n' +
  '<div class="sheet"><h1>Page two</h1></div>\n' +
  '<div><h1>Page three</h1></div>\n'

/** The preview renders on a debounce; this waits for one to land. */
async function rendered(page: import('@playwright/test').Page, act: () => Promise<void>) {
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/render') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await act()
  expect((await response).ok()).toBeTruthy()
}

test('the page being read survives a re-render', async ({ page, request }) => {
  const code = uniqueCode('preview-page')
  await createTemplate(request, code, THREE_PAGES)
  await openTemplate(page, code)
  await rendered(page, () => showPreview(page))

  const pager = page.locator('.preview-pager')
  await expect(pager).toContainText('page 1 of 3')

  await page.getByRole('button', { name: 'Next page' }).click()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(pager).toContainText('page 3 of 3')
  await expect(page.locator('.preview-frame')).toHaveAttribute('src', /#page=3/)

  // Type into the document and let it render again: this is the moment the
  // reader used to be thrown back to page one.
  await rendered(page, async () => {
    await page.locator('.cm-content').click()
    await page.keyboard.type(' ')
  })

  await expect(pager).toContainText('page 3 of 3')
  await expect(page.locator('.preview-frame')).toHaveAttribute('src', /#page=3/)
})

test('a document that gets shorter does not leave the reader past its end', async ({
  page,
  request,
}) => {
  const code = uniqueCode('preview-shrink')
  await createTemplate(request, code, THREE_PAGES)
  await openTemplate(page, code)
  await rendered(page, () => showPreview(page))

  await page.getByRole('button', { name: 'Next page' }).click()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.locator('.preview-pager')).toContainText('page 3 of 3')

  // Take the page breaks out: three pages become one.
  await rendered(page, async () => {
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('<p>one page now</p>')
  })

  // The pager is gone with nothing left to page through, and the reader is not
  // pointing at a page that no longer exists.
  await expect(page.locator('.preview-pager')).toHaveCount(0)
  await expect(page.locator('.preview-frame')).toHaveAttribute('src', /#page=1/)
})

test('the viewer is asked for its own controls to stay out of the way', async ({
  page,
  request,
}) => {
  // The plugin's toolbar is a second set of page controls beside ours, and 40px
  // of a column that exists to show a page.
  const code = uniqueCode('preview-chrome')
  await createTemplate(request, code, THREE_PAGES)
  await openTemplate(page, code)
  await rendered(page, () => showPreview(page))

  await expect(page.locator('.preview-frame')).toHaveAttribute('src', /toolbar=0/)
  await expect(page.locator('.preview-frame')).toHaveAttribute('src', /view=FitH/)
})
