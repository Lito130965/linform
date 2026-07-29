import { expect, test } from '@playwright/test'
import { createTemplate, exampleHtml, listVersions, openTemplate, uniqueCode, goToTab } from './support'

/**
 * The promise the service makes to a consuming application: a stable code
 * renders whatever is published, versions are immutable, and publishing an
 * older version IS the rollback. Driven here through the UI a person actually
 * uses, then verified through the API a consumer actually calls.
 */
test('draft, publish, render by code, then roll back', async ({ page, request }) => {
  const code = uniqueCode('cycle')
  await createTemplate(request, code, '<p>version one: {{ who }}</p>')

  await openTemplate(page, code)

  // Nothing is published yet, so rendering by code has nothing to serve.
  const beforePublish = await request.post(`/api/render/${code}`, { data: { who: 'nobody' } })
  expect(beforePublish.status(), 'unpublished template must not render by code').toBe(404)

  // Publish v1 from the UI.
  await page.getByRole('button', { name: /^Publish$/ }).click()
  await expect(page.getByRole('button', { name: /Published/ })).toBeVisible()

  const rendered = await request.post(`/api/render/${code}`, { data: { who: 'world' } })
  expect(rendered.ok(), `render by code: ${rendered.status()}`).toBeTruthy()
  expect(rendered.headers()['x-linform-version']).toBe('1')

  // A second version, published in turn.
  const second = await request.put(`/api/templates/${code}`, {
    data: { html_content: '<p>version two: {{ who }}</p>', comment: 'second' },
  })
  expect(second.ok()).toBeTruthy()
  const publishSecond = await request.post(`/api/templates/${code}/publish/2`)
  expect(publishSecond.ok()).toBeTruthy()

  const nowRendered = await request.post(`/api/render/${code}`, { data: { who: 'world' } })
  expect(nowRendered.headers()['x-linform-version']).toBe('2')

  // Rollback = publish the older version again. Nothing is deleted or edited.
  const rollback = await request.post(`/api/templates/${code}/publish/1`)
  expect(rollback.ok()).toBeTruthy()
  const afterRollback = await request.post(`/api/render/${code}`, { data: { who: 'world' } })
  expect(afterRollback.headers()['x-linform-version']).toBe('1')

  const versions = await listVersions(request, code)
  expect(versions).toHaveLength(2)
  expect(versions.filter((v) => v.status === 'published')).toHaveLength(1)

  // A pinned version keeps rendering regardless of what is published.
  const pinned = await request.post(`/api/render/${code}/versions/2`, { data: { who: 'world' } })
  expect(pinned.headers()['x-linform-version']).toBe('2')
})

test('the examples gallery opens a template that cannot be saved', async ({ page }) => {
  await page.goto('/')
  await goToTab(page, 'Examples')
  await expect(page.locator('.example-card').first()).toBeVisible()

  await page.locator('.example-card', { hasText: 'Invoice' }).click()
  await expect(page.locator('.template-code')).toContainText('not saved')

  // Scratch mode: the persistence controls are simply absent.
  await expect(page.getByRole('button', { name: /Save as new version/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Publish$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /History/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Back to examples/i })).toBeVisible()
})

test('the live preview produces a PDF', async ({ page, request }) => {
  const code = uniqueCode('preview')
  await createTemplate(request, code, exampleHtml('certificate'))
  await openTemplate(page, code)

  // The preview pane renders through the same endpoint the consumer calls;
  // waiting on the response proves the whole path works from the browser.
  const response = await page.waitForResponse(
    (r) => r.url().includes('/api/render') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  expect(response.ok(), `preview render: ${response.status()}`).toBeTruthy()
  expect(response.headers()['content-type']).toContain('application/pdf')
})
