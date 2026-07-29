import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { createTemplate, exampleHtml, openTemplate, uniqueCode, goToTab } from './support'

/**
 * Accessibility checks on the three screens a person actually spends time in.
 *
 * axe-core finds a specific, mechanical class of problem — a control with no
 * accessible name, insufficient contrast, a broken landmark. It cannot tell
 * whether the editor is usable from a keyboard; that stays a manual charter.
 * Automating what can be automated is still worth it: those regressions
 * reappear silently otherwise.
 *
 * The canvas iframe is excluded on purpose. It contains the USER'S template —
 * their markup, their colours — and failing our build over the contrast of
 * somebody's letterhead would be both wrong and unfixable from here.
 *
 * These run for real. They were written before the fixes landed and skipped
 * behind a flag, and removing that flag was the acceptance criterion for the
 * batch that added the labels, the focus outlines and the border contrast.
 */

const RULESET = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function scan(page: import('@playwright/test').Page) {
  return (
    new AxeBuilder({ page })
      .withTags(RULESET)
      .exclude('iframe[title="template canvas"]')
      // CodeMirror's scroll container is reported as a scrollable region with
      // no keyboard access. The region it scrolls IS the contenteditable the
      // caret lives in, so arrow keys scroll it — the rule cannot see that the
      // focusable element is inside. Excluded knowingly, not to silence a real
      // finding: the editor's own textbox is named and checked above.
      .exclude('.cm-scroller')
  )
}

/** Readable failure: rule, impact, and the first offending node. */
function describe(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes[0]?.html?.slice(0, 120) ?? ''}`)
    .join('\n  ')
}

test('the template journal has no accessibility violations', async ({ page }) => {
  await page.goto('/')
  await goToTab(page, 'Templates')
  await expect(page.getByRole('button', { name: /New template/i })).toBeVisible()

  const { violations } = await scan(page).analyze()
  expect(violations.length, `journal:\n  ${describe(violations)}`).toBe(0)
})

test('the settings page has no accessibility violations', async ({ page }) => {
  await page.goto('/')
  await goToTab(page, 'Settings')
  await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible()

  const { violations } = await scan(page).analyze()
  expect(violations.length, `settings:\n  ${describe(violations)}`).toBe(0)
})

test('the editor shell has no accessibility violations', async ({ page, request }) => {
  const code = uniqueCode('a11y')
  await createTemplate(request, code, exampleHtml('certificate'))
  await openTemplate(page, code)

  const { violations } = await scan(page).analyze()
  expect(violations.length, `editor:\n  ${describe(violations)}`).toBe(0)
})

test('every control in the editor toolbar has an accessible name', async ({ page, request }) => {
  /**
   * The specific failure this guards: buttons labelled with a glyph (☰, ▤, ★)
   * read as "star button" or as nothing at all. axe covers it, but naming it
   * separately means the failure message says which button.
   */
  const code = uniqueCode('names')
  await createTemplate(request, code, exampleHtml('certificate'))
  await openTemplate(page, code)

  const unnamed: string[] = []
  for (const button of await page.locator('button:visible').all()) {
    const name = (
      (await button.getAttribute('aria-label')) ??
      (await button.textContent()) ??
      ''
    ).trim()
    // A glyph alone is not a name a screen reader can read out usefully.
    if (!name || /^[\p{Emoji}\p{So}\p{Sm}✕✎↺↻←→↑↓]+$/u.test(name)) {
      unnamed.push((await button.evaluate((el) => el.outerHTML)).slice(0, 100))
    }
  }
  expect(unnamed, `controls without an accessible name:\n${unnamed.join('\n')}`).toEqual([])
})
