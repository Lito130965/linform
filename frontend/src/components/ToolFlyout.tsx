import { useEffect, useRef, type ReactNode } from 'react'
import Icon from './Icon'

/**
 * The panel a tool opens: 320 px, over the page, never beside it.
 *
 * Over is the whole point. The bottom panel took its height out of the canvas,
 * so opening the blocks re-laid the document out and the page jumped under the
 * pointer — at the exact moment somebody is aiming at where a block should go.
 * Absolutely positioned inside the canvas column, this cannot change the
 * canvas's size, so the zoom and the page's position are identical open or
 * shut. That is a structural guarantee rather than a promise to be careful.
 *
 * Escape closes it. A click elsewhere does NOT: the point of the panel is to
 * click into the document with it open — that is how a block lands where the
 * caret is.
 */
export default function ToolFlyout({
  title,
  hint,
  children,
  onClose,
}: {
  title: string
  hint?: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="tool-flyout" ref={ref} aria-label={title}>
      <header className="tool-flyout-head">
        <h2 className="panel-heading">
          {title}
          {hint && <span className="muted"> — {hint}</span>}
        </h2>
        <button className="tb" aria-label="Close the panel" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="tool-flyout-body">{children}</div>
    </div>
  )
}
