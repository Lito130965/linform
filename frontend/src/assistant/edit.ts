/**
 * Changing part of a document without reproducing the whole of it.
 *
 * Asked to add one column to a table, the assistant returned all sixty lines of
 * the template with three of them different. That is wrong in two ways that get
 * worse together: the user cannot see what changed, and every line the model
 * retypes is a line it can get wrong. On a real form — hundreds of lines, exact
 * article references, a government layout — reproducing the document to change
 * a cell is how a wording quietly becomes a paraphrase.
 *
 * So a small change is expressed as one: the text to find, and what to put in
 * its place. The document is never retyped, the change is readable as a
 * sentence, and there is nothing for the model to lose along the way.
 *
 * It either matches exactly once or it does nothing. An edit that hits three
 * places would change two of them by accident, and one that hits none has to be
 * said out loud rather than silently skipped — a "done" over a document that
 * did not change is the worst of the available outcomes.
 *
 * Whitespace is the one thing allowed to differ. Models reflow markup as they
 * quote it, and refusing an edit because a line was wrapped differently would
 * make this useless for exactly the templates it is for. Everything else — the
 * characters, the order, the tags — must be what is in the document.
 */

export type EditResult = { html: string } | { error: string }

/**
 * The document with its insignificant whitespace taken out, and a way back.
 *
 * Two kinds of difference have to be forgiven, because a model reflows markup
 * as it quotes it: a run of spaces where the document has one, and a line break
 * between two tags where the document has nothing at all. Both are the same
 * document. Anything else — a character, an attribute, an order — is not.
 *
 * Matching happens in this normalised text, and `origin` says where each
 * character came from, so the replacement is spliced into the ORIGINAL bytes.
 * The document is never reformatted by being edited.
 */
function normalise(text: string): { flat: string; origin: number[] } {
  let flat = ''
  const origin: number[] = []
  let i = 0
  while (i < text.length) {
    if (!/\s/.test(text[i])) {
      flat += text[i]
      origin.push(i)
      i++
      continue
    }
    let j = i
    while (j < text.length && /\s/.test(text[j])) j++
    // Between two tags a run of whitespace is not text at all; anywhere else it
    // is one space, however it was typed.
    const betweenTags = flat.endsWith('>') && text[j] === '<'
    if (!betweenTags && flat !== '' && j < text.length) {
      flat += ' '
      origin.push(i)
    }
    i = j
  }
  return { flat, origin }
}

const shown = (text: string, limit = 60): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

export function applyEdit(html: string, find: string, replace: string): EditResult {
  if (!find.trim()) return { error: 'the text to find was empty' }
  const doc = normalise(html)
  const needle = normalise(find).flat
  if (!needle) return { error: 'the text to find was empty' }

  const hits: number[] = []
  for (let at = doc.flat.indexOf(needle); at !== -1; at = doc.flat.indexOf(needle, at + 1)) {
    hits.push(at)
  }
  if (hits.length === 0) return { error: `“${shown(find)}” is not in the document` }
  if (hits.length > 1) {
    // Deliberately not "the first one": which of three identical rows was meant
    // is exactly the thing that cannot be guessed.
    return {
      error: `“${shown(find)}” appears ${hits.length} times — it has to name one place`,
    }
  }

  const from = doc.origin[hits[0]]
  const lastChar = doc.origin[hits[0] + needle.length - 1]
  // Past the last character of the match, in the original text.
  const to = lastChar + 1
  return { html: html.slice(0, from) + replace + html.slice(to) }
}

/**
 * One line a person can read.
 *
 * What was ADDED, where an edit only adds: told that a change is "to
 * `<th class="num">This quarter</th>`" somebody still has to work out what
 * became of it, and the new column is the thing they asked for. The anchor is
 * kept as the second half of the sentence, because where it goes matters too.
 */
export function describeEdit(find: string, replace: string): string {
  if (!replace.trim()) return `Remove “${shown(find, 50)}”`
  const anchor = find.trim()
  const next = replace.trim()
  if (next.startsWith(anchor)) {
    return `Add “${shown(next.slice(anchor.length), 40)}” after “${shown(anchor, 30)}”`
  }
  if (next.endsWith(anchor)) {
    return `Add “${shown(next.slice(0, next.length - anchor.length), 40)}” before “${shown(anchor, 30)}”`
  }
  return `Change “${shown(find, 40)}” to “${shown(replace, 40)}”`
}
