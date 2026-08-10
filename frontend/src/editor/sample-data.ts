/**
 * Test data made from the template, rather than the other way round.
 *
 * The editor is a constructor: somebody places the fields they need and only
 * then wonders what the payload looks like. Asking for the JSON first — which
 * is what a field list built only from test data amounts to — puts the two the
 * wrong way round and makes the first ten minutes an exercise in typing braces
 * into a text box.
 *
 * So the template is read for the values it names, and a sample payload is
 * built to match: loops become arrays of objects with the fields their bodies
 * use, everything else becomes a scalar. Two ways to ask for it, because they
 * answer different questions — start again from the template, or leave what is
 * there and fill in what the template has since grown.
 *
 * The sample VALUES are guesses from the field's name, and deliberately so:
 * a preview of a form full of "Sample" tells you nothing about whether the
 * column is wide enough, and a date that is not a date is worse than useless
 * for judging a layout.
 *
 * Pure string work. No DOM, no engine — the source is the template text, which
 * is what both modes ultimately hold.
 */

export interface SampleResult {
  json: string
  /** Names that were added — what to say happened. */
  added: string[]
}

/** `{% for item in items %}` — the two names, and nothing cleverer. */
const LOOP_RE = /\{%-?\s*for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_][\w.]*)\s*-?%\}/g
/** `{{ customer.name }}`, `{{ total | round }}` — the path at the front. */
const EXPR_RE = /\{\{-?\s*([A-Za-z_][\w.]*)/g
/** The canvas keeps the same two facts in attributes while it is open. */
const ATTR_FOR_RE = /data-jinja-for="([^"]*)"/g
const ATTR_EXPR_RE = /data-jinja-expr="([^"]*)"/g

/** Names Jinja itself provides inside a loop; they are not payload. */
const LOOP_BUILTINS = new Set(['loop'])

interface Shape {
  /** Loop variable → the array it walks. */
  loops: Map<string, string>
  /** Paths used anywhere, as written. */
  paths: Set<string>
}

function readShape(template: string): Shape {
  const loops = new Map<string, string>()
  const paths = new Set<string>()

  for (const m of template.matchAll(LOOP_RE)) loops.set(m[1], m[2])
  for (const m of template.matchAll(ATTR_FOR_RE)) {
    const parts = /^\s*([A-Za-z_]\w*)\s+in\s+([A-Za-z_][\w.]*)\s*$/.exec(m[1])
    if (parts) loops.set(parts[1], parts[2])
  }
  for (const m of template.matchAll(EXPR_RE)) paths.add(m[1])
  for (const m of template.matchAll(ATTR_EXPR_RE)) {
    const head = /^[A-Za-z_][\w.]*/.exec(m[1].trim())
    if (head) paths.add(head[0])
  }
  return { loops, paths }
}

/** A value that looks like what the field is called, so the preview shows a
 * form and not a list of the word "Sample". */
export function sampleFor(name: string): string | number {
  const n = name.toLowerCase()
  if (/(^|_)(date|dt|day)$|date$/.test(n)) return '2026-08-10'
  if (/(qty|quantity|count|amount_of|pieces)/.test(n)) return 3
  if (/(price|total|sum|amount|cost|vat|tax)/.test(n)) return '12 500.00'
  if (/(percent|rate|share)/.test(n)) return '12.5%'
  if (/(email|mail)/.test(n)) return 'name@example.com'
  if (/(phone|tel)/.test(n)) return '+7 700 000 00 00'
  if (/(iin|bin|inn|tax_id|taxid)/.test(n)) return '123456789012'
  if (/(iban|account|bank)/.test(n)) return 'KZ00 0000 0000 0000 0000'
  if (/(number|no|num|code|id)$/.test(n) || /^(number|no|num|code|id)$/.test(n)) return 'INV-0001'
  if (/(company|org|firm|supplier|customer|client|payer)/.test(n)) return 'Globex Corporation'
  if (/(name|title|subject)/.test(n)) return 'Example name'
  if (/(address|street|city)/.test(n)) return '1 Example Street, Astana'
  if (/(note|comment|description|text|summary)/.test(n)) {
    return 'A short line of sample text for the layout.'
  }
  if (/(is_|has_|flag|agreed|paid|signed)/.test(n)) return 'yes'
  return 'Sample'
}

/** What the template expects, as a plain object tree. */
function expectedShape(template: string): Record<string, unknown> {
  const { loops, paths } = readShape(template)
  const out: Record<string, unknown> = {}
  /** array name → the fields its item is asked for. */
  const itemFields = new Map<string, Set<string>>()

  for (const path of paths) {
    const [head, ...rest] = path.split('.')
    if (LOOP_BUILTINS.has(head)) continue
    const array = loops.get(head)
    if (array) {
      // A loop variable: what is read off it belongs to the array's items. A
      // loop variable printed whole says the opposite — that the items are
      // values, not objects — so it must not register an empty item shape.
      if (rest.length > 0) {
        const fields = itemFields.get(array) ?? new Set<string>()
        fields.add(rest.join('.'))
        itemFields.set(array, fields)
      }
      continue
    }
    if (rest.length === 0) {
      if (!(head in out)) out[head] = sampleFor(head)
      continue
    }
    // A dotted path on an ordinary name: a nested object.
    const group = (out[head] && typeof out[head] === 'object' && !Array.isArray(out[head])
      ? out[head]
      : {}) as Record<string, unknown>
    let cursor = group
    for (let i = 0; i < rest.length - 1; i++) {
      const key = rest[i]
      if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
      cursor = cursor[key] as Record<string, unknown>
    }
    cursor[rest[rest.length - 1]] = sampleFor(rest[rest.length - 1])
    out[head] = group
  }

  // Arrays last, so a name used both ways ends up as the array it is walked as.
  for (const [array, fields] of itemFields) {
    const item: Record<string, unknown> = {}
    for (const field of fields) item[field.split('.')[0]] = sampleFor(field.split('.').pop()!)
    // Two items: one row never shows that a repeat repeats.
    out[array] = [item, { ...item }]
  }
  // An array whose items are printed whole, or never read at all: a list of
  // values rather than of objects.
  for (const array of loops.values()) {
    if (!(array in out)) out[array] = [sampleFor(array), sampleFor(array)]
  }
  return out
}

/** Everything the template names, as a fresh payload. */
export function generateSample(template: string): SampleResult {
  const shape = expectedShape(template)
  return { json: JSON.stringify(shape, null, 2), added: Object.keys(shape) }
}

/**
 * Keep what is there, add what is missing.
 *
 * The common case is a payload somebody has adjusted to their real data and a
 * template that has since grown a field. Regenerating would throw the
 * adjustments away, which is why this exists as a separate button rather than
 * as cleverness inside the first one.
 */
export function fillMissing(template: string, currentJson: string): SampleResult {
  let current: unknown
  try {
    current = JSON.parse(currentJson)
  } catch {
    // Not JSON at all: there is nothing to preserve.
    return generateSample(template)
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return generateSample(template)
  }

  const data = current as Record<string, unknown>
  const shape = expectedShape(template)
  const added: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    if (!(key in data)) {
      data[key] = value
      added.push(key)
      continue
    }
    // An array that is already there keeps its items; each of them gains the
    // fields the template has started reading.
    if (Array.isArray(value) && Array.isArray(data[key])) {
      const template_item = value[0]
      if (!template_item || typeof template_item !== 'object') continue
      const items = data[key] as unknown[]
      if (items.length === 0) items.push({ ...(template_item as object) })
      for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        for (const [field, sample] of Object.entries(template_item as Record<string, unknown>)) {
          if (!(field in (item as Record<string, unknown>))) {
            ;(item as Record<string, unknown>)[field] = sample
            if (!added.includes(`${key}[].${field}`)) added.push(`${key}[].${field}`)
          }
        }
      }
      continue
    }
    // A nested object gains its missing keys the same way.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const existing = data[key]
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) continue
      for (const [field, sample] of Object.entries(value as Record<string, unknown>)) {
        if (!(field in (existing as Record<string, unknown>))) {
          ;(existing as Record<string, unknown>)[field] = sample
          added.push(`${key}.${field}`)
        }
      }
    }
  }

  return { json: JSON.stringify(data, null, 2), added }
}
