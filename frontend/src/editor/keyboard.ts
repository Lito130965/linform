/** Keyboard navigation over the canvas's structural selection.
 *
 * The canvas is contenteditable, so the plain arrows, Enter, Delete and
 * Backspace all belong to text editing and cannot be taken away from it.
 * Structure therefore lives behind **Alt**: Alt+arrows walk the document tree,
 * Alt+Enter opens the selected node, Alt+Delete removes it, Escape steps out.
 *
 * Movement is by tree, not by document order. Alt+down from the last cell of a
 * row does nothing rather than surfacing into the next paragraph: "the next one
 * of these" is a rule somebody can hold in their head, where "the next node
 * anywhere" is a rule you have to watch to understand.
 *
 * Pure, and separate from the component, so it can be tested without a browser
 * and without an iframe — which is the only reason it is testable at all.
 */

import { kindOf, parentSelectable } from './selection'

export type CanvasIntent =
  | { action: 'select'; el: Element | null }
  | { action: 'remove'; el: Element }
  | { action: 'editExpression'; el: Element }
  | { action: 'placeCaret'; el: Element }

/** The selectable elements directly inside `parent`.
 *
 * Wrappers the editor does not offer are stepped through rather than treated as
 * a level: a paragraph inside a plain `<span>` is still a sibling of the
 * paragraph beside it, because that is what it looks like on the page.
 */
export function selectableChildren(parent: Element): Element[] {
  const found: Element[] = []
  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (kindOf(child)) found.push(child)
      else walk(child)
    }
  }
  walk(parent)
  return found
}

/** The nodes at the same level as `el`, including itself. */
export function siblingsOf(el: Element, root: Element): Element[] {
  return selectableChildren(parentSelectable(el, root) ?? root)
}

/** Only the parts of a keyboard event this decision needs, so a test can state
 * a key press as an object rather than construct a synthetic event. */
export type KeyLike = {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** Kinds whose content is a Jinja expression rather than text a caret edits. */
const EXPRESSION_KINDS = new Set(['chip', 'loop', 'conditional'])

/**
 * What a key press should do, or null to leave it to the browser — which for
 * this canvas means "let it type".
 */
export function intentFor(
  e: KeyLike,
  selected: Element | null,
  root: Element,
): CanvasIntent | null {
  // Ctrl/Cmd belongs to undo, redo and the browser's own shortcuts.
  if (e.ctrlKey || e.metaKey) return null

  if (e.key === 'Escape') {
    // Escape backs OUT one level, and clears once there is nowhere further to
    // go. Pressing it repeatedly walks up the document and then lets go, which
    // is the behaviour every editor with a nested selection has taught people
    // to expect — and going up is what you want constantly, where clearing is
    // what you want once.
    if (!selected) return null
    const parent = parentSelectable(selected, root)
    return { action: 'select', el: parent }
  }
  if (!e.altKey) return null

  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      if (!selected) {
        // The way in. Without this a keyboard user has no first selection to
        // move from, and every other shortcut here is unreachable.
        const first = selectableChildren(root)[0]
        return first ? { action: 'select', el: first } : null
      }
      const family = siblingsOf(selected, root)
      const next = family[family.indexOf(selected) + (e.key === 'ArrowDown' ? 1 : -1)]
      return next ? { action: 'select', el: next } : null
    }
    case 'ArrowRight': {
      if (!selected) return null
      const child = selectableChildren(selected)[0]
      return child ? { action: 'select', el: child } : null
    }
    case 'ArrowLeft': {
      if (!selected) return null
      const parent = parentSelectable(selected, root)
      return parent ? { action: 'select', el: parent } : null
    }
    case 'Enter': {
      if (!selected) return null
      const kind = kindOf(selected)
      return kind && EXPRESSION_KINDS.has(kind)
        ? { action: 'editExpression', el: selected }
        : { action: 'placeCaret', el: selected }
    }
    case 'Delete':
    case 'Backspace':
      return selected ? { action: 'remove', el: selected } : null
    default:
      return null
  }
}

/** The shortcuts, in one place, so the hint in the UI and the documentation
 * cannot drift from what the code above actually does. */
export const CANVAS_SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'Alt + ↓ / ↑', does: 'select the next / previous element at this level' },
  { keys: 'Alt + →', does: 'select the first element inside this one' },
  { keys: 'Alt + ←', does: 'select the element around this one' },
  { keys: 'Alt + Enter', does: 'edit the selected element (its Jinja expression, or its text)' },
  { keys: 'Alt + Delete', does: 'remove the selected element' },
  { keys: 'Esc', does: 'step out to the element around this one; clear at the top' },
]
