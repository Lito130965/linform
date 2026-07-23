/** Undo/redo as snapshots of the exported body.
 *
 * The decision (recorded from the plan's 1.7): snapshots, not a command
 * stack. Templates measure 5–25KB, so a hundred steps is a couple of
 * megabytes at worst; a snapshot is trivially correct under ANY mutation —
 * including contenteditable typing, which is exactly where command stacks
 * spring leaks — and coalescing keystrokes falls out of the caller's
 * debounce for free. A command stack earns its complexity on megabyte
 * documents, which print forms never are.
 *
 * Snapshots hold CLEAN markup (exportBody output, no canvas affordances):
 * the caller re-prepares the body after a restore. That keeps history
 * byte-comparable and free of selection litter.
 */

const MAX_DEPTH = 100

export class SnapshotHistory {
  private past: string[] = []
  private future: string[] = []

  constructor(initial: string) {
    this.past.push(initial)
  }

  /** Record a new state; a no-op when nothing changed since the last one. */
  commit(snapshot: string): void {
    if (snapshot === this.past[this.past.length - 1]) return
    this.past.push(snapshot)
    if (this.past.length > MAX_DEPTH) this.past.shift()
    // A new edit invalidates the redo branch, as everywhere else.
    this.future = []
  }

  get canUndo(): boolean {
    return this.past.length > 1
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Step back; returns the snapshot to restore, or null at the bottom. */
  undo(): string | null {
    if (!this.canUndo) return null
    this.future.push(this.past.pop()!)
    return this.past[this.past.length - 1]
  }

  /** Step forward; returns the snapshot to restore, or null at the top. */
  redo(): string | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(next)
    return next
  }
}
