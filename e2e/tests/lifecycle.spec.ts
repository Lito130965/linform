import { expect, test } from '@playwright/test'
import {
  createTemplate,
  createTemplateWithDraftOnly,
  exampleHtml,
  goToTab,
  openTemplate,
  saveDraft,
  showPreview,
  templateDetail,
  uniqueCode,
} from './support'

/**
 * The promise the service makes to a consuming application: a stable code
 * renders whichever version is current, published versions are immutable, and
 * unpublished work is not reachable at all. Driven through the UI a person
 * uses, then verified through the API a consumer calls.
 */

test('an unpublished draft is invisible to a consuming application', async ({ page, request }) => {
  const code = uniqueCode('draft-only')
  await createTemplateWithDraftOnly(request, code, '<p>work in progress: {{ who }}</p>')

  // Nothing to serve by code...
  const byCode = await request.post(`/api/render/${code}`, { data: { who: 'nobody' } })
  expect(byCode.status(), 'a draft must not be renderable by code').toBe(404)

  // ...and no number to pin, however hard a caller guesses.
  for (const guess of [1, 2, 3]) {
    const pinned = await request.post(`/api/render/${code}/versions/${guess}`, { data: {} })
    expect(pinned.status(), `version ${guess} must not exist`).toBe(404)
  }

  // The editor still opens it — that is where a draft is meant to be seen.
  await openTemplate(page, code)
  await expect(page.getByRole('button', { name: /Publish/i })).toBeEnabled()
})

test('publish from the editor, render by code, then roll back', async ({ page, request }) => {
  const code = uniqueCode('cycle')
  await createTemplateWithDraftOnly(request, code, '<p>version one: {{ who }}</p>')

  await openTemplate(page, code)
  await page.getByRole('button', { name: /^Publish$/ }).click()

  // v1 is live.
  await expect
    .poll(async () => (await templateDetail(request, code)).current_version)
    .toBe(1)
  const first = await request.post(`/api/render/${code}`, { data: { who: 'world' } })
  expect(first.ok(), `render by code: ${first.status()}`).toBeTruthy()
  expect(first.headers()['x-linform-version']).toBe('1')

  // Edit and publish again — saving a change to a published version starts a
  // new draft, because a published version cannot be edited.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('<p>second</p>')
  await saveDraft(page, 'second version')
  await page.getByRole('button', { name: /^Publish$/ }).click()

  await expect
    .poll(async () => (await templateDetail(request, code)).current_version)
    .toBe(2)

  // Rollback: point consumers back at v1 from the history drawer.
  await page.getByRole('button', { name: /History/i }).click()
  await page.getByRole('button', { name: /Make current/i }).first().click()

  await expect
    .poll(async () => (await templateDetail(request, code)).current_version)
    .toBe(1)

  const detail = await templateDetail(request, code)
  expect(detail.versions).toHaveLength(2)
  expect(detail.versions.filter((v) => v.status === 'published')).toHaveLength(1)

  // A pinned version keeps rendering regardless of what is current.
  const pinned = await request.post(`/api/render/${code}/versions/2`, { data: { who: 'world' } })
  expect(pinned.headers()['x-linform-version']).toBe('2')
})

test('a draft can be deleted without touching what consumers get', async ({ page, request }) => {
  const code = uniqueCode('discard')
  await createTemplate(request, code, '<p>published: {{ who }}</p>')

  await openTemplate(page, code)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('<p>experiment</p>')
  await saveDraft(page, 'an experiment')

  await expect.poll(async () => (await templateDetail(request, code)).drafts.length).toBe(1)

  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: /History/i }).click()
  await page.getByRole('button', { name: /^Delete$/i }).first().click()

  await expect.poll(async () => (await templateDetail(request, code)).drafts.length).toBe(0)
  // What consumers get never moved.
  const rendered = await request.post(`/api/render/${code}`, { data: { who: 'world' } })
  expect(rendered.headers()['x-linform-version']).toBe('1')
})

test('archiving stops rendering by code but not by pin', async ({ request }) => {
  const code = uniqueCode('archive')
  await createTemplate(request, code, '<p>filed: {{ who }}</p>')

  const archived = await request.delete(`/api/templates/${code}`)
  expect(archived.ok(), `archive: ${archived.status()}`).toBeTruthy()

  const byCode = await request.post(`/api/render/${code}`, { data: { who: 'world' } })
  expect(byCode.status(), 'an archived template stops rendering by code').toBe(410)

  const pinned = await request.post(`/api/render/${code}/versions/1`, { data: { who: 'world' } })
  expect(pinned.ok(), 'a pinned version must survive archiving').toBeTruthy()

  const restored = await request.post(`/api/templates/${code}/restore`)
  expect(restored.ok()).toBeTruthy()
  expect((await request.post(`/api/render/${code}`, { data: { who: 'world' } })).ok()).toBeTruthy()
})

test('the examples gallery opens a template that cannot be saved', async ({ page }) => {
  await page.goto('/')
  await goToTab(page, 'Examples')
  await expect(page.locator('.example-card').first()).toBeVisible()

  await page.locator('.example-card', { hasText: 'Invoice' }).click()
  await expect(page.locator('.template-code')).toContainText('not saved')

  // Scratch mode: the persistence controls are simply absent.
  await expect(page.getByRole('button', { name: /Save (as )?draft/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Publish$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /History/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Back to examples/i })).toBeVisible()
})

test('the live preview produces a PDF', async ({ page, request }) => {
  const code = uniqueCode('preview')
  await createTemplate(request, code, exampleHtml('certificate'))
  await openTemplate(page, code)
  // At this width the preview starts put away; this test is about what it
  // does once it is open.
  await showPreview(page)

  // The preview pane renders through the same endpoint the consumer calls;
  // waiting on the response proves the whole path works from the browser.
  const response = await page.waitForResponse(
    (r) => r.url().includes('/api/render') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  expect(response.ok(), `preview render: ${response.status()}`).toBeTruthy()
  expect(response.headers()['content-type']).toContain('application/pdf')
})
