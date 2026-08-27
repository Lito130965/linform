import { useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'

/**
 * A draggable boundary between two columns.
 *
 * The editor's panes used to be `flex: 1` each — an even split with nothing to
 * grab, which is why an A4 page came out at 70 % on a 1920 screen: half the
 * shell, minus a fixed structure panel, is 570 px for a 794 px page. Where the
 * space goes is the author's business, not a constant.
 *
 * Keyboard first, not as an afterthought: this is `role="separator"` with a
 * value, so a screen reader announces it as something adjustable and the arrows
 * move it. The pattern is the one the bottom panel's edge already used
 * (Editor.tsx) — 24 px a step, the same feel as dragging — kept identical here
 * so there is one contract for every boundary in the editor rather than one per
 * boundary.
 *
 * Reports on every move rather than only on release: a boundary that shows its
 * new position after you let go is a boundary you place by trial.
 */
export default function Splitter({
  value,
  min,
  max,
  defaultValue,
  label,
  onChange,
  /** Which side of the splitter grows as the pointer moves right. The preview
   * sits on the right of its boundary, so dragging left makes it WIDER. */
  grows = 'before',
}: {
  value: number
  min: number
  max: number
  defaultValue: number
  label: string
  onChange: (value: number) => void
  grows?: 'before' | 'after'
}) {
  const dragging = useRef(false)

  const clamp = (v: number): number => Math.min(max, Math.max(min, v))

  const onMouseDown = (e: ReactMouseEvent): void => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startValue = value
    const onMove = (ev: MouseEvent): void => {
      const delta = grows === 'before' ? ev.clientX - startX : startX - ev.clientX
      onChange(clamp(startValue + delta))
    }
    const onUp = (): void => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('splitting')
    }
    // While a drag is in flight the iframe in the canvas would otherwise
    // swallow the pointer the moment it crossed the boundary.
    document.body.classList.add('splitting')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    const step = e.shiftKey ? 96 : 24
    if (e.key === 'ArrowLeft') onChange(clamp(value + (grows === 'before' ? -step : step)))
    else if (e.key === 'ArrowRight') onChange(clamp(value + (grows === 'before' ? step : -step)))
    else if (e.key === 'Home') onChange(min)
    else if (e.key === 'End') onChange(max)
    else return
    e.preventDefault()
  }

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      // Back to where it started, in one gesture — the same way a double click
      // resets a column in every table anybody has used.
      onDoubleClick={() => onChange(defaultValue)}
      title="Drag to resize, double-click to reset"
    />
  )
}
