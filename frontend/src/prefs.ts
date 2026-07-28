/** Local, per-browser UI preferences. Deliberately client-side only — these
 * are view conveniences, not account settings, so they never hit the server. */

const NS = 'linform.pref.'

export function getBoolPref(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(NS + key)
  return v === null ? fallback : v === '1'
}

export function setBoolPref(key: string, value: boolean): void {
  localStorage.setItem(NS + key, value ? '1' : '0')
}

export const PREF_SHOW_CODES = 'journal.showCodes'
