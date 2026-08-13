import { expect, test, type Page } from '@playwright/test'
import { createTemplate, enterVisual, latestDraftHtml, openTemplate, saveDraft, uniqueCode } from './support'

/**
 * The assistant asking the editor to do something, rather than writing markup.
 *
 * For "make it A5" or "add a footer", a whole document in an ```html block is a
 * bad answer twice: the user diffs a file to find three lines, and whatever the
 * model composed by hand is what the document now has — a footer built as
 * `position: fixed`, a page number as a margin-box string — none of which the
 * panels can touch afterwards.
 *
 * The reply is stubbed at the network, not in the app: what is under test is
 * the whole chain from a model's words to a changed document, and the model's
 * side of it is the one part that cannot be pinned down in a test.
 */

test.use({ viewport: { width: 1680, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'

const DOC = '<style>@page { size: A4; margin: 20mm }</style>\n<h1 id="title">Report</h1>\n'

/** Answer /status as an enabled assistant, and /assistant with one canned
 * reply, in the SSE shape the real endpoint streams. */
async function stubAssistant(page: Page, reply: string) {
  await page.route('**/api/assistant/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: true, model: 'stub-model', sends_test_data: false }),
    }),
  )
  await page.route('**/api/assistant', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body:
        `event: delta\ndata: ${JSON.stringify({ text: reply })}\n\n` + 'event: done\ndata: {}\n\n',
    }),
  )
}

async function ask(page: Page, what: string) {
  await page.locator('.toolbar button', { hasText: 'Assistant' }).click()
  await page.getByLabel('Message to the assistant').fill(what)
  await page.locator('.assistant-actions button', { hasText: 'Send' }).click()
}

const ops = (json: string) => '```linform-ops\n' + json + '\n```'

test('an operation is shown as a sentence and changes the document', async ({ page, request }) => {
  const code = uniqueCode('ops-page')
  await stubAssistant(
    page,
    'Made the page A5 with 15mm margins.\n\n' +
      ops('[{"op": "page", "size": "A5", "margin": {"top": "15mm", "bottom": "15mm"}}]'),
  )
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await ask(page, 'make it A5')

  // Read before it runs: "Apply" on a blob of JSON is not a choice anybody can
  // make.
  const list = page.locator('.op-list')
  await expect(list).toContainText('A5')
  await expect(list).toContainText('margins top 15mm')

  await page.locator('.chat-proposal.ops button', { hasText: 'Do it' }).click()
  await saveDraft(page, 'A5 from the assistant')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toMatch(/size:\s*A5/i)
  expect(saved).toMatch(/margin[^;]*15mm/)
})

test('a footer asked for by the assistant is the footer the editor makes', async ({
  page,
  request,
}) => {
  // The point of the whole batch: what arrives is a running element and the
  // margin box that pulls it — the pair the header switch maintains and the
  // structure panel lists — and not a div the panels have never seen.
  const code = uniqueCode('ops-footer')
  await stubAssistant(
    page,
    'Turned the footer on.\n\n' + ops('[{"op": "furniture", "edge": "bottom", "on": true}]'),
  )
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await ask(page, 'add a footer')

  await page.locator('.chat-proposal.ops button', { hasText: 'Do it' }).click()
  const footer = page.frameLocator(CANVAS).locator('div[style*="running(lf-footer)"]')
  await expect(footer).toHaveAttribute('data-lf-running', 'bottom-center')
  await expect(
    page.locator('.canvas-outline .outline-label').filter({ hasText: 'Page footer' }),
  ).toHaveCount(1)

  await saveDraft(page, 'a footer from the assistant')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('running(lf-footer)')
  expect(saved).toContain('@bottom-center')
  expect(saved).toContain('width: 100%')
})

test('an operation the editor does not have is refused out loud', async ({ page, request }) => {
  // Silence would read as an editor that ignored the assistant, and the user
  // would apply a change that never happened.
  const code = uniqueCode('ops-unknown')
  await stubAssistant(
    page,
    'Set the font.\n\n' + ops('[{"op": "set-font", "family": "Arial"}]'),
  )
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await ask(page, 'use Arial everywhere')

  await expect(page.locator('.op-list.rejected')).toContainText('set-font')
  await expect(page.locator('.op-list.rejected')).toContainText('not an operation this editor has')
  await expect(page.locator('.chat-proposal.ops')).toHaveCount(0)
})

test('a plain answer still offers nothing to apply', async ({ page, request }) => {
  const code = uniqueCode('ops-none')
  await stubAssistant(page, 'Your template already has a footer, so there is nothing to change.')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await ask(page, 'add a footer')

  await expect(page.locator('.chat-msg.assistant').last()).toContainText('already has a footer')
  await expect(page.locator('.chat-proposal')).toHaveCount(0)
})

test('a template that goes around the editor says so before it is applied', async ({
  page,
  request,
}) => {
  // The other half of the same idea: when the assistant does write markup, the
  // cost of applying it is visible beforehand. Both of these are invisible in a
  // diff — ordinary-looking lines of CSS and Jinja — and the loss is discovered
  // later with no clue which edit caused it.
  const code = uniqueCode('ops-caveat')
  await stubAssistant(
    page,
    'Added a page number.\n\n```html\n' +
      '<style>@page { size: A4; margin: 20mm; @bottom-center { content: "Page " counter(page) } }</style>\n' +
      '<h1>Report</h1>\n<td class="{% if wide %}wide{% endif %}">x</td>\n```',
  )
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await ask(page, 'add page numbers')

  const caveats = page.locator('.proposal-caveat')
  await expect(caveats).toHaveCount(2)
  await expect(caveats.first()).toContainText('margin box')
  await expect(caveats.last()).toContainText('code-only')
  // Said, not refused: the Apply button is still there.
  await expect(page.locator('.chat-proposal button', { hasText: 'Apply' })).toHaveCount(1)
})
