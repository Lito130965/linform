/**
 * One language for the modifier keys.
 *
 * People arrive at this editor with habits from other tools, and those habits
 * are worth more than any convention we could invent: when Shift does what
 * Shift has always done, the program feels like it understands you, and when it
 * does something else, it feels like it is arguing.
 *
 *   Shift — keep the proportion, or the axis
 *   Alt   — ignore the snapping for as long as it is held
 *   Ctrl  — drag a copy instead of the thing itself
 *
 * Alt is the one place this departs from the usual reading. Elsewhere it often
 * means "resize from the centre"; here it suspends snapping, which is the
 * far more useful of the two in a document made of margins and alignments —
 * and snapping needs an escape hatch more than centring needs a shortcut.
 *
 * The arithmetic lives here, away from the drag handlers, so it can be checked
 * without a mouse.
 */

/** Resize while keeping the original proportion.
 *
 * The axis the hand moved furthest along wins: dragging mostly sideways means
 * the width is what was meant, and the height follows it. Deciding per drag
 * rather than per axis is what stops a corner drag from fighting the pointer.
 */
export function keepRatio(
  width: number,
  height: number,
  original: { width: number; height: number },
): { width: number; height: number } {
  if (original.width <= 0 || original.height <= 0) return { width, height }
  const ratio = original.width / original.height
  const grewWidth = Math.abs(width - original.width)
  const grewHeight = Math.abs(height - original.height)
  return grewWidth >= grewHeight
    ? { width, height: width / ratio }
    : { width: height * ratio, height }
}

/** Lock a movement to the axis it is mostly along. */
export function lockAxis(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy }
}

/** Ctrl on Windows and Linux, Command on a Mac — the same intent either way. */
export function isDuplicating(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey
}

/** The list shown in the canvas, so the hint and the behaviour come from one
 * place and cannot drift apart. */
export const CANVAS_MODIFIERS: { keys: string; does: string }[] = [
  { keys: 'Shift + drag', does: 'keep the proportion when resizing, or the axis when moving' },
  { keys: 'Alt + drag', does: 'ignore snapping for as long as it is held' },
  { keys: 'Ctrl + drag', does: 'drag a copy instead of the element itself' },
  { keys: 'Ctrl + wheel', does: 'zoom the page, as in any drawing tool' },
]
