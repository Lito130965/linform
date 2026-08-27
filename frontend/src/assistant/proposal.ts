/**
 * What a proposed template will cost, said before it is applied.
 *
 * A template the assistant writes by hand can be correct and still take the
 * document out of reach: a page number written as a string in an `@page` margin
 * box prints perfectly and cannot be selected, moved or restyled by anybody
 * afterwards, and a `{% macro %}` closes Visual mode for the whole file. Both
 * are invisible in a diff — they look like ordinary lines of CSS and Jinja —
 * and the person applying the change discovers the loss later, with no idea
 * which edit caused it.
 *
 * So the proposal is read for exactly those, and what is found is put beside
 * the Apply button. Not a refusal: sometimes a macro is the right answer and
 * the author knows it. It is the sentence that makes it a decision.
 */

import { detect } from '../jinja-bridge'

export interface Caveat {
  /** What is in the template. */
  what: string
  /** What it costs, in the user's terms. */
  cost: string
}

/** `@top-center { content: "Page " counter(page) }` and friends: a margin box
 * whose content is a literal rather than `element(...)`. */
const MARGIN_BOX = /@(?:top|bottom)-(?:left|center|right)\s*\{([^}]*)\}/gi

export function proposalCaveats(html: string): Caveat[] {
  const caveats: Caveat[] = []

  for (const box of html.matchAll(MARGIN_BOX)) {
    const body = box[1]
    if (!/content\s*:/i.test(body) || /element\s*\(/i.test(body)) continue
    caveats.push({
      what: 'a header or footer written as text inside an @page margin box',
      cost:
        'it prints, but nothing in the editor can select, move or restyle it — ' +
        'a running element in a band can be edited like any other content',
    })
    break
  }

  const detected = detect(html)
  if (!detected.supported) {
    caveats.push({
      what: detected.reasons.join('; '),
      cost: 'Visual mode cannot open this template, so it becomes code-only',
    })
  }
  return caveats
}
