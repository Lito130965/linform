/**
 * The screenshots in docs/media, taken by a machine instead of by hand.
 *
 * A README's pictures go stale the same way its prose does, and re-taking them
 * by hand means re-finding the same window size, the same theme, the same
 * example and the same selection — which nobody does, so they are simply left
 * wrong. This takes them at a fixed viewport and a fixed device scale, from the
 * examples gallery only, so a change to the interface costs one command.
 *
 * Only the examples: a deployment's own journal holds real templates, and the
 * last thing this repository should carry is a picture of somebody's actual
 * form.
 *
 *   BASE_URL=http://localhost:8100 OUT_DIR=media node screenshots.mjs
 *
 * It needs an instance to photograph and the Playwright browsers, so in
 * practice it runs the same way the browser tests do — inside the pinned
 * Playwright image, against a running container.
 */

import { chromium } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'

const BASE = process.env.BASE_URL || 'http://localhost:8100'
const OUT = process.env.OUT_DIR || 'media'

const CANVAS = 'iframe[title="template canvas"]'

/** The navigation folds to a rail once a document is open; ask the same way the
 * test suite does rather than assuming which shape is on screen. */
async function goToTab(page, tab) {
  const item = page.locator('.nav-item', { hasText: tab })
  try {
    await item.click({ timeout: 4000 })
  } catch {
    await page.locator('.sidebar-toggle').click()
    await item.click()
  }
}

async function openExample(page, cardText) {
  await page.goto(BASE)
  await goToTab(page, 'Examples')
  await page.locator('.example-card, .card, li, article', { hasText: cardText }).first().click()
  await page.locator('.cm-content').waitFor({ state: 'visible', timeout: 15000 })
  // The first preview render is debounced; give it time to arrive so no
  // screenshot catches an empty column.
  await page.waitForTimeout(2500)
}

async function showPreview(page) {
  const tab = page.getByRole('tab', { name: 'Preview' })
  if ((await tab.count()) > 0) await tab.click()
  else {
    const strip = page.locator('.pane-strip', { hasText: 'PREVIEW' })
    if ((await strip.count()) > 0) await strip.click()
  }
  await page.locator('.preview').waitFor({ state: 'visible' })
  await page.waitForTimeout(2000)
}

async function enterVisual(page) {
  await page.getByRole('button', { name: 'Visual', exact: true }).click()
  await page.frameLocator(CANVAS).locator('body').waitFor({ state: 'visible' })
  await page.waitForTimeout(1200)
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`wrote ${OUT}/${name}.png`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  // Real Chrome, not the bundled Chromium: the preview column shows the PDF in
  // the browser's own viewer, and Chromium ships without one — every shot of
  // the preview came back as an empty panel with the pager drawn above it.
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome' })
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    // Twice the pixels: the README shows these at about half their width, and a
    // 1x screenshot scaled down is exactly as soft as it sounds.
    deviceScaleFactor: 2,
    // Dark, to match the recording at the top of the README. Worth stating
    // because it is easy to get backwards: the editor's chrome is #222229 and
    // the two largest areas on screen — the sheet and the rendered PDF — are
    // white, so a frame of it reads as a light interface until you sample it.
    colorScheme: 'dark',
    baseURL: BASE,
  })
  const page = await context.newPage()

  // ---- 06: the code mode, with the page rendering beside it.
  await openExample(page, 'Invoice')
  await showPreview(page)
  await shot(page, '06-code-mode')

  // ---- 04: the visual canvas, something selected, the geometry visible.
  await openExample(page, 'Report')
  await enterVisual(page)
  // The heading rather than the table: a click inside a table selects the cell
  // under it, which is correct behaviour and a cluttered picture — a cell
  // toolbar over the footer and an inspector full of cell padding.
  await page.frameLocator(CANVAS).locator('h1').first().click()
  await page.waitForTimeout(400)
  const grid = page.getByRole('button', { name: 'Grid' })
  if ((await grid.count()) > 0) await grid.click()
  await page.waitForTimeout(800)
  await shot(page, '04-visual-mode')

  // ---- 05: the version history, with a diff open.
  //
  // Built here rather than borrowed from the journal: this needs a template
  // with two published versions that differ in a way a reader can see, and it
  // must be one this repository is willing to publish a picture of.
  const api = context.request
  // A readable code rather than a unique one, because it ends up in a picture:
  // `receipt-demo-mu4b6wlq` in the toolbar reads as somebody's leftover test.
  // Archiving does not give a code back — that is the point of archiving — so a
  // re-run takes the next name that is free, or reuses one it made before.
  const CANDIDATES = ['delivery-note', 'goods-received', 'packing-slip', 'dispatch-note']
  let code = null
  let published = 0
  for (const candidate of CANDIDATES) {
    const found = await api.get(`/api/templates/${candidate}`)
    if (found.status() === 404) {
      await api.post('/api/templates', { data: { code: candidate, name: 'Delivery note' } })
      code = candidate
      break
    }
    const detail = await found.json()
    if (!detail.archived_at) {
      code = candidate
      published = (detail.versions ?? []).filter((v) => v.status === 'published').length
      break
    }
  }
  if (!code) throw new Error(`no free template code among ${CANDIDATES.join(', ')}`)
  const v1 = `<h1>Delivery note {{ number }}</h1>
<p>Issued to {{ customer.name }} on {{ issued_on }}.</p>
<table>
  <tr><th>Item</th><th>Qty</th></tr>
  {% for line in lines %}<tr><td>{{ line.item }}</td><td>{{ line.qty }}</td></tr>{% endfor %}
</table>
<p class="note">Goods received in good order.</p>
`
  const v2 = v1
    .replace('<th>Qty</th>', '<th>Qty</th><th>Checked</th>')
    .replace('<td>{{ line.qty }}</td>', '<td>{{ line.qty }}</td><td>{% if line.checked %}✓{% endif %}</td>')
    .replace('Goods received in good order.', 'Goods received in good order. Signature: ____________')

  for (const html of published >= 2 ? [] : [v1, v2]) {
    const draft = await api.post(`/api/templates/${code}/drafts`, {
      data: { html_content: html, comment: html === v1 ? 'first issue' : 'a column for the checker, and a signature line' },
    })
    const { id } = await draft.json()
    await api.post(`/api/templates/${code}/drafts/${id}/publish`)
  }

  await page.goto(BASE)
  await goToTab(page, 'Templates')
  await page.locator('.journal-table tr', { hasText: code }).locator('.link-btn').click()
  await page.locator('.template-code').waitFor({ state: 'visible' })
  await page.waitForTimeout(1500)
  // Sample data first, or the preview beside the history is a red box saying a
  // placeholder has no value — true, and not what this picture is about.
  await page.locator('.tool-button', { hasText: 'Test data' }).click()
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Close the panel' }).click()
  await page.waitForTimeout(2500)

  await page.getByRole('button', { name: /History/i }).click()
  await page.waitForTimeout(500)
  // The diff is asked for against v1, not v2: the editor holds v2, so diffing
  // that against itself draws a page of unchanged text and proves nothing.
  await page
    .locator('li', { hasText: 'first issue' })
    .getByRole('button', { name: /Diff vs editor/i })
    .click()
  await page.waitForTimeout(800)
  await shot(page, '05-version-history')

  // ---- 07: the picture that explains the product without a sentence.
  //
  // Not a screenshot of anything — a composition: the payload on the left, the
  // page it produced on the right. The page image is rendered and rasterised
  // outside this script (the service returns a PDF, and turning one into a
  // picture is not a browser's job); without it, this shot is skipped.
  if (process.env.PAGE_PNG) {
    const png = (await readFile(process.env.PAGE_PNG)).toString('base64')
    const payload = JSON.parse(await readFile(process.env.PAYLOAD_JSON, 'utf-8'))
    // Short enough to read at a glance: the shape is the point, not the data.
    const shown = {
      number: payload.number,
      date: payload.date,
      buyer: payload.buyer,
      items: payload.items.slice(0, 2),
      total: payload.total,
    }
    const json = JSON.stringify(shown, null, 2).replace(
      /"([^"]+)":/g,
      '"<span class="k">$1</span>":',
    )
    await page.setViewportSize({ width: 1400, height: 780 })
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      :root { color-scheme: dark }
      body { margin:0; width:1400px; height:780px; display:flex; align-items:center;
             justify-content:center; gap:44px; background:#222229;
             font:14px/1.55 ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace; color:#c9d1d9 }
      .card { width:600px; background:#1b1f24; border:1px solid #2f3540; border-radius:10px;
              padding:22px 24px; box-shadow:0 18px 50px rgba(0,0,0,.45) }
      .card h3, .sheet-label { font:600 13px/1 ui-sans-serif,system-ui,sans-serif;
              letter-spacing:.08em; text-transform:uppercase; color:#8b949e; margin:0 0 14px }
      pre { margin:0; white-space:pre-wrap; color:#adbac7 }
      .k { color:#6cb6ff }
      .arrow { text-align:center; color:#8b949e; font:600 13px/1.6 ui-sans-serif,system-ui,sans-serif }
      .arrow div:first-child { font-size:42px; line-height:1; color:#539bf5 }
      .sheet { text-align:center }
      img { width:420px; border-radius:4px;
            box-shadow:0 18px 50px rgba(0,0,0,.55); display:block }
    </style>
    <div class="card"><h3>your application sends JSON</h3><pre>${json}</pre></div>
    <div class="arrow"><div>&rarr;</div><div>POST /api/render/invoice</div></div>
    <div class="sheet"><div class="sheet-label">Linform returns a PDF</div>
      <img src="data:image/png;base64,${png}"></div>`)
    await page.waitForTimeout(400)
    await shot(page, '07-json-to-pdf')
  }

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
