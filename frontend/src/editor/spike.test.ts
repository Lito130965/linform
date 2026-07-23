// @vitest-environment jsdom
/**
 * Stage 0 spike: is "the DOM is the document model" actually viable?
 *
 * The custom editor's premise: render protect(body) into a contenteditable
 * document, let the user mutate the DOM, ship body.innerHTML back through
 * restore() with no model in between.
 *
 * First run against real templates showed the trip is NOT byte-exact — the
 * HTML5 parser itself normalizes markup: it inserts <tbody> into tables that
 * lack it and folds CRLF to LF inside text. Both are semantic no-ops for the
 * engine. So the contract this spike enforces is the honest one:
 *
 *   1. Whatever normalization happens belongs to a SMALL, NAMED set of
 *      benign classes — anything unrecognised fails the spike.
 *   2. The trip is IDEMPOTENT: a second pass changes nothing. The editor
 *      normalizes a legacy template once on first save, then never again.
 *   3. The normalized form renders the SAME PDF (checked by the python
 *      harness over the .roundtrip.html files this test writes).
 *   4. Edits produce ONLY their own diff against the normalized baseline.
 *
 * Fixtures: frontend/spike-fixtures/ — three public examples plus real
 * templates fetched from a live server (git-ignored: public repo, private
 * forms). The spike runs on whatever is present.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { diffLines } from 'diff'
import { describe, expect, it } from 'vitest'
import {
  detect,
  fromCanvasAssets,
  joinFromVisual,
  protect,
  restore,
  splitForVisual,
  toCanvasAssets,
} from '../jinja-bridge'

const FIXTURES = join(__dirname, '..', '..', 'spike-fixtures')
const OUT = join(FIXTURES, 'out')

function loadFixtures(): { name: string; html: string }[] {
  // Local runs use spike-fixtures/ (examples + real templates fetched from a
  // live server, git-ignored). CI has no such dir and falls back to the
  // public examples at the repo root, so the spike gate still runs there.
  const dirs = [FIXTURES, join(__dirname, '..', '..', '..', 'examples')]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter((f) => f.endsWith('.html'))
    if (files.length > 0) {
      return files.map((name) => ({ name, html: readFileSync(join(dir, name), 'utf-8') }))
    }
  }
  return []
}

/** The whole future editor, reduced to its essence. */
function roundtrip(html: string): { out: string; body: (b: string) => string } | null {
  const split = splitForVisual(html)
  if (!split.ok) return null
  if (!detect(split.body).supported) return null
  const host = document.createElement('div')
  host.innerHTML = toCanvasAssets(protect(split.body))
  const exportOnce = () =>
    joinFromVisual(split.prefix, restore(fromCanvasAssets(host.innerHTML)), split.suffix)
  return { out: exportOnce(), body: (b) => joinFromVisual(split.prefix, b, split.suffix) }
}

/**
 * The named benign normalizations, applied to BOTH sides before comparing.
 * Growing this list is a spike decision, not a convenience: every entry is a
 * way the saved template may differ from what the author originally typed.
 */
const BENIGN: { name: string; apply: (s: string) => string }[] = [
  // The parser folds CRLF to LF in character data (HTML5 preprocessing).
  { name: 'crlf', apply: (s) => s.replace(/\r\n/g, '\n') },
  // The parser inserts <tbody> into tables that omit it; the element is
  // implied by the spec and changes nothing for the engine.
  { name: 'tbody', apply: (s) => s.replace(/<\/?tbody>/gi, '') },
  // The serializer re-encodes U+00A0 as &nbsp; (and vice versa in source).
  { name: 'nbsp', apply: (s) => s.replace(/&nbsp;/g, ' ') },
  // The serializer always emits double-quoted attributes; hand-written
  // templates use single quotes freely.
  { name: 'attr-quotes', apply: (s) => s.replace(/=\s*'([^"']*)'/g, '="$1"') },
  // XHTML-style self-closing void tags lose the slash on serialization.
  { name: 'void-slash', apply: (s) => s.replace(/\s*\/>/g, '>') },
  // protect() lifts a {% for %} / {% if %} statement onto its element as an
  // attribute; restore() re-emits the tag ADJACENT to the element, so line
  // layout around block statements is not preserved. Whitespace next to a
  // statement tag is invisible to HTML rendering and to the engine alike.
  {
    name: 'ws-lines',
    apply: (s) => s.replace(/[^\S\n]+$/gm, '').replace(/\n+/g, '\n'),
  },
  {
    name: 'jinja-ws',
    apply: (s) => s.replace(/[^\S\n]*\n?[^\S\n]*(\{%[\s\S]*?%\})[^\S\n]*\n?[^\S\n]*/g, '$1'),
  },
]

function classify(a: string, b: string): { classes: string[]; residual: boolean } {
  if (a === b) return { classes: [], residual: false }
  const classes: string[] = []
  let left = a
  let right = b
  for (const rule of BENIGN) {
    const l = rule.apply(left)
    const r = rule.apply(right)
    if (l !== left || r !== right) classes.push(rule.name)
    left = l
    right = r
    if (left === right) return { classes, residual: false }
  }
  return { classes, residual: true }
}

const fixtures = loadFixtures()

describe('spike fixtures', () => {
  it('has fixtures to run against', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3)
  })
})

describe.each(fixtures)('$name', ({ name, html }) => {
  const trip = roundtrip(html)
  if (!trip) {
    it('is code-only — out of spike scope by design', () => {
      expect(trip).toBeNull()
    })
    return
  }

  it('normalization is limited to the named benign classes', () => {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, name.replace('.html', '.roundtrip.html')), trip.out)
    const { classes, residual } = classify(html, trip.out)
    if (residual) {
      const na = BENIGN.reduce((s, r) => r.apply(s), html)
      const nb = BENIGN.reduce((s, r) => r.apply(s), trip.out)
      const hunks = diffLines(na, nb).filter((p) => p.added || p.removed)
      const shown = hunks
        .slice(0, 8)
        .map((p) => `${p.added ? '+' : '-'} ${JSON.stringify(p.value.slice(0, 160))}`)
        .join('\n')
      expect.fail(`unrecognised normalization beyond [${classes.join(', ')}]:\n${shown}`)
    }
    // Record what happened for the report; byte-exact fixtures list nothing.
    writeFileSync(
      join(OUT, name.replace('.html', '.classes.txt')),
      classes.length ? classes.join(',') : 'byte-exact',
    )
  })

  it('is idempotent: a second trip changes nothing', () => {
    const second = roundtrip(trip.out)
    expect(second, 'normalized output must stay editable').not.toBeNull()
    expect(second!.out).toBe(trip.out)
  })

  it('edits land, and reverting them returns the exact baseline', () => {
    const split = splitForVisual(html)
    if (!split.ok) return
    const host = document.createElement('div')
    host.innerHTML = toCanvasAssets(protect(split.body))
    const exportNow = () =>
      joinFromVisual(split.prefix, restore(fromCanvasAssets(host.innerHTML)), split.suffix)
    const baseline = exportNow()

    // Edit 1: append a marker to the first real text node outside any chip.
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    let textNode: Text | null = null
    let originalText = ''
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (!/[A-Za-zА-Яа-яЁё]{3,}/.test(node.data)) continue
      // Skip locked chips: their visible text is thrown away on export (the
      // attribute is the source of truth), so a "typed" edit inside one would
      // vanish — which is exactly why they are contenteditable=false.
      if ((node.parentElement as HTMLElement | null)?.closest('[data-jinja-expr], [data-jinja-raw]'))
        continue
      textNode = node
      originalText = node.data
      break
    }
    if (textNode) textNode.data = originalText + ' SPIKEEDIT'

    // Edit 2: a fresh placeholder chip, exactly as protect() would mint it.
    const chip = document.createElement('span')
    chip.setAttribute('data-jinja-expr', 'spike_probe')
    chip.textContent = '{{ spike_probe }}'
    ;(host.lastElementChild ?? host).appendChild(chip)

    // Edit 3: clone a plain (non-loop) table row, where one exists.
    const rows = Array.from(host.querySelectorAll('tr')).filter(
      (tr) => !tr.hasAttribute('data-jinja-for'),
    )
    let clonedRow: Element | null = null
    if (rows.length > 0) {
      const row = rows[rows.length - 1]
      clonedRow = row.cloneNode(true) as Element
      row.parentElement!.insertBefore(clonedRow, row.nextSibling)
    }

    // The edits arrived in the export…
    const edited = exportNow()
    if (textNode) expect(edited).toContain('SPIKEEDIT')
    expect(edited).toContain('{{ spike_probe }}')
    if (clonedRow) {
      const count = (t: string) => (t.match(/<tr\b/g) ?? []).length
      expect(count(edited)).toBe(count(baseline) + 1)
    }

    // …and reverting them in the DOM returns the byte-exact baseline: the
    // strongest possible statement that the edits touched nothing else.
    if (textNode) textNode.data = originalText
    chip.remove()
    clonedRow?.remove()
    expect(exportNow()).toBe(baseline)
  })
})
