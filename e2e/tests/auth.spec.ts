import { expect, test } from '@playwright/test'
import { goToTab } from './support'

/**
 * Runs against the instance with accounts enabled (see run.sh). Everything
 * else in this suite drives dev mode, where auth is off by design, so this is
 * the only place the login gate is exercised end to end.
 */
const USERNAME = process.env.E2E_SUPERUSER ?? 'e2e-admin'
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password-1'

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: /Sign in/i }).click()
}

test('the editor is behind a login when accounts are enabled', async ({ page }) => {
  await page.goto('/')
  // Nothing of the application is reachable before signing in.
  await expect(page.locator('.login-card')).toBeVisible()
  await expect(page.locator('.nav-item', { hasText: 'Templates' })).toHaveCount(0)
})

test('a wrong password is refused without saying which part was wrong', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill('definitely-not-it')
  await page.getByRole('button', { name: /Sign in/i }).click()

  const error = page.locator('.login-error')
  await expect(error).toBeVisible()
  // The message must not distinguish "no such user" from "wrong password".
  await expect(error).toContainText(/invalid username or password/i)
  await expect(page.locator('.login-card')).toBeVisible()
})

test('sign in, work, sign out', async ({ page }) => {
  await signIn(page)

  // The shell is there, and it knows who we are.
  await expect(page.locator('.account-name')).toHaveText(USERNAME)
  await expect(page.locator('.account-role')).toHaveText('superuser')
  await expect(page.locator('.nav-item', { hasText: 'Templates' })).toBeVisible()

  // A superuser can reach account management.
  await goToTab(page, 'Settings')
  await expect(page.getByRole('heading', { name: /Users/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Render API keys/i })).toBeVisible()

  await page.getByRole('button', { name: /Sign out/i }).click()
  await expect(page.locator('.login-card')).toBeVisible()
})

test('a session that stops working drops back to the login screen', async ({ page }) => {
  await signIn(page)
  await expect(page.locator('.nav-item', { hasText: 'Templates' })).toBeVisible()

  // Simulate the token being revoked or expiring server-side.
  await page.evaluate(() => localStorage.setItem('linform_session', 'no-longer-valid'))
  await page.reload()

  await expect(page.locator('.login-card')).toBeVisible()
})

test('an editor user can design templates but not manage accounts', async ({ page, request }) => {
  // Create the editor account through the API as the superuser.
  const login = await request.post('/api/auth/login', {
    data: { username: USERNAME, password: PASSWORD },
  })
  expect(login.ok()).toBeTruthy()
  const token = (await login.json()).token
  const editorName = `editor-${Date.now().toString(36)}`
  const made = await request.post('/api/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
    data: { username: editorName, password: 'editor-password-1', role: 'editor' },
  })
  expect(made.ok(), `create editor: ${made.status()}`).toBeTruthy()

  await page.goto('/')
  await page.getByLabel('Username').fill(editorName)
  await page.getByLabel('Password').fill('editor-password-1')
  await page.getByRole('button', { name: /Sign in/i }).click()

  await expect(page.locator('.account-role')).toHaveText('editor')
  // Templates: yes. Account management: not offered at all.
  await goToTab(page, 'Templates')
  await expect(page.getByRole('button', { name: /New template/i })).toBeVisible()

  await goToTab(page, 'Settings')
  await expect(page.getByRole('heading', { name: /Users/i })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Render API keys/i })).toHaveCount(0)
})
