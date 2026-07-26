/**
 * Read and set a keyword argument of a Jinja filter inside an expression.
 *
 * For qr/barcode colour: the symbol's colour is a filter argument, not CSS, so
 * changing it means editing `{{ order_id | qr }}` into
 * `{{ order_id | qr(dark='#c00') }}` and updating that key on later edits.
 * Values here are hex colours (no quotes inside), so single-quoting is safe.
 */

function filterRe(filter: string): RegExp {
  // `| filter` optionally followed by `( args )`. Whitespace is only consumed
  // in front of a real paren, so a bare `| qr ` keeps the space after it.
  return new RegExp(`\\|\\s*${filter}(?:\\s*\\(([^)]*)\\))?`)
}

export function getFilterArg(src: string, filter: string, key: string): string | null {
  const m = filterRe(filter).exec(src)
  if (!m) return null
  const args = m[1] ?? ''
  const arg = new RegExp(`\\b${key}\\s*=\\s*'([^']*)'`).exec(args)
  return arg ? arg[1] : null
}

export function setFilterArg(src: string, filter: string, key: string, value: string): string {
  const re = filterRe(filter)
  const m = re.exec(src)
  if (!m) return src
  let args = (m[1] ?? '').trim()
  const assign = `${key}='${value}'`
  const argRe = new RegExp(`\\b${key}\\s*=\\s*'[^']*'`)
  if (argRe.test(args)) args = args.replace(argRe, assign)
  else args = args ? `${args}, ${assign}` : assign
  return src.slice(0, m.index) + `| ${filter}(${args})` + src.slice(m.index + m[0].length)
}
