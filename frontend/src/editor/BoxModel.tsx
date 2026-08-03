import { useEffect, useRef, useState } from 'react'
import { SIDES, displayValue, mmHint, provenanceOf, pxToMm, readLengthInput } from './box-model'

/**
 * The box of the selected element: what surrounds it, what pads it, how big it
 * is — laid out the way the box actually is, so each number sits on the side it
 * changes and there is nothing to memorise.
 *
 * Three things it has to get right, all of them learned by using it:
 *
 * **Every cell looks like a field.** Showing a border only once a value was set
 * turned the rest into numbers floating on the panel — nothing said they could
 * be typed into. Set and inherited are still distinguishable, by weight rather
 * than by whether the control appears to exist.
 *
 * **A value can be edited, not only replaced.** The boxes are controlled from
 * local state while they are being typed in, and are read back from the element
 * only after a value is committed. An uncontrolled field re-seeded from a
 * mutating document fights whoever is editing it.
 *
 * **A number can be dragged.** Sideways on any cell scrubs the value, which is
 * how a spacing gets found — nobody knows that a gap wants 6.5 mm, they know it
 * when they see it. Arrow keys do the same thing without a mouse.
 */
export default function BoxModel({
  el,
  view,
  sizeLabel,
  onApply,
}: {
  /** the selected element, read for both its inline and its computed values */
  el: HTMLElement
  /** the window the element lives in — the canvas iframe, not this document */
  view: Window
  /** what width and height mean here; for a table cell they are the column and
   * the row, which is a different enough action to say so */
  sizeLabel: { width: string; height: string }
  /** null clears the property rather than writing a zero */
  onApply: (property: string, value: string | null) => void
  /** true while one of these boxes has the focus, so the canvas can put its
   * millimetre ruler up: geometry is about to change, whether by typing, by an
   * arrow key or by a drag that starts here */
  onAdjusting: (active: boolean) => void
}) {
  const computed = view.getComputedStyle(el)
  // What is in the boxes while they are being typed in. Committed values leave
  // this map, so the field goes back to reading the element.
  const [typing, setTyping] = useState<Record<string, string>>({})
  const scrub = useRef<{ property: string; startX: number; from: number; moved: boolean } | null>(
    null,
  )

  const inlineOf = (property: string): string => el.style.getPropertyValue(property)

  const shown = (property: string): string =>
    typing[property] ?? displayValue(inlineOf(property))

  const forget = (property: string): void =>
    setTyping((all) => {
      const { [property]: _dropped, ...rest } = all
      return rest
    })

  const commit = (property: string, typed: string): void => {
    const asked = readLengthInput(typed)
    // Something that is not a length leaves the document alone and puts the box
    // back, so a stray full stop cannot delete a margin.
    if (asked.kind !== 'invalid') onApply(property, asked.kind === 'clear' ? null : asked.value)
    forget(property)
  }

  /** The number a drag or an arrow key starts from: what is set here, else what
   * the element actually computes to — nudging "up" from an inherited 4 mm
   * should give 5, not 1. */
  const currentMm = (property: string): number => {
    const own = parseFloat(shown(property))
    if (Number.isFinite(own)) return own
    const px = parseFloat(computed.getPropertyValue(property))
    return Number.isFinite(px) ? pxToMm(px) : 0
  }

  const nudge = (property: string, by: number): void => {
    const next = Math.round((currentMm(property) + by) * 10) / 10
    setTyping((all) => ({ ...all, [property]: String(next) }))
    onApply(property, `${next}mm`)
  }

  // A drag is followed on the window: the pointer leaves a 34px-wide box almost
  // at once, and losing the value the moment it does would make scrubbing
  // useless.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const active = scrub.current
      if (!active) return
      const dx = e.clientX - active.startX
      if (!active.moved && Math.abs(dx) < 3) return
      active.moved = true
      e.preventDefault()
      // Half a millimetre per pixel: fine enough to land on a value, coarse
      // enough to cross a page margin without dragging across the room.
      const next = Math.round((active.from + dx * 0.5) * 10) / 10
      setTyping((all) => ({ ...all, [active.property]: String(next) }))
      onApply(active.property, `${next}mm`)
    }
    const up = () => {
      const active = scrub.current
      scrub.current = null
      if (active?.moved) forget(active.property)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })

  const box = (property: string, label: string, className: string) => {
    const inline = inlineOf(property)
    return (
      <input
        key={property}
        className={`bm-input ${className} ${provenanceOf(inline)}`}
        aria-label={label}
        inputMode="decimal"
        title={`${label} — millimetres unless you name a unit. Drag sideways or use ↑/↓ to change it; empty follows the stylesheet.`}
        value={shown(property)}
        placeholder={mmHint(computed.getPropertyValue(property))}
        onChange={(e) => setTyping((all) => ({ ...all, [property]: e.target.value }))}
        onMouseDown={(e) => {
          scrub.current = {
            property,
            startX: e.clientX,
            from: currentMm(property),
            moved: false,
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(property, e.currentTarget.value)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            forget(property)
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            nudge(property, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
          }
        }}
        onFocus={() => onAdjusting(true)}
        onBlur={(e) => {
          onAdjusting(false)
          commit(property, e.target.value)
        }}
      />
    )
  }

  return (
    <div className="box-model" role="group" aria-label="Size and spacing, in millimetres">
      <span className="bm-caption">margin</span>
      {SIDES.map((side) => box(`margin-${side}`, `Margin ${side}`, `bm-margin bm-${side}`))}
      <div className="bm-padding-area">
        <span className="bm-caption">padding</span>
        {SIDES.map((side) => box(`padding-${side}`, `Padding ${side}`, `bm-padding bm-${side}`))}
        <div className="bm-size">
          {box('width', sizeLabel.width, 'bm-w')}
          <span aria-hidden="true">×</span>
          {box('height', sizeLabel.height, 'bm-h')}
        </div>
      </div>
    </div>
  )
}
