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

/** Create a template with one PUBLISHED version — the state most tests want to
 * start from, since an unpublished template cannot be rendered at all. */
export async function createTemplate(
  api: APIRequestContext,
  code: string,
  html: string,
  name = 'E2E template',
): Promise<void> {
  const made = await api.post('/api/templates', { data: { code, name } })
  expect(made.ok(), `create ${code}: ${made.status()}`).toBeTruthy()
  const draft = await createDraft(api, code, html, 'seed')
  const published = await api.post(`/api/templates/${code}/drafts/${draft.id}/publish`)
  expect(published.ok(), `publish ${code}: ${published.status()}`).toBeTruthy()
}

/** Create a template that has a draft and nothing published. */
export async function createTemplateWithDraftOnly(
  api: APIRequestContext,
  code: string,
  html: string,
  name = 'E2E template',
): Promise<{ id: number }> {
  const made = await api.post('/api/templates', { data: { code, name } })
  expect(made.ok(), `create ${code}: ${made.status()}`).toBeTruthy()
  return createDraft(api, code, html, 'seed')
}

export async function createDraft(
  api: APIRequestContext,
  code: string,
  html: string,
  comment = '',
): Promise<{ id: number }> {
  const resp = await api.post(`/api/templates/${code}/drafts`, {
    data: { html_content: html, comment },
  })
  expect(resp.ok(), `draft for ${code}: ${resp.status()}`).toBeTruthy()
  return resp.json()
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

export async function templateDetail(api: APIRequestContext, code: string) {
  const resp = await api.get(`/api/templates/${code}`)
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()) as {
    versions: { version: number; status: string }[]
    drafts: { id: number; comment: string }[]
    current_version: number | null
  }
}

/** The newest draft's content, which is where "Save" in the editor lands. */
export async function latestDraftHtml(api: APIRequestContext, code: string): Promise<string> {
  const detail = await templateDetail(api, code)
  expect(detail.drafts.length, 'expected a draft to exist').toBeGreaterThan(0)
  const resp = await api.get(`/api/templates/${code}/drafts/${detail.drafts[0].id}`)
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).html_content
}

/** Click a top-level nav tab.
 *
 * Scoped to `.nav-item` on purpose: matching by accessible name alone is
 * ambiguous — the journal's "All templates" bucket also reads as "Templates",
 * and Playwright's strict mode rightly refuses to guess between them.
 */
export async function goToTab(page: Page, tab: 'Templates' | 'Examples' | 'Settings'): Promise<void> {
  // The navigation is a rail on a narrow window, and folds to one whenever a
  // document is open. Its toggle is how anybody gets back to the list, so a
  // test that wants a tab asks for it the same way.
  //
  // Tried rather than tested for: an absent item can equally mean the shell has
  // not finished booting, and pressing the toggle then CLOSES a sidebar that
  // was about to appear.
  const item = page.locator('.nav-item', { hasText: tab })
  try {
    await item.click({ timeout: 4000 })
  } catch {
    await page.locator('.sidebar-toggle').click()
    await item.click()
  }
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

/**
 * Make sure the preview column is open.
 *
 * Below a 1600 px window the editor starts with the preview put away: a column
 * narrower than the page it renders costs more than it shows, and it is one key
 * press back. Most of this suite runs at 1280 (Playwright's Desktop Chrome),
 * so a test about the preview has to ask for it rather than assume it.
 */
export async function showPreview(page: Page): Promise<void> {
  const strip = page.locator('.pane-strip')
  if ((await strip.count()) > 0) await strip.click()
  await expect(page.locator('.preview-pane')).toHaveCount(1)
}

/**
 * Show one of the inspector's tabs.
 *
 * The column opens on Properties — what is selected, or the page when nothing
 * is — so anything about the structure or the fields has to ask for its tab.
 */
export async function inspectorTab(
  page: Page,
  name: 'Properties' | 'Structure' | 'Fields',
): Promise<void> {
  await page.locator('.side-tab', { hasText: name }).click()
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

/** Save the editor's current content as a draft. */
export async function saveDraft(page: Page, comment = 'from e2e'): Promise<void> {
  await page.getByPlaceholder(/What changed/i).fill(comment)

  // Wait for the write itself, not for the unsaved marker to clear. The marker
  // appears when the canvas reports its edit, which is debounced — so a test
  // fast enough to click Save first would find no marker, take that for "saved"
  // and read the draft back before the request had landed. Armed before the
  // click, because the response can arrive before the click call returns.
  const written = page.waitForResponse(
    (r) =>
      /\/drafts(\/\d+)?$/.test(new URL(r.url()).pathname) &&
      ['POST', 'PUT'].includes(r.request().method()),
    { timeout: 20_000 },
  )
  await page.getByRole('button', { name: /^Save (as )?draft$/i }).click()
  const resp = await written
  expect(resp.ok(), `save answered ${resp.status()}`).toBeTruthy()
  await expect(page.locator('.dirty-badge')).toHaveCount(0, { timeout: 20_000 })
}
