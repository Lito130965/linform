import { expect, test } from '@playwright/test'
import { createTemplate, goToTab, uniqueCode } from './support'

/**
 * The journal shows the templates. All of them.
 *
 * `/api/templates` answers a page at a time — a hundred by default, ordered by
 * code — and says how many there are in a header. The journal asked for it
 * plainly, so past a hundred templates it showed the first hundred and nothing
 * whatsoever to say the others existed: a template created today was simply not
 * in the list, and its author had no way to tell why.
 *
 * Found by this suite, which crossed a hundred templates in one run and then
 * could not open its own template. That is the whole reason this test creates
 * its own crowd rather than relying on what other tests happen to leave behind:
 * run alone, it has to fail for the same reason.
 */

test('a template past the first page is still in the journal', async ({ page, request }) => {
  const target = `zzz-last-${uniqueCode('journal')}`
  // Enough to push the target off page one on its own, in batches so the
  // service is not asked to do it all at once.
  const fillers = Array.from({ length: 110 }, (_, i) => `zz-fill-${String(i).padStart(3, '0')}`)
  for (let at = 0; at < fillers.length; at += 20) {
    await Promise.all(
      fillers.slice(at, at + 20).map((code) => createTemplate(request, code, '<p>filler</p>')),
    )
  }
  await createTemplate(request, target, '<p>the one being looked for</p>')

  await page.goto('/')
  await goToTab(page, 'Templates')
  await expect(page.locator('.journal-table tr', { hasText: target })).toHaveCount(1)
})
