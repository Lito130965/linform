import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests run against a BUILT IMAGE, not a dev server — so the bundle,
 * the Python service and the CSP headers under test are the ones that ship.
 * e2e/run.sh starts two containers (auth off, auth on) and points these at
 * them; see that script for the ports.
 *
 * The editor is a wide-screen tool by design (frontend/src/layout.ts warns
 * below 1280px), so the viewport is set accordingly — at a laptop width the
 * app renders its "too narrow" interstitial and every test would be testing
 * that instead.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // the tests share one service instance and its database
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.LINFORM_E2E_URL ?? 'http://localhost:8101',
    viewport: { width: 1680, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'editor',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /(auth|demo)\.spec\.ts/,
    },
    {
      name: 'auth',
      // A separate instance with accounts enabled: dev mode (no auth at all)
      // is what the other project exercises, and they cannot coexist in one
      // process.
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.LINFORM_E2E_AUTH_URL ?? 'http://localhost:8102',
      },
      testMatch: /auth\.spec\.ts/,
    },
    {
      name: 'demo',
      // A third instance, because a demo is a different service: no accounts,
      // no stored templates, and a shell that has to cope with both absences.
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.LINFORM_E2E_DEMO_URL ?? 'http://localhost:8103',
      },
      testMatch: /demo\.spec\.ts/,
    },
  ],
})
