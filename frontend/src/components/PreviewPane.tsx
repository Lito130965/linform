import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'

/**
 * Live preview: the template and its test data go through the real engine
 * into a real PDF, so page boundaries are the truth rather than a simulation.
 *
 * The page being looked at belongs to this component, not to the viewer.
 * Every render produces a new object URL, the iframe reloads, and the built-in
 * viewer starts again at page one — so with a 700 ms debounce, working on page
 * three of a document meant never seeing page three. The number is kept here
 * and put back in the URL fragment on every load, and the service says how
 * many pages there are so it can be held in range.
 */
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
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  // When the last render landed, so "is this what I just typed?" has an
  // answer that is not the reader's memory.
  const [renderedAt, setRenderedAt] = useState<number | null>(null)
  const [, setNow] = useState(0)
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
        const { blob, pages: counted } = await api.renderPreview(html, data, strict, ctrl.signal)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        const next = URL.createObjectURL(blob)
        urlRef.current = next
        setUrl(next)
        setPages(counted)
        // A document that got shorter while being edited must not leave the
        // reader pointing past its end.
        setPage((current) => Math.min(current, counted))
        setRenderedAt(Date.now())
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

  useEffect(() => {
    if (renderedAt === null) return
    const id = setInterval(() => setNow((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [renderedAt])

  const ago = renderedAt === null ? null : Math.round((Date.now() - renderedAt) / 1000)

  return (
    <div className="preview">
      <div className="preview-header">
        <span className="preview-title">Preview</span>
        {pages > 1 && (
          <span className="preview-pager">
            <button
              className="tb"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            <span className="muted">
              page {page} of {pages}
            </span>
            <button
              className="tb"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              ›
            </button>
          </span>
        )}
        <span className="muted preview-freshness">
          {rendering ? 'rendering…' : ago === null ? '' : `rendered ${ago}s ago`}
        </span>
        <label className="strict-toggle" title="Fail on missing placeholder values instead of rendering blanks">
          <input
            type="checkbox"
            aria-label="Strict placeholders"
            checked={strict}
            onChange={(e) => setStrict(e.target.checked)}
          />
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
        <iframe
          title="PDF preview"
          /* The fragment is re-applied on every load, which is what keeps the
             reader where they were. `toolbar=0` also removes the viewer's own
             page controls, which would otherwise be a second set beside
             these and 40 px of height. Chrome honours it; Firefox ignores it
             and shows its own — a tolerable difference, and not one to chase
             with a script inside a frame nobody controls. */
          src={`${url}#page=${page}&view=FitH&toolbar=0&navpanes=0`}
          className="preview-frame"
        />
      ) : (
        !error && <div className="empty-state">Preview appears after the first render</div>
      )}
    </div>
  )
}
