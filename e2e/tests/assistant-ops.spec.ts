import { expect, test, type Page } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  inspectorTab,
  latestDraftHtml,
  openTemplate,
  saveDraft,
  uniqueCode,
} from './support'

/**
 * The assistant asking the editor to do something, rather than writing markup.
 *
 * For "make it A5" or "add a footer", a whole document in an ```html block is a
 * bad answer twice: the user diffs a file to find three lines, and whatever the
 * model composed by hand is what the document now has — a footer built as
 * `position: fixed`, a page number as a margin-box string — none of which the
 * panels can touch afterwards.
 *
 * Whatever comes back is applied to the open document as it arrives, and one
 * press takes it back: a change you have to press a button to see is a change
 * you judge from a diff rather than from the page, and the page is the thing
 * being worked on.
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

  // Said in sentences, in the past tense: the JSON it arrived as is not
  // something anybody can read, and the change has already happened.
  const list = page.locator('.op-list')
  await expect(list).toContainText('A5')
  await expect(list).toContainText('margins top 15mm')

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

  const footer = page.frameLocator(CANVAS).locator('div[style*="running(lf-footer)"]')
  await expect(footer).toHaveAttribute('data-lf-running', 'bottom-center')
  await inspectorTab(page, 'Structure')
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
  // Nothing happened, so there is nothing to take back either.
  await expect(page.locator('.undo-change')).toHaveCount(0)
})

test('a plain answer still offers nothing to apply', async ({ page, request }) => {
  const code = uniqueCode('ops-none')
  await stubAssistant(page, 'Your template already has a footer, so there is nothing to change.')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await ask(page, 'add a footer')

  await expect(page.locator('.chat-msg.assistant').last()).toContainText('already has a footer')
  await expect(page.locator('.chat-applied')).toHaveCount(0)
  await expect(page.locator('.undo-change')).toHaveCount(0)
})

test('a template that goes around the editor says what it cost', async ({
  page,
  request,
}) => {
  // The other half of the same idea: when the assistant does write markup, what
  // it cost is said where the change is. Both of these are invisible in a diff
  // — ordinary-looking lines of CSS and Jinja — and the loss would otherwise be
  // discovered much later, with no clue which edit caused it.
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
  // Said, not refused: the change is in, and this is what it cost.
  await expect(page.locator('.chat-applied .applied-note')).toContainText('Applied')
})

test('applying a template from Visual mode actually replaces the document', async ({
  page,
  request,
}) => {
  // Reported as "Apply, and nothing changed". Leaving Visual unmounts the
  // canvas, and the canvas flushes its body on the way out — a flush carrying
  // the document that WAS open. It landed after the new template had been
  // written and put the old one back, with no error and no sign anything had
  // happened.
  const code = uniqueCode('apply-visual')
  await stubAssistant(
    page,
    'Added a column.\n\n```html\n' +
      '<style>@page { size: A4; margin: 20mm }</style>\n' +
      '<h1 id="title">Report</h1>\n<p id="added">A NEW PARAGRAPH</p>\n```',
  )
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await ask(page, 'add a paragraph')

  // Applied where the user is looking — in the canvas, not by dropping them
  // into Code to go and find it.
  await expect(page.frameLocator(CANVAS).locator('#added')).toHaveText('A NEW PARAGRAPH')
  await expect(page.locator('.mode-toggle .btn.mode.active')).toHaveText('Visual')
  await saveDraft(page, 'applied from visual mode')
  expect(await latestDraftHtml(request, code)).toContain('A NEW PARAGRAPH')
})

test('one press takes the change back, exactly', async ({ page, request }) => {
  // What makes applying on arrival safe. The snapshot is the document as it
  // stood — canvas included, since the canvas reports on a debounce and the
  // shell's copy can be a moment behind.
  const code = uniqueCode('undo')
  await stubAssistant(
    page,
    'Replaced the heading.\n\n```html\n' +
      '<style>@page { size: A4; margin: 20mm }</style>\n<h1 id="title">SOMETHING ELSE</h1>\n```',
  )
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await ask(page, 'rename the heading')

  const heading = page.frameLocator(CANVAS).locator('#title')
  await expect(heading).toHaveText('SOMETHING ELSE')

  await page.locator('.undo-change').click()
  await expect(heading).toHaveText('Report')
  await expect(page.locator('.undo-change')).toHaveText('Taken back')

  await saveDraft(page, 'took it back')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('Report')
  expect(saved).not.toContain('SOMETHING ELSE')
})

test('an edit made by hand survives being included in the snapshot', async ({ page, request }) => {
  // The snapshot is taken from the canvas, not from the shell's copy of the
  // template: the canvas reports its changes on a debounce, so a document that
  // has just been typed into is a fraction of a second ahead. Undoing to the
  // stale copy would silently throw that typing away.
  const code = uniqueCode('undo-typed')
  await stubAssistant(
    page,
    'Done.\n\n```html\n<style>@page { size: A4; margin: 20mm }</style>\n<h1 id="title">OTHER</h1>\n```',
  )
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('#title').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' TYPED')
  await ask(page, 'change it')
  await expect(frame.locator('#title')).toHaveText('OTHER')

  await page.locator('.undo-change').click()
  await expect(frame.locator('#title')).toHaveText('Report TYPED')
})

const TABLE_DOC =
  '<style>@page { size: A4; margin: 20mm }</style>\n' +
  '<h1 id="title">Report</h1>\n' +
  '<table class="data">\n' +
  '  <thead><tr><th>Metric</th><th class="num">This quarter</th></tr></thead>\n' +
  '  <tbody>{% for row in metrics %}<tr><td>{{ row.name }}</td>' +
  '<td class="num">{{ row.current }}</td></tr>{% endfor %}</tbody>\n' +
  '</table>\n'

test('a column is added by an edit, not by retyping the document', async ({ page, request }) => {
  // The request that showed why this exists: asked for one column, the
  // assistant returned all sixty lines of the template with three of them
  // different. Every line retyped is a line that can come back paraphrased,
  // and on a form of several hundred that is how a template stops being the
  // form.
  const code = uniqueCode('edit-column')
  await stubAssistant(
    page,
    'Added a Flag column.\n\n' +
      ops(
        JSON.stringify([
          {
            op: 'edit',
            find: '<th class="num">This quarter</th>',
            replace: '<th class="num">This quarter</th><th>Flag</th>',
          },
          {
            op: 'edit',
            find: '<td class="num">{{ row.current }}</td>',
            replace:
              '<td class="num">{{ row.current }}</td>' +
              "<td>{{ '\u2611' if row.flag else '\u2610' }}</td>",
          },
        ]),
      ),
  )
  await createTemplate(request, code, TABLE_DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await ask(page, 'add a Flag column with ticks')

  // Each edit read as a sentence saying what arrives, and both applied.
  await expect(page.locator('.op-list')).toContainText('<th>Flag</th>')
  await expect(page.frameLocator(CANVAS).locator('thead th')).toHaveCount(3)

  await saveDraft(page, 'a column added by edits')
  const saved = await latestDraftHtml(request, code)
  expect(saved).toContain('<th>Flag</th>')
  expect(saved).toContain("{{ '\u2611' if row.flag else '\u2610' }}")
  // Everything the edits did not name is byte for byte what it was.
  expect(saved).toContain('<h1 id="title">Report</h1>')
  expect(saved).toContain('{% for row in metrics %}')
})

test('an edit that names no place, or too many, changes nothing and says so', async ({
  page,
  request,
}) => {
  // Changing the first of three identical rows and calling it done is worse
  // than doing nothing, and a "done" over an unchanged document is worse still.
  const code = uniqueCode('edit-refused')
  await stubAssistant(
    page,
    'Renamed the column.\n\n' +
      ops(JSON.stringify([{ op: 'edit', find: '<th>Total</th>', replace: '<th>Sum</th>' }])),
  )
  await createTemplate(request, code, TABLE_DOC)
  await openTemplate(page, code)
  await ask(page, 'rename the total column')

  await expect(page.locator('.error-box')).toContainText('not in the document')
  await expect(page.locator('.undo-change')).toHaveCount(0)
  await saveDraft(page, 'nothing changed')
  expect(await latestDraftHtml(request, code)).toContain('<th>Metric</th>')
})
