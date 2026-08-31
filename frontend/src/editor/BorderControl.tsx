import { useState } from 'react'
import ColorControl from './ColorControl'
import { parse as parseColour, toCss } from './color'
import {
  BORDER_STYLES,
  SIDES,
  applyBorders,
  readBorders,
  sameOnEverySide,
  type Border,
  type BorderStyle,
  type Side,
} from './borders'

/**
 * Borders, per side.
 *
 * The only border control was the table's — all cells, outer only, none — which
 * covers a table and nothing else. A printed form is made of the rest: the line
 * under a signature, the box around a note, the heavy rule above a total, the
 * one cell ruled differently from its neighbours.
 *
 * Sides are chosen first and then given a style, rather than four copies of the
 * same three controls: that is the shape of the decision ("this edge, like
 * this"), and it keeps a row of the properties bar rather than a dialog.
 */
export default function BorderControl({
  el,
  view,
  onChange,
}: {
  el: HTMLElement
  view: Window
  onChange: () => void
}) {
  const current = readBorders(el, view)
  const uniform = sameOnEverySide(current)
  // Which edges the next change applies to. All of them to start with, because
  // that is what most changes mean.
  const [chosen, setChosen] = useState<Side[] | 'all'>('all')
  const sides = chosen === 'all' ? SIDES : chosen
  const shown: Border = current[sides[0] ?? 'top']

  const write = (patch: Partial<Border>) => {
    const next = { ...current }
    for (const side of sides) next[side] = { ...next[side], ...patch }
    applyBorders(el, next)
    onChange()
  }

  const toggle = (side: Side) => {
    if (chosen === 'all') return setChosen([side])
    const without = chosen.filter((s) => s !== side)
    if (without.length === chosen.length) return setChosen([...chosen, side])
    setChosen(without.length === 0 ? 'all' : without)
  }

  return (
    <span className="border-control">
      <span className="cc-label">Border</span>
      {/* A square with a side to press on each edge, the way every spreadsheet
          has drawn this for thirty years. The letters it replaces — T, R, B, L,
          All — were a puzzle to solve before you could rule a line: five words
          in a language of their own, describing a shape that can simply be
          shown. The middle button is all four.

          Each side shows whether it currently HAS a border, so the square is
          also the answer to "which edges are ruled" — which no arrangement of
          letters was ever going to give. */}
      <span
        className="border-picker"
        role="group"
        aria-label="Which edges to change"
      >
        {SIDES.map((side) => (
          <button
            key={side}
            className={
              'border-side ' +
              side +
              (chosen !== 'all' && chosen.includes(side) ? ' chosen' : '') +
              (current[side].style !== 'none' && current[side].width !== '0px' ? ' ruled' : '')
            }
            title={`The ${side} edge`}
            aria-label={`${side} edge`}
            aria-pressed={chosen === 'all' || chosen.includes(side)}
            onClick={() => toggle(side)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
        <button
          className={chosen === 'all' ? 'border-all chosen' : 'border-all'}
          title="All four edges"
          aria-label="All four edges"
          aria-pressed={chosen === 'all'}
          onClick={() => setChosen('all')}
        >
          <span aria-hidden="true" />
        </button>
      </span>

      <select
        aria-label="Border style"
        value={uniform || chosen !== 'all' ? shown.style : ''}
        onChange={(e) => write({ style: e.target.value as BorderStyle })}
      >
        {/* Blank only while the four edges genuinely differ — a select showing
            "solid" over a mixed border would be stating something untrue. */}
        {!uniform && chosen === 'all' && <option value="">mixed</option>}
        {BORDER_STYLES.map((style) => (
          <option key={style} value={style}>
            {style}
          </option>
        ))}
      </select>

      <input
        aria-label="Border width"
        className="border-width"
        defaultValue={shown.width}
        key={`${sides.join()}:${shown.width}`}
        onBlur={(e) => write({ width: e.target.value.trim() || '1px' })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />

      <ColorControl
        label="Line"
        value={parseColour(shown.colour)}
        onChange={(c) => write({ colour: toCss(c) })}
      />
    </span>
  )
}
