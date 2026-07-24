import { type Colour } from './color'

/** A colour swatch plus an opacity percent — one palette. Emits the combined
 * Colour on either change; the parent decides whether it becomes CSS rgba() or
 * a filter's hex argument. */
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
        value={value.hex}
        onChange={(e) => onChange({ ...value, hex: e.target.value })}
      />
      <input
        className="cc-opacity"
        type="number"
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
