import { SIDES, displayValue, mmHint, provenanceOf, readLengthInput } from './box-model'

/**
 * The box of the selected element: what surrounds it, what pads it, how big it
 * is — laid out the way the box actually is, so each number sits on the side it
 * changes and there is nothing to memorise.
 *
 * It replaces two single-letter fields (`W`, `H`) that were technically enough
 * to resize a block and that nobody found. Spacing had no control at all.
 *
 * Values are applied on Enter or when the box loses focus, never per keystroke:
 * typing `100mm` used to walk the document through `1`, `10`, `100`, `100m`,
 * and the layout jumped under the hands of whoever was typing.
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
}) {
  const computed = view.getComputedStyle(el)

  const commit = (property: string, typed: string, input: HTMLInputElement): void => {
    const asked = readLengthInput(typed)
    if (asked.kind === 'invalid') {
      // Put the box back rather than write something the author did not mean.
      input.value = displayValue(el.style.getPropertyValue(property))
      return
    }
    onApply(property, asked.kind === 'clear' ? null : asked.value)
  }

  const box = (property: string, label: string, className: string) => {
    const inline = el.style.getPropertyValue(property)
    return (
      <input
        className={`bm-input ${className} ${provenanceOf(inline)}`}
        aria-label={label}
        title={`${label} — millimetres unless you name a unit; empty follows the stylesheet`}
        defaultValue={displayValue(inline)}
        placeholder={mmHint(computed.getPropertyValue(property))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(property, e.currentTarget.value, e.currentTarget)
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.currentTarget.value = displayValue(el.style.getPropertyValue(property))
            e.currentTarget.blur()
          }
        }}
        onBlur={(e) => commit(property, e.target.value, e.target)}
      />
    )
  }

  return (
    <div className="box-model" role="group" aria-label="Size and spacing, in millimetres">
      <span className="bm-caption">margin</span>
      {SIDES.map((side) =>
        box(`margin-${side}`, `Margin ${side}`, `bm-margin bm-${side}`),
      )}
      <div className="bm-padding-area">
        <span className="bm-caption">padding</span>
        {SIDES.map((side) =>
          box(`padding-${side}`, `Padding ${side}`, `bm-padding bm-${side}`),
        )}
        <div className="bm-size">
          {box('width', sizeLabel.width, 'bm-w')}
          <span aria-hidden="true">×</span>
          {box('height', sizeLabel.height, 'bm-h')}
        </div>
      </div>
    </div>
  )
}
