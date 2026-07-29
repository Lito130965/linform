import { type Colour } from './color'

/** A colour swatch plus an opacity percent — one palette.
 *
 * The swatch is UNCONTROLLED (defaultValue): while its native picker dialog is
 * open, every drag fires onChange and re-renders the props bar, and pushing a
 * fresh `value` into an open colour dialog traps it — the window stops
 * responding and will not close. Leaving React out of the input's value while
 * the dialog is open fixes that; the parent re-seeds it on each new selection
 * through the props bar's key. */
export default function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: Colour
  onChange: (c: Colour) => void
}) {
  return (
    <span className="color-control" title={label}>
      <span className="cc-label">{label}</span>
      <input
        type="color"
        aria-label={`${label} colour`}
        defaultValue={value.hex}
        onChange={(e) => onChange({ ...value, hex: e.target.value })}
      />
      <input
        className="cc-opacity"
        type="number"
        aria-label={`${label} opacity, percent`}
        min={0}
        max={100}
        value={value.opacity}
        onChange={(e) =>
          onChange({ ...value, opacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
        }
      />
      <span className="cc-pct">%</span>
    </span>
  )
}
