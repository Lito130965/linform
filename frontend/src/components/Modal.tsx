import { useEffect, useId, useRef, type ReactNode } from 'react'
import Icon from './Icon'

/**
 * An accessible modal shell.
 *
 * A dialog is where keyboard accessibility usually breaks: focus stays behind
 * the overlay, Escape does nothing, and a screen reader reads the page under it
 * as if the dialog were not there. All three are handled once, here, rather
 * than argued about per dialog.
 *
 * - `role="dialog"` + `aria-modal` + a title the dialog is labelled by;
 * - focus moves in on open and returns to the trigger on close, so the user
 *   does not land back at the top of the document;
 * - Tab cycles inside the dialog instead of wandering behind it;
 * - Escape closes.
 *
 * Clicking the backdrop also closes, as a mouse convenience — it is never the
 * only way out, which is what keeps that shortcut from being an accessibility
 * problem.
 */
export default function Modal({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null)

    // Prefer the first real control; fall back to the dialog itself so focus
    // never stays on whatever was behind the overlay.
    ;(focusable()[0] ?? dialog).focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    dialog.addEventListener('keydown', onKeyDown)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  return (
    <div className="dialog-backdrop" role="presentation">
      {/* The click-outside-to-close target is its own layer, behind the dialog
          and hidden from assistive technology. Keeping it separate (rather
          than hanging a click handler on the container the dialog lives in)
          means it is genuinely decorative: Escape and the Close button are the
          real exits, and this is a mouse shortcut on top of them. */}
      <div className="dialog-dismiss" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        className={`dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-head">
          <strong id={titleId}>{title}</strong>
          <button className="btn small" aria-label="Close dialog" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
