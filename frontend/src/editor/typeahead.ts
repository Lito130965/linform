/**
 * Typing `{{` in the canvas.
 *
 * The panel answers "what can I put here" when somebody goes looking. This
 * answers it without looking away: the two braces are what a person writes when
 * they mean a value, and in a WYSIWYG canvas they would otherwise be two
 * literal characters that print. Catching them turns a mistake into the
 * shortcut every editor of this shape has.
 *
 * Pure text arithmetic over the caret's own text node, so it is testable
 * without a layout engine — the canvas supplies the node and puts the chip in.
 */

export interface Trigger {
  /** Where `{{` starts in the text node. */
  start: number
  /** Where the caret is — everything between is what has been typed since. */
  end: number
  /** What has been typed after the braces, trimmed of the leading space. */
  query: string
}

/** The most that can be typed after `{{` before this stops being a field name
 * and starts being a sentence somebody meant literally. */
const MAX_QUERY = 40

/**
 * Is the caret just past a `{{` with a plausible field name after it?
 *
 * Deliberately narrow: a newline, a closing brace or anything that cannot be
 * part of a path ends it, so `{{ 1 + 2 }}` typed by hand is left alone once it
 * stops looking like a name.
 */
export function triggerAt(text: string, caret: number): Trigger | null {
  const start = text.lastIndexOf('{{', caret)
  if (start === -1) return null
  const between = text.slice(start + 2, caret)
  if (between.length > MAX_QUERY) return null
  if (/[}\n\r<>]/.test(between)) return null
  // One leading space is how people write `{{ name }}`; more than that, or any
  // other whitespace inside, and this is prose rather than a name.
  const query = between.replace(/^ ?/, '')
  if (/\s/.test(query)) return null
  if (!/^[\w.]*$/.test(query)) return null
  return { start, end: caret, query }
}

/** The most that can be typed after `/` before this stops being the name of a
 * block and starts being a sentence with a slash in it. */
const MAX_SLASH = 24

/**
 * Is the caret just past a `/` that was meant as a menu?
 *
 * The same bargain as `{{`, for structure rather than for values: a person who
 * wants a table types the word "table", and the alternative was to look away
 * from the page, find the palette and come back. `/` is what every editor of
 * this shape has taught people to press.
 *
 * Only where a word could begin — after a space, or at the start of the text —
 * so `12/03/2026` and `and/or` are left alone. Two words at most after it:
 * "page break" and "2 columns" are the longest names there are, and a third
 * word means this was prose with a slash in it rather than somebody reaching
 * for a block.
 */
export function slashTriggerAt(text: string, caret: number): Trigger | null {
  const start = text.lastIndexOf('/', caret)
  if (start === -1 || start >= caret) return null
  const before = start === 0 ? '' : text[start - 1]
  if (before && !/\s/.test(before)) return null
  const query = text.slice(start + 1, caret)
  if (query.length > MAX_SLASH) return null
  if (!/^[\w-]*(?: [\w-]+)?$/.test(query)) return null
  return { start, end: caret, query }
}

/** Rank named things by what has been typed. The same shape of match as `rank`
 * below, over a plain label rather than a dotted path: a prefix beats the start
 * of any later word, which beats a match in the middle. */
export function rankLabels<T extends { label: string }>(
  rows: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const needle = query.toLowerCase().trim()
  if (!needle) return rows.slice(0, limit)
  const scored: { row: T; score: number; index: number }[] = []
  rows.forEach((row, index) => {
    const label = row.label.toLowerCase()
    let score = -1
    if (label.startsWith(needle)) score = 3
    else if (label.split(/\s+/).some((word) => word.startsWith(needle))) score = 2
    else if (label.includes(needle)) score = 1
    if (score > 0) scored.push({ row, score, index })
  })
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.row)
}

/** Rank the offered expressions against what has been typed.
 *
 * A prefix match beats a match in the middle, and a match on the last segment
 * beats one on the path before it — typing `pri` should offer `item.price`
 * ahead of `price_list.item`. Case-insensitive, because nobody typing quickly
 * gets the case of a field right. */
export function rank<T extends { expression: string | null; label: string }>(
  rows: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const needle = query.toLowerCase()
  const scored: { row: T; score: number }[] = []
  for (const row of rows) {
    if (!row.expression) continue
    const expression = row.expression.toLowerCase()
    if (!needle) {
      scored.push({ row, score: 2 })
      continue
    }
    const last = expression.slice(expression.lastIndexOf('.') + 1)
    let score = -1
    if (expression.startsWith(needle)) score = 4
    else if (last.startsWith(needle)) score = 3
    else if (expression.includes(needle)) score = 1
    if (score < 0) continue
    scored.push({ row, score })
  }
  // Stable within a score: the order the data itself is in carries meaning.
  return scored
    .map((s, index) => ({ ...s, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.row)
}
