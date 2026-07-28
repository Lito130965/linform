import { useEffect, useState } from 'react'
import { api, ApiError, type ExampleMeta } from '../api'
import type { ScratchDoc } from './Editor'

/** The examples gallery: a grid of showcase cards. Opening one loads it into
 * the normal editor as a scratch document — editable and renderable like any
 * template, but it never persists. */
export default function ExamplesGallery({ onOpen }: { onOpen: (doc: ScratchDoc) => void }) {
  const [items, setItems] = useState<ExampleMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    api
      .listExamples()
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
  }, [])

  async function open(id: string) {
    setOpening(id)
    setError(null)
    try {
      const ex = await api.getExample(id)
      onOpen({ id: ex.id, title: ex.title, html: ex.html, data: JSON.stringify(ex.data, null, 2) })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="gallery">
      <header className="gallery-head">
        <h1>Examples</h1>
        <p className="muted">
          Open any example to explore it in the editor. Changes render live but are never saved —
          reload to get the pristine example back.
        </p>
      </header>
      {error && <div className="error-box">{error}</div>}
      <div className="gallery-grid">
        {items.map((ex) => (
          <button
            key={ex.id}
            className="example-card"
            onClick={() => open(ex.id)}
            disabled={opening !== null}
          >
            <div className="example-title">{ex.title}</div>
            <div className="example-desc">{ex.description}</div>
            <div className="example-tags">
              {ex.tags.map((t) => (
                <span key={t} className="example-tag">
                  {t}
                </span>
              ))}
            </div>
            {opening === ex.id && <div className="example-opening">Opening…</div>}
          </button>
        ))}
      </div>
    </div>
  )
}
