import { expect, test } from '@playwright/test'
import { createTemplate, enterVisual, latestDraftHtml, openTemplate, saveDraft, uniqueCode } from './support'

/**
 * Dropping an image on the page.
 *
 * What somebody tries first, and what the browser used to answer by navigating
 * the canvas to the file: the document was replaced by a picture of a logo.
 * The alternative offered was to find the Assets tab, press Upload, find the
 * file in a dialog, and then find where it went.
 */

test.use({ viewport: { width: 1680, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'

const DOC =
  '<style>@page { size: A4; margin: 15mm }</style>\n' +
  '<h1 id="title">Report</h1>\n<p id="line">Body text</p>\n'

/** A file, built inside the canvas document so the DataTransfer belongs to the
 * same context as the element it is dropped on. */
async function fileDrop(frame: import('@playwright/test').Frame) {
  return frame.evaluateHandle(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgo='), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'logo.png', { type: 'image/png' }))
    return transfer
  })
}

test('an image dropped on the page is stored and placed where it landed', async ({
  page,
  request,
}) => {
  const code = uniqueCode('drop')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  const canvas = (await page.locator(CANVAS).elementHandle())!
  const frame = (await canvas.contentFrame())!
  const dataTransfer = await fileDrop(frame)

  // Said, before it is dropped: a target that gives no sign it is one cannot be
  // told apart from a page that will refuse the file.
  await frame.locator('#line').dispatchEvent('dragover', { dataTransfer })
  await expect(page.locator('.drop-veil')).toBeVisible()

  await frame.locator('#line').dispatchEvent('drop', { dataTransfer })
  await expect(page.locator('.drop-veil')).toHaveCount(0)

  const image = page.frameLocator(CANVAS).locator('img')
  await expect(image).toHaveCount(1)
  await expect(page.locator('.toast')).toContainText('logo.png')

  // It travels as an asset reference, not as bytes in the template.
  await saveDraft(page, 'dropped a logo')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('asset://')
  expect(saved).not.toContain('data:image')
})
