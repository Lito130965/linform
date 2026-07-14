import { useEffect, useState } from 'react'
import { api } from '../api'

/** Placeholders the current template expects; click one to insert it at the
 * cursor. Extracted server-side so the parsing matches the real engine. */
export default function PlaceholderPanel({
  html,
  onInsert,
}: {
  html: string
  onInsert: (name: string) => void
}) {
  const [placeholders, setPlaceholders] = useState<string[]>([])

  useEffect(() => {
    if (!html.trim()) {
      setPlaceholders([])
      return
    }
    const t = setTimeout(() => {
      api
        .placeholders(html)
        .then((r) => setPlaceholders(r.placeholders))
        .catch(() => setPlaceholders([]))
    }, 1000)
    return () => clearTimeout(t)
  }, [html])

  return (
    <div className="placeholder-panel">
      <label>Placeholders</label>
      <div className="chips">
        {placeholders.length === 0 && <span className="muted">none detected</span>}
        {placeholders.map((p) => (
          <button key={p} className="chip" onClick={() => onInsert(p)} title="Insert at cursor">
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
