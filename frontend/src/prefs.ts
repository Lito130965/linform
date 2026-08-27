/** Local, per-browser UI preferences. Deliberately client-side only — these
 * are view conveniences, not account settings, so they never hit the server.
 *
 * Numbers and strings sit beside the booleans because the editor's layout is
 * measured in pixels and named in tabs: a column width that resets on every
 * document is not a preference, it is a suggestion the editor ignores. Reading
 * always falls back rather than throwing — storage can be full, disabled, or
 * hold something written by an older version of this file, and none of those
 * are reasons to fail to draw an editor.
 */

const NS = 'linform.pref.'

function read(key: string): string | null {
  try {
    return localStorage.getItem(NS + key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(NS + key, value)
  } catch {
    // A private window with storage denied, or a quota that is full. The
    // editor works without remembering; it must not stop working over it.
  }
}

export function getBoolPref(key: string, fallback: boolean): boolean {
  const v = read(key)
  return v === null ? fallback : v === '1'
}

export function setBoolPref(key: string, value: boolean): void {
  write(key, value ? '1' : '0')
}

/** A stored number, clamped to the range the caller can actually use.
 *
 * Clamping on the way out rather than trusting what was stored: the bounds
 * belong to this version of the layout, and a width written when the rules were
 * different must not be able to produce a column nobody can see. */
export function getNumPref(key: string, fallback: number, min: number, max: number): number {
  const raw = read(key)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  // Zero is not a width, it is "collapsed", and it is deliberately outside the
  // clamp so a panel can be put away and come back the size it was.
  if (value === 0) return 0
  return Math.min(max, Math.max(min, value))
}

export function setNumPref(key: string, value: number): void {
  write(key, String(Math.round(value)))
}

/** A stored string, accepted only when it is still one of the allowed ones.
 *
 * A tab name that no longer exists — a panel renamed between versions — would
 * otherwise leave the editor opening on nothing. */
export function getStringPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const raw = read(key)
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

export function setStringPref(key: string, value: string): void {
  write(key, value)
}

export const PREF_SHOW_CODES = 'journal.showCodes'

/** The editor's layout, remembered per browser. Widths are CSS pixels; zero
 * means the panel is collapsed to its strip. */
export const PREF_PREVIEW_WIDTH = 'editor.previewWidth'
export const PREF_INSPECTOR_WIDTH = 'editor.inspectorWidth'
export const PREF_PREVIEW_OPEN = 'editor.previewOpen'
export const PREF_INSPECTOR_OPEN = 'editor.inspectorOpen'
export const PREF_INSPECTOR_TAB = 'editor.inspectorTab'
export const PREF_TOOL_TAB = 'editor.toolTab'
