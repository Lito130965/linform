import { useEffect, useState } from 'react'
import { diffLines, type Change } from 'diff'
import { api, VersionInfo } from '../api'

/** Version history drawer: metadata for every version plus a line diff of
 * any version against what is currently in the editor. */
export default function VersionHistory({
  code,
  versions,
  loadedVersion,
  editorHtml,
  overlay = false,
  onLoad,
  onPublish,
  onClose,
}: {
  code: string
  versions: VersionInfo[]
  loadedVersion: number | null
  editorHtml: string
  /** float over the workspace rather than take a column of its own */
  overlay?: boolean
  onLoad: (version: number) => void
  onPublish: (version: number) => void
  onClose: () => void
}) {
  const [diffWith, setDiffWith] = useState<number | null>(null)
  const [changes, setChanges] = useState<Change[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (diffWith === null) {
      setChanges(null)
      return
    }
    api
      .getVersion(code, diffWith)
      .then((v) => setChanges(diffLines(v.html_content, editorHtml)))
      .catch((e) => setError(e.message))
  }, [code, diffWith, editorHtml])

  return (
    <div className={overlay ? 'history-drawer overlay' : 'history-drawer'}>
      <div className="history-header">
        <strong>History — {code}</strong>
        <button className="btn small" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <div className="error-box small">{error}</div>}

      <ul className="history-list">
        {versions
          .slice()
          .reverse()
          .map((v) => (
            <li key={v.version} className={v.version === loadedVersion ? 'current' : ''}>
              <div className="history-row">
                <span className={`status-badge ${v.status}`}>v{v.version}</span>
                <span className="history-meta">
                  {new Date(v.created_at).toLocaleString()}
                  {v.created_by && ` · ${v.created_by}`}
                </span>
              </div>
              {v.comment && <div className="history-comment">{v.comment}</div>}
              <div className="history-actions">
                <button className="btn small" onClick={() => onLoad(v.version)}>
                  Open in editor
                </button>
                <button
                  className="btn small"
                  onClick={() => setDiffWith(diffWith === v.version ? null : v.version)}
                >
                  {diffWith === v.version ? 'Hide diff' : 'Diff vs editor'}
                </button>
                {v.status !== 'published' && (
                  <button className="btn small publish" onClick={() => onPublish(v.version)}>
                    Publish
                  </button>
                )}
              </div>
            </li>
          ))}
      </ul>

      {changes && (
        <div className="diff-view">
          <div className="muted" style={{ marginBottom: 6 }}>
            v{diffWith} → editor contents
          </div>
          <pre>
            {changes.map((part, i) => (
              <span
                key={i}
                className={part.added ? 'diff-add' : part.removed ? 'diff-del' : 'diff-same'}
              >
                {part.value}
              </span>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}
