/**
 * The fields a template can name, and which of them can be named *here*.
 *
 * Until now the panel beside the canvas listed the placeholders the template
 * already contained. That is the answer to "what does this template expect",
 * which is the integrator's question — and the exact opposite of what somebody
 * building a form needs, which is "what can I put on this page". A fresh
 * template offered nothing at all, so the first field of every document had to
 * be typed in Code mode.
 *
 * So the list is built from the test data as well: the JSON the preview renders
 * with is the closest thing to a schema this service has, and it is already
 * sitting in the next tab. Two sources, one list — a field known to both is the
 * ordinary case, one known only to the template is a value the sample forgot,
 * and one known only to the data is a value nobody has used yet.
 *
 * **Scope** is the part worth getting right. `items[].price` means nothing on
 * its own: it can only be written inside a `{% for item in items %}`, and there
 * it is written `item.price` — with whatever the loop happened to call its
 * variable. So the rows carry the expression to write for the place the caret
 * is in, and say which loop is missing when there is none.
 *
 * Pure: JSON and a list of names in, rows out.
 */

export interface LoopScope {
  /** The loop variable — `item` in `{% for item in items %}`. */
  item: string
  /** The array being walked. */
  array: string
}

export interface FieldRow {
  /** What a person reads: `customer.name`, `items[].price`. */
  label: string
  /** Indent level in the list. */
  depth: number
  kind: 'value' | 'group' | 'array'
  /** The Jinja to write at the caret, or null when it cannot be written here. */
  expression: string | null
  /** When it cannot: the array a loop would have to be walking. */
  needs?: string
  /** Which source knows about it. */
  source: 'both' | 'data' | 'template'
  /** A short rendering of the sample value, to tell two fields apart. */
  sample?: string
}

/** Deep enough for real payloads, shallow enough that a big nested document
 * cannot turn the panel into a wall. */
const MAX_DEPTH = 3
/** Items sampled when working out what an array's elements look like. */
const SAMPLE = 20

function sampleOf(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.length > 24 ? `${value.slice(0, 23)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function itemKeys(items: unknown[]): string[] {
  const seen = new Set<string>()
  for (const item of items.slice(0, SAMPLE)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const key of Object.keys(item as Record<string, unknown>)) seen.add(key)
    }
  }
  return [...seen]
}

function firstObject(items: unknown[]): Record<string, unknown> {
  for (const item of items.slice(0, SAMPLE)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return item as Record<string, unknown>
    }
  }
  return {}
}

/** A key a template can actually say. `{{ total }}` works; a key with a space
 * or a dash in it needs subscript syntax, which is Code mode's business — so
 * such a field is listed and marked rather than silently missing. */
const NAMEABLE = /^[A-Za-z_]\w*$/

function parse(json: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(json)
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * @param testDataJson the editor's test data — the nearest thing to a schema
 * @param placeholders names the template already uses (top-level, from the
 *   engine's own parser, so a loop variable never appears here)
 * @param scopes the loops in force where the caret is
 */
export function fieldRows(
  testDataJson: string,
  placeholders: readonly string[],
  scopes: readonly LoopScope[],
): FieldRow[] {
  const data = parse(testDataJson)
  const rows: FieldRow[] = []
  const named = new Set<string>()

  const walk = (
    object: Record<string, unknown>,
    depth: number,
    prefix: string,
    expressionPrefix: string | null,
  ): void => {
    for (const [key, value] of Object.entries(object)) {
      const label = prefix ? `${prefix}.${key}` : key
      const nameable = NAMEABLE.test(key)
      const expression =
        expressionPrefix === null || !nameable ? null : `${expressionPrefix}${key}`
      if (depth === 0) named.add(key)

      if (!nameable) {
        rows.push({ label, depth, kind: 'value', expression: null, source: 'data' })
        continue
      }

      if (Array.isArray(value)) {
        // The array itself is not something to print; its items are. A loop
        // already walking it gives its own name to each one.
        const scope = scopes.find((s) => s.array === label)
        const keys = itemKeys(value)
        rows.push({
          label: `${label}[]`,
          depth,
          kind: 'array',
          expression: null,
          needs: scope ? undefined : label,
          source: 'data',
        })
        if (depth + 1 >= MAX_DEPTH) continue
        const sampleItem = firstObject(value)
        if (keys.length === 0) {
          // An array of plain values: inside the loop, the variable IS the value.
          rows.push({
            label: `${label}[] item`,
            depth: depth + 1,
            kind: 'value',
            expression: scope ? scope.item : null,
            needs: scope ? undefined : label,
            source: 'data',
            sample: sampleOf(value[0]),
          })
          continue
        }
        for (const field of keys) {
          rows.push({
            label: `${label}[].${field}`,
            depth: depth + 1,
            kind: 'value',
            expression: scope ? `${scope.item}.${field}` : null,
            needs: scope ? undefined : label,
            source: 'data',
            sample: sampleOf(sampleItem[field]),
          })
        }
        continue
      }

      if (value && typeof value === 'object') {
        rows.push({ label, depth, kind: 'group', expression: null, source: 'data' })
        if (depth + 1 < MAX_DEPTH) {
          walk(value as Record<string, unknown>, depth + 1, label, expression ? `${expression}.` : null)
        }
        continue
      }

      rows.push({
        label,
        depth,
        kind: 'value',
        expression,
        source: 'data',
        sample: sampleOf(value),
      })
    }
  }

  if (data) walk(data, 0, '', '')

  // Mark the ones the template already uses, and add the ones the sample data
  // has never heard of — usually a field added to the template before anybody
  // updated the test JSON, which is worth seeing rather than hiding.
  const used = new Set(placeholders)
  for (const row of rows) {
    if (row.depth === 0 && used.has(row.label)) row.source = 'both'
    if (row.kind === 'array' && used.has(row.label.replace(/\[\]$/, ''))) row.source = 'both'
  }
  for (const name of placeholders) {
    if (named.has(name)) continue
    rows.push({ label: name, depth: 0, kind: 'value', expression: name, source: 'template' })
  }

  return rows
}

/** The loops in force at `el`, outermost first — read from the marker
 * attributes the bridge round-trips, so this agrees with the exported Jinja by
 * construction. */
export function scopesAt(el: Element | null, root: Element): LoopScope[] {
  const scopes: LoopScope[] = []
  for (let node = el; node && node !== root; node = node.parentElement) {
    const expression = node.getAttribute('data-jinja-for')
    const parsed = expression ? parseLoop(expression) : null
    if (parsed) scopes.unshift(parsed)
  }
  return scopes
}

/** `item in items` → the two names. Anything cleverer than a plain name on
 * either side (a filter, a tuple unpack) is left to Code mode rather than
 * half-understood. */
export function parseLoop(expression: string): LoopScope | null {
  const match = /^\s*([A-Za-z_][\w]*)\s+in\s+([A-Za-z_][\w.]*)\s*$/.exec(expression)
  return match ? { item: match[1], array: match[2] } : null
}
