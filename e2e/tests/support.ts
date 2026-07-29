import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Read a showcase template straight from the repo, so the browser tests use
 * exactly the markup the golden PDF tests use.
 *
 * Line endings are normalized to LF: a Windows checkout stores these files with
 * CRLF, and the HTML parser folds CRLF to LF as part of preprocessing — a
 * documented benign normalization (see the BENIGN list in spike.test.ts). Left
 * alone, every round-trip assertion would fail on that alone and say nothing
 * about whether the editor rewrote any actual markup.
 */
export function exampleHtml(id: string): string {
  return readFileSync(join(__dirname, '..', '..', 'examples', `${id}.html`), 'utf-8').replace(
    /\r\n/g,
    '\n',
  )
}

export function exampleData(id: string): string {
  return readFileSync(join(__dirname, '..', '..', 'examples', `${id}.data.json`), 'utf-8')
}

/**
 * The normalizations the round trip is ALLOWED to make, mirroring the named
 * benign classes in frontend/src/editor/spike.test.ts. Growing this list is a
 * decision about the product, not a way to make a test pass: each entry is a
 * way a saved template may differ from what the author typed.
 *
 * The important one here is the last: protect() lifts a {% for %}/{% if %}
 * onto its element as an attribute and restore() re-emits it adjacent to that
 * element, so the line layout around a statement tag is not preserved.
 * Whitespace next to one is invisible to the HTML parser and to Jinja alike.
 */
export function normalizeBenign(html: string): string {
  return (
    html
      .replace(/\r\n/g, '\n') // crlf: parser preprocessing
      .replace(/<\/?tbody>/gi, '') // tbody: implied by the spec, inserted by the parser
      .replace(/&nbsp;/g, ' ') // nbsp: re-encoded on serialization
      .replace(/=\s*'([^"']*)'/g, '="$1"') // attr-quotes: serializer emits double quotes
      .replace(/\s*\/>/g, '>') // void-slash: XHTML self-closing loses the slash
      // ws-lines BEFORE jinja-ws — the order spike.test.ts uses. The two rules
      // overlap, and applying them the other way round leaves different residue
      // on each side of the comparison, which then reads as a real difference.
      .replace(/[^\S\n]+$/gm, '')
      .replace(/\n+/g, '\n')
      // jinja-ws: whitespace hugging a statement tag
      .replace(/[^\S\n]*\n?[^\S\n]*(\{%[\s\S]*?%\})[^\S\n]*\n?[^\S\n]*/g, '$1')
  )
}

/** A template code no other test will collide with. */
export function uniqueCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
}

export async function createTemplate(
  api: APIRequestContext,
  code: string,
  html: string,
  name = 'E2E template',
): Promise<void> {
  const made = await api.post('/api/templates', { data: { code, name } })
  expect(made.ok(), `create ${code}: ${made.status()}`).toBeTruthy()
  const saved = await api.put(`/api/templates/${code}`, {
    data: { html_content: html, comment: 'seed' },
  })
  expect(saved.ok(), `seed ${code}: ${saved.status()}`).toBeTruthy()
}

export async function versionHtml(
  api: APIRequestContext,
  code: string,
  version: number,
): Promise<string> {
  const resp = await api.get(`/api/templates/${code}/versions/${version}`)
  expect(resp.ok(), `fetch ${code} v${version}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).html_content
}

export async function listVersions(api: APIRequestContext, code: string) {
  const resp = await api.get(`/api/templates/${code}`)
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).versions as { version: number; status: string }[]
}

/** Click a top-level nav tab.
 *
 * Scoped to `.nav-item` on purpose: matching by accessible name alone is
 * ambiguous — the journal's "All templates" bucket also reads as "Templates",
 * and Playwright's strict mode rightly refuses to guess between them.
 */
export async function goToTab(page: Page, tab: 'Templates' | 'Examples' | 'Settings'): Promise<void> {
  await page.locator('.nav-item', { hasText: tab }).click()
}

/** Open a stored template in the editor, waiting until its content is loaded. */
export async function openTemplate(page: Page, code: string): Promise<void> {
  await page.goto('/')
  await goToTab(page, 'Templates')
  // The journal row shows the display NAME as the link and the code in its own
  // cell, so find the row by code and click the link inside it.
  const row = page.locator('.journal-table tr', { hasText: code })
  await expect(row).toHaveCount(1)
  await row.locator('.link-btn').click()
  // The toolbar carries the template code once the editor has it.
  await expect(page.locator('.template-code')).toContainText(code)
  await expect(page.locator('.cm-content')).toBeVisible()
}

/** Switch to the visual canvas and wait for the iframe document to be ready. */
export async function enterVisual(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Visual', exact: true }).click()
  const frame = page.frameLocator('iframe[title="template canvas"]')
  await expect(frame.locator('body')).toBeVisible()
  // The canvas paginates and measures after mount; give that a settled moment
  // so a screenshot or an edit does not race the first layout pass.
  await page.waitForTimeout(500)
}

export async function backToCode(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await expect(page.locator('.cm-content')).toBeVisible()
}

/** Save the editor's current content as a new version. */
export async function saveVersion(page: Page, comment = 'from e2e'): Promise<void> {
  await page.getByPlaceholder(/What changed/i).fill(comment)
  await page.getByRole('button', { name: /Save as new version/i }).click()
  // The version selector gains the new entry; wait for the save to land.
  await expect(page.locator('.dirty-badge')).toHaveCount(0, { timeout: 20_000 })
}
