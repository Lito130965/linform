import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'

/** Live preview: the template + test data are rendered by the real engine
 * into a real PDF, so page boundaries are the truth, not a simulation. */
export default function PreviewPane({
  html,
  data,
}: {
  html: string
  data: Record<string, unknown> | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (data === null || !html.trim()) return // keep the last good preview
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setRendering(true)
      try {
        const blob = await api.renderPreview(html, data, ctrl.signal)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        const next = URL.createObjectURL(blob)
        urlRef.current = next
        setUrl(next)
        setError(null)
      } catch (e) {
        if (e instanceof ApiError) setError(e.message)
        else if (!(e instanceof DOMException && e.name === 'AbortError'))
          setError((e as Error).message)
      } finally {
        setRendering(false)
      }
    }, 700)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [html, data])

  return (
    <div className="preview">
      <div className="preview-header">
        <span>Preview{rendering ? ' — rendering…' : ''}</span>
        <span className="muted">real PDF pages, exactly what consumers get</span>
      </div>
      {error && <div className="error-box">{error}</div>}
      {url ? (
        <iframe title="PDF preview" src={url} className="preview-frame" />
      ) : (
        !error && <div className="empty-state">Preview appears after the first render</div>
      )}
    </div>
  )
}
