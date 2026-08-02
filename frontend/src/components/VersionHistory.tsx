import { useEffect, useState } from 'react'
import { diffLines, type Change } from 'diff'
import { api, type DraftInfo, type VersionInfo } from '../api'

/**
 * The template's journal: working copies above, published history below.
 *
 * They are shown apart because they are different kinds of thing. A draft is
 * unfinished work — no number, editable, deletable, and unreachable by any
 * consuming application. A published version is numbered and frozen; exactly
 * one of them is *current*, and pointing that at an older one is the rollback.
 */
export default function VersionHistory({
  code,
  versions,
  drafts,
  currentVersion,
  openDraftId,
  openVersion,
  editorHtml,
  overlay = false,
  onOpenVersion,
  onOpenDraft,
  onMakeCurrent,
  onDeleteDraft,
  onClose,
}: {
  code: string
  versions: VersionInfo[]
  drafts: DraftInfo[]
  currentVersion: number | null
  openDraftId: number | null
  openVersion: number | null
  editorHtml: string
  /** float over the workspace rather than take a column of its own */
  overlay?: boolean
  onOpenVersion: (version: number) => void
  onOpenDraft: (draftId: number) => void
  onMakeCurrent: (version: number) => void
  onDeleteDraft: (draftId: number) => void
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

      <h3 className="history-section">Drafts</h3>
      {drafts.length === 0 ? (
        <p className="muted history-empty">
          No drafts. Editing a published version and saving starts one.
        </p>
      ) : (
        <ul className="history-list">
          {drafts.map((d) => (
            <li key={d.id} className={d.id === openDraftId ? 'current' : ''}>
              <div className="history-row">
                <span className="status-badge draft">draft</span>
                <span className="history-meta">
                  {new Date(d.created_at).toLocaleString()}
                  {d.created_by && ` · ${d.created_by}`}
                </span>
              </div>
              {d.comment && <div className="history-comment">{d.comment}</div>}
              <div className="history-actions">
                <button className="btn small" onClick={() => onOpenDraft(d.id)}>
                  Open in editor
                </button>
                <button className="btn small danger" onClick={() => onDeleteDraft(d.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="history-section">Published versions</h3>
      {versions.length === 0 ? (
        <p className="muted history-empty">
          Nothing published yet, so consuming applications cannot render this template.
        </p>
      ) : (
        <ul className="history-list">
          {versions.map((v) => (
            <li key={v.version} className={v.version === openVersion ? 'current' : ''}>
              <div className="history-row">
                <span className={`status-badge ${v.status}`}>v{v.version}</span>
                {v.version === currentVersion && (
                  <span className="status-badge published" title="Consumers get this one">
                    current
                  </span>
                )}
                <span className="history-meta">
                  {new Date(v.created_at).toLocaleString()}
                  {v.created_by && ` · ${v.created_by}`}
                </span>
              </div>
              {v.comment && <div className="history-comment">{v.comment}</div>}
              <div className="history-actions">
                <button className="btn small" onClick={() => onOpenVersion(v.version)}>
                  Open in editor
                </button>
                <button
                  className="btn small"
                  onClick={() => setDiffWith(diffWith === v.version ? null : v.version)}
                >
                  {diffWith === v.version ? 'Hide diff' : 'Diff vs editor'}
                </button>
                {v.version !== currentVersion && (
                  <button
                    className="btn small publish"
                    onClick={() => onMakeCurrent(v.version)}
                    title="Point consuming applications at this version"
                  >
                    Make current
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

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
