import { useEffect, useRef, useState } from 'react'
import ColorControl from './ColorControl'
import { parse as parseColour, toCss } from './color'
import {
  DEFAULT_SETUP,
  PAGE_SIZES,
  type PageMargins,
  type PageSetup,
} from './page-css'

/**
 * The page: size, orientation, margins, background.
 *
 * It replaces a menu that changed the canvas and nothing else — choose A5 and
 * the sheet became A5 while the PDF stayed A4, with nothing anywhere saying so.
 * Every control here writes the template's own `@page` rule, so what the canvas
 * draws and what the renderer prints come from the same sentence.
 *
 * Margins are in millimetres because printed work is measured work, and the
 * value written carries the unit. A document whose margins are in some other
 * unit is shown as authored and left alone until somebody edits that side.
 */

const MM = /^(-?[\d.]+)\s*mm$/i

function toMm(value: string): string {
  const m = MM.exec(value.trim())
  if (m) return m[1]
  // Other units are honoured, not converted behind somebody's back.
  return value.trim()
}

const SIDES: (keyof PageMargins)[] = ['top', 'right', 'bottom', 'left']

export default function PageSetupPanel({
  setup,
  overrides,
  onChange,
  onClose,
}: {
  setup: PageSetup
  /** Sides a later @page rule wins, and what set them. */
  overrides: { side: string; value: string }[]
  onChange: (next: PageSetup) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Click away or press Escape: a popover that has to be dismissed by finding
  // its own button again is a popover that stays open.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const [linked, setLinked] = useState(
    setup.margin.top === setup.margin.bottom && setup.margin.left === setup.margin.right,
  )

  const setMargin = (side: keyof PageMargins, raw: string) => {
    const value = raw.trim() === '' ? '0' : raw.trim()
    const written = MM.test(`${value}mm`) || /^[\d.]+$/.test(value) ? `${value}mm` : value
    const margin = { ...setup.margin }
    if (linked) {
      if (side === 'top' || side === 'bottom') margin.top = margin.bottom = written
      else margin.left = margin.right = written
    } else {
      margin[side] = written
    }
    onChange({ ...setup, margin })
  }

  return (
    <div className="page-setup" ref={ref} role="dialog" aria-label="Page setup">
      <label className="prop">
        Size
        <select
          value={setup.size || 'A4'}
          onChange={(e) => onChange({ ...setup, size: e.target.value })}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <span className="topbar-group">
        <button
          className={setup.landscape ? 'tb' : 'tb active'}
          aria-pressed={!setup.landscape}
          onClick={() => onChange({ ...setup, landscape: false })}
        >
          Portrait
        </button>
        <button
          className={setup.landscape ? 'tb active' : 'tb'}
          aria-pressed={setup.landscape}
          onClick={() => onChange({ ...setup, landscape: true })}
        >
          Landscape
        </button>
      </span>

      <div className="page-margins">
        <span className="cc-label">Margins, mm</span>
        {SIDES.map((side) => (
          <label key={side} className="prop">
            {side}
            {overrides.some((o) => o.side === side) && (
              <span className="page-overridden" title="A later rule sets this side">
                ⚠
              </span>
            )}
            <input
              aria-label={`${side} margin in millimetres`}
              defaultValue={toMm(setup.margin[side])}
              onBlur={(e) => setMargin(side, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </label>
        ))}
        <label className="prop link-margins">
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          link opposite sides
        </label>
      </div>

      <div className="page-background">
        <ColorControl
          label="Background"
          value={parseColour(setup.background ?? '')}
          onChange={(c) => onChange({ ...setup, background: toCss(c) || null })}
        />
        {setup.background && (
          <button className="tb" onClick={() => onChange({ ...setup, background: null })}>
            Clear
          </button>
        )}
      </div>

      {/* A later rule wins in print, so it wins here too: saying nothing would
          make this panel look broken the moment a header block is added. */}
      {overrides.length > 0 && (
        <p className="page-note">
          {overrides.map((o) => `${o.side} is ${o.value}`).join(', ')} — set further down the
          stylesheet, by a header, footer or page-number block. That value is the one that prints.
        </p>
      )}

      <p className="page-note muted">
        Written into the template's own <code>@page</code> rule.
        {setup.size === '' && ' This template did not declare a size; choosing one adds it.'}
      </p>

      <button className="btn small" onClick={() => onChange({ ...DEFAULT_SETUP })}>
        Reset to A4, 20mm
      </button>
    </div>
  )
}
