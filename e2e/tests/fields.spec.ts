import { expect, test } from '@playwright/test'
import {
  createTemplate,
  enterVisual,
  openTemplate,
  uniqueCode,
} from './support'

/**
 * Putting a value on the page.
 *
 * The commonest act in the editor, and until this batch it was not possible in
 * the canvas at all: the field list showed only what the template already used,
 * so a fresh template offered nothing, and every insertion landed after the
 * selected block rather than in the sentence being written.
 */

test.use({ viewport: { width: 1680, height: 1000 } })
const CANVAS = 'iframe[title="template canvas"]'

const DOC =
  '<style>@page { size: A4; margin: 15mm }</style>\n' +
  '<h1>Invoice</h1>\n' +
  '<p id="line">Bill to on credit.</p>\n' +
  '<table><tr><td id="cell">cell</td></tr></table>\n'

const DATA = JSON.stringify({
  number: 'INV-1',
  customer: { name: 'Globex' },
  items: [{ name: 'Widget', price: 10 }],
})

/** Put a payload in Test data, which is where the field list comes from. */
async function setTestData(page: import('@playwright/test').Page, json: string) {
  await page.locator('.panel-tab', { hasText: 'Test data' }).click()
  await page.locator('#test-data-json').fill(json)
  // Fields live beside the canvas now, not in the drawer.
  await page.locator('.side-tab', { hasText: 'Fields' }).click()
}

test('a fresh template offers the test data as fields', async ({ page, request }) => {
  const code = uniqueCode('fields')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await setTestData(page, DATA)

  const labels = page.locator('.fields-panel .field-label')
  await expect(labels.filter({ hasText: 'number' })).toHaveCount(1)
  await expect(labels.filter({ hasText: 'customer.name' })).toHaveCount(1)

  // An array's fields are named, and greyed until something repeats over it —
  // the field says what would put it in reach, the array says it of them all.
  const price = page.locator('.field-item', { hasText: 'items[].price' })
  await expect(price).toHaveClass(/is-group/)
  await expect(price).toContainText('inside a repeat over items')
  await expect(page.locator('.field-item', { hasText: 'items[]' }).first()).toContainText(
    'repeat a row over items',
  )
})

test('a field lands where the caret is, not after the paragraph', async ({ page, request }) => {
  const code = uniqueCode('fields-caret')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await setTestData(page, DATA)

  const frame = page.frameLocator(CANVAS)
  // Caret after "Bill to " — eight characters in.
  await frame.locator('#line').click()
  await page.keyboard.press('Home')
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')

  await page.locator('.fields-panel .field-row', { hasText: 'number' }).first().click()

  await expect(frame.locator('#line')).toContainText('Bill to {{ number }}on credit.')
  // …and nothing was appended to the document instead.
  await expect(frame.locator('body > [data-jinja-expr]')).toHaveCount(0)
})

test('typing two braces offers the fields and writes the one chosen', async ({ page, request }) => {
  const code = uniqueCode('fields-type')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await setTestData(page, DATA)

  const frame = page.frameLocator(CANVAS)
  await frame.locator('#line').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' {{cust')

  const menu = page.locator('.field-typeahead')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.field-label').first()).toHaveText('customer.name')

  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  // The braces that were typed are gone: what is left is one chip.
  await expect(frame.locator('#line')).toContainText('credit. {{ customer.name }}')
  await expect(frame.locator('#line [data-jinja-expr]')).toHaveCount(1)
  await expect(frame.locator('#line')).not.toContainText('{{cust')
})

test('inside a repeat, an array field is offered under the loop’s own name', async ({
  page,
  request,
}) => {
  const code = uniqueCode('fields-scope')
  await createTemplate(request, code, DOC)
  await openTemplate(page, code)
  await enterVisual(page)
  await setTestData(page, DATA)

  const frame = page.frameLocator(CANVAS)
  // Make the row repeat over items, calling each one `row`. The structure list
  // is the only way to take the row rather than the cell inside it.
  await page.locator('.side-tab', { hasText: 'Structure' }).click()
  await page.locator('.canvas-outline .outline-row', { hasText: 'Row' }).click()
  await page.locator('.convert-actions button', { hasText: 'Repeat' }).click()
  await page.locator('.convert-form input[aria-label="Loop variable name"]').fill('row')
  await page.locator('.convert-form input[aria-label="Array to repeat over"]').fill('items')
  await page.locator('.convert-form button', { hasText: 'Apply' }).click()

  await frame.locator('#cell').click()
  await page.locator('.side-tab', { hasText: 'Fields' }).click()
  const price = page.locator('.fields-panel .field-row', { hasText: 'items[].price' })
  await expect(price).toBeVisible()
  await expect(price).toHaveAttribute('title', /row\.price/)

  await price.click()
  await expect(frame.locator('#cell')).toContainText('{{ row.price }}')
})

test('bolding across a field does not give the template a second copy of it', async ({
  page,
  request,
}) => {
  const code = uniqueCode('fields-bold')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n' +
      '<p id="line">Bill to {{ customer }} on credit.</p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  const line = frame.locator('#line')
  const box = (await line.boundingBox())!
  // Drag from the start of the line into the middle of the chip.
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.locator('.canvas-topbar button[title="Bold"]').click()

  // One field before, one field after. The chip was taken whole or not at all.
  await expect(line.locator('[data-jinja-expr="customer"]')).toHaveCount(1)
})

test('the payload is generated from the template, not typed before it', async ({
  page,
  request,
}) => {
  // The order that made the first ten minutes an exercise in typing braces into
  // a text box: fields could only be offered once the JSON existed. Now the
  // fields go on the page and the payload follows them.
  const code = uniqueCode('fields-gen')
  await createTemplate(
    request,
    code,
    '<h1>Invoice {{ number }}</h1>\n' +
      '<table>{% for row in items %}<tr><td>{{ row.title }}</td>' +
      '<td>{{ row.price }}</td></tr>{% endfor %}</table>\n',
  )
  await openTemplate(page, code)

  await page.locator('.panel-tab', { hasText: 'Test data' }).click()
  await page.getByRole('button', { name: 'Generate', exact: true }).click()

  const generated = JSON.parse(await page.locator('#test-data-json').inputValue())
  expect(generated.number).toBeTruthy()
  expect(Array.isArray(generated.items)).toBe(true)
  expect(Object.keys(generated.items[0]).sort()).toEqual(['price', 'title'])

  // Adjust one value by hand, then let the template grow a field.
  generated.number = 'REAL-42'
  await page.locator('#test-data-json').fill(JSON.stringify(generated))
  await page.locator('.btn.mode', { hasText: 'Code' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('<p>{{ signed_by }}</p>')

  await page.locator('.panel-tab', { hasText: 'Test data' }).click()
  await page.getByRole('button', { name: 'Fill in missing' }).click()

  const filled = JSON.parse(await page.locator('#test-data-json').inputValue())
  expect(filled.number, 'the value adjusted by hand was thrown away').toBe('REAL-42')
  expect(filled.signed_by, 'the new field was not added').toBeTruthy()
})

test('a field can be typed around: clicking one leaves a caret beside it', async ({
  page,
  request,
}) => {
  // Reported as "the header and footer cannot be edited", and as "changes to
  // nested blocks do not reach the preview". One cause: a chip is
  // contenteditable=false, so a click on one left no caret and every keystroke
  // after it went nowhere. A running header of mostly fields, or a table cell
  // holding a single field, then took no typing at all.
  const code = uniqueCode('fields-around')
  await createTemplate(
    request,
    code,
    '<style>@page { size: A4; margin: 15mm }</style>\n' +
      '<p id="line"><span>{{ company }}</span></p>\n',
  )
  await openTemplate(page, code)
  await enterVisual(page)

  const frame = page.frameLocator(CANVAS)
  const chip = frame.locator('#line [data-jinja-expr]')
  const box = (await chip.boundingBox())!

  // Right half: the caret goes after the field.
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2)
  await page.keyboard.type(' — report')
  await expect(frame.locator('#line')).toContainText('{{ company }} — report')

  // Left half: before it. Measured again, and after a pause — two clicks in
  // quick succession near the same spot are a double click, which means
  // something else here (editing the expression).
  await page.waitForTimeout(600)
  const again = (await chip.boundingBox())!
  await page.mouse.click(again.x + again.width * 0.15, again.y + again.height / 2)
  await page.keyboard.type('For ')
  await expect(frame.locator('#line')).toContainText('For {{ company }} — report')

  // And the field itself survived being typed around, exactly once.
  await expect(chip).toHaveCount(1)
})
