/**
 * The structure of the document, beside the document.
 *
 * Three things a page cannot tell you about itself, all of which people asked
 * for after using the canvas:
 *
 * 1. **What is there.** A cell, its row, the table and the block around it
 *    occupy the same pixels. A click has to pick one, and hovering can only
 *    describe one. The list names all four and lets you take any of them —
 *    which is the answer to "it selected the wrong thing", rather than another
 *    guess at what the right thing was.
 * 2. **Where I am.** The selected row is marked and scrolled to, so a selection
 *    made in the canvas says how deep in the structure it landed.
 * 3. **What is in the way.** The eye takes a block out of sight WITHOUT taking
 *    it out of the document — see the note on hiding in CanvasEditor. Working
 *    under a full-bleed background is otherwise a matter of luck.
 *
 * The rows are buttons in a list rather than an ARIA tree: a treeitem must not
 * contain focusable elements, and each row has two things to press. A list of
 * buttons is navigable by Tab, announced correctly, and needs no roving
 * tabindex to be right.
 */

import { useEffect, useRef } from 'react'
import Icon from '../components/Icon'
import type { OutlineItem } from './outline'

export interface OutlinePanelProps {
  items: OutlineItem[]
  selected: Element | null
  /** How many blocks are hidden in the canvas — never a silent state. */
  hiddenCount: number
  isOpen: (el: HTMLElement) => boolean
  isHidden: (el: HTMLElement) => boolean
  onHover: (el: HTMLElement | null) => void
  onSelect: (el: HTMLElement) => void
  onToggleOpen: (el: HTMLElement) => void
  onToggleHidden: (el: HTMLElement) => void
  onShowAll: () => void
  onClose: () => void
}

const INDENT_PX = 13

export default function OutlinePanel({
  items,
  selected,
  hiddenCount,
  isOpen,
  isHidden,
  onHover,
  onSelect,
  onToggleOpen,
  onToggleHidden,
  onShowAll,
  onClose,
}: OutlinePanelProps) {
  // Follow the selection, but only when it changes. Tied to a render instead,
  // this would yank the list back under the reader on every mutation the canvas
  // reports — which is every keystroke.
  const currentRow = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <aside className="canvas-outline" aria-label="Document structure">
      <header className="outline-head">
        <h2>Structure</h2>
        <button className="tb" onClick={onClose} aria-label="Hide the structure panel">
          <Icon name="close" size={14} />
        </button>
      </header>

      {hiddenCount > 0 && (
        <p className="outline-note">
          {hiddenCount} {hiddenCount === 1 ? 'block is' : 'blocks are'} hidden here. They are still
          in the template and still print.{' '}
          <button className="linkish" onClick={onShowAll}>
            Show all
          </button>
        </p>
      )}

      {items.length === 0 ? (
        <p className="outline-empty">Nothing in the document yet.</p>
      ) : (
        <ul className="outline-list">
          {items.map((item, index) => {
            const open = item.container && isOpen(item.el)
            const hidden = isHidden(item.el)
            const current = item.el === selected
            return (
              <li
                key={index}
                ref={current ? currentRow : undefined}
                className={
                  'outline-item' + (current ? ' current' : '') + (hidden ? ' is-hidden' : '')
                }
                style={{ paddingLeft: 4 + item.depth * INDENT_PX }}
              >
                {item.container ? (
                  <button
                    className="outline-twisty"
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
                    onClick={() => onToggleOpen(item.el)}
                  >
                    <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                  </button>
                ) : (
                  <span className="outline-twisty empty" aria-hidden="true" />
                )}

                <button
                  className="outline-row"
                  onClick={() => onSelect(item.el)}
                  onMouseEnter={() => onHover(item.el)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(item.el)}
                  onBlur={() => onHover(null)}
                  aria-current={current || undefined}
                >
                  <span className="outline-label">{item.label}</span>
                  {item.detail && <span className="outline-detail">{item.detail}</span>}
                </button>

                <button
                  className="outline-eye"
                  aria-pressed={hidden}
                  aria-label={`${hidden ? 'Show' : 'Hide'} this ${item.label.toLowerCase()} in the canvas`}
                  title={
                    hidden
                      ? 'Hidden in the canvas — still in the template'
                      : 'Hide in the canvas. The template is not changed and the layout does not move.'
                  }
                  onClick={() => onToggleHidden(item.el)}
                >
                  <Icon name={hidden ? 'eye-off' : 'eye'} size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
