import { expect, test } from '@playwright/test'

/**
 * The public shop window.
 *
 * A demo node is a different service, not a smaller one: no accounts, nothing
 * stored, and a shell that has to cope with both absences. The failure this
 * guards against is specific and would be embarrassing on a public URL — the
 * editor asks who it is talking to, gets nothing back, and puts a sign-in card
 * in front of a service that has nobody to sign in as.
 *
 * These run against their own instance (LINFORM_ROLE=demo), which is why they
 * are a project of their own in the Playwright config.
 */

test('it opens straight into the gallery, with no sign-in and no other tab', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.example-card').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)

  const nav = page.locator('.nav .nav-item')
  await expect(nav).toHaveCount(1)
  await expect(nav).toHaveText([/Examples/])
})

test('an example opens in an editor that cannot save', async ({ page }) => {
  await page.goto('/')
  await page.locator('.example-card', { hasText: 'Invoice' }).click()

  await expect(page.locator('.template-code')).toContainText('not saved')
  await expect(page.locator('.cm-content')).toBeVisible()
  // The controls that would store something are absent, not merely refused.
  await expect(page.getByRole('button', { name: /Save (as )?draft/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Publish$/ })).toHaveCount(0)
})

test('the preview still renders a PDF, which is the point of a demo', async ({ page }) => {
  await page.goto('/')
  await page.locator('.example-card', { hasText: 'Invoice' }).click()

  const response = await page.waitForResponse(
    (r) => r.url().includes('/api/render') && r.request().method() === 'POST',
    { timeout: 30_000 },
  )
  expect(response.ok(), `preview render: ${response.status()}`).toBeTruthy()
  expect(response.headers()['content-type']).toContain('application/pdf')
})

test('nothing that stores or authenticates is reachable', async ({ request }) => {
  for (const path of ['/api/templates', '/api/assets', '/api/admin/users', '/api/auth/me']) {
    expect((await request.get(path)).status(), `${path} answered`).toBe(404)
  }
  expect((await request.post('/api/templates', { data: { code: 'x', name: 'x' } })).status()).toBe(
    404,
  )
})
