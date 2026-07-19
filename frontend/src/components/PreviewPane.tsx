import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'

/** Live preview: the template + test data are rendered by the real engine
 * into a real PDF, so page boundaries are the truth, not a simulation. */
export default function PreviewPane({
  html,
  data,
  onError,
  fixWithAi,
}: {
  html: string
  data: Record<string, unknown> | null
  onError?: (error: string | null) => void
  fixWithAi?: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  // Lenient by default: missing placeholders render as blanks so the analyst
  // always sees the layout; strict mode surfaces them as errors on demand.
  const [strict, setStrict] = useState(false)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (data === null || !html.trim()) return // keep the last good preview
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setRendering(true)
      try {
        const blob = await api.renderPreview(html, data, strict, ctrl.signal)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        const next = URL.createObjectURL(blob)
        urlRef.current = next
        setUrl(next)
        setError(null)
        onError?.(null)
      } catch (e) {
        if (e instanceof ApiError) {
          setError(e.message)
          onError?.(e.message)
        } else if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError((e as Error).message)
          onError?.((e as Error).message)
        }
      } finally {
        setRendering(false)
      }
    }, 700)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [html, data, strict])

  return (
    <div className="preview">
      <div className="preview-header">
        <span>Preview{rendering ? ' — rendering…' : ''}</span>
        <label className="strict-toggle" title="Fail on missing placeholder values instead of rendering blanks">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
          strict placeholders
        </label>
      </div>
      {error && (
        <div className="error-box">
          {error}
          {fixWithAi && (
            <button className="btn small fix-ai" onClick={fixWithAi}>
              ✨ Fix with AI
            </button>
          )}
        </div>
      )}
      {url ? (
        <iframe title="PDF preview" src={url} className="preview-frame" />
      ) : (
        !error && <div className="empty-state">Preview appears after the first render</div>
      )}
    </div>
  )
}
