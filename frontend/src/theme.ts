/**
 * Colour theme.
 *
 * Three states, not two: "system" is the default and follows the OS, and the
 * two explicit choices exist because the system preference is often wrong for
 * this particular tool — a dark editor around a white sheet is uncomfortable
 * for exactly the work it is for.
 *
 * The choice is written to <html data-theme>, which the stylesheet reads; that
 * keeps every colour in one place (CSS variables) rather than threading a theme
 * object through the component tree.
 */

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'linform.pref.theme'

export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function setTheme(theme: Theme): void {
  if (theme === 'system') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, theme)
  applyTheme(theme)
}

/** Write (or clear) the attribute the stylesheet keys off. */
export function applyTheme(theme: Theme = getTheme()): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
