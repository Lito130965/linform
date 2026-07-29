import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type DirectoryInfo, type TemplateInfo } from '../api'
import { importDocxFile, suggestCodeFromFilename } from '../docx/import'
import { getBoolPref, PREF_SHOW_CODES } from '../prefs'

/** The template journal: a left rail of directory buckets and, on the right,
 * the templates in the chosen bucket. A template with no directory lives in the
 * pinned "General" bucket (directory_id === null). Backend still addresses
 * templates by code; buckets are organizational. */

// Which bucket is in view: everything, the uncategorized "General", or a real id.
type Bucket = 'all' | 'general' | number

interface PendingImport {
  filename: string
  html: string
  warnings: string[]
}

export default function TemplateJournal({ onOpen }: { onOpen: (code: string) => void }) {
  const [dirs, setDirs] = useState<DirectoryInfo[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [bucket, setBucket] = useState<Bucket>('all')
  const [error, setError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const showCodes = getBoolPref(PREF_SHOW_CODES, true)
  const report = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e))

  const reload = () => {
    Promise.all([api.listDirectories(), api.listTemplates()])
      .then(([d, t]) => {
        setDirs(d)
        setTemplates(t)
      })
      .catch(report)
  }
  useEffect(reload, [])

  const generalCount = templates.filter((t) => t.directory_id === null).length
  const inBucket =
    bucket === 'all'
      ? templates
      : bucket === 'general'
        ? templates.filter((t) => t.directory_id === null)
        : templates.filter((t) => t.directory_id === bucket)

  // A new template is filed into the bucket in view (General/all → uncategorized).
  const targetDir = typeof bucket === 'number' ? bucket : null

  const create = async () => {
    setError(null)
    try {
      const c = code.trim()
      await api.createTemplate(c, name.trim() || c, targetDir)
      if (pendingImport) {
        await api.saveVersion(c, pendingImport.html, `Imported from ${pendingImport.filename}`)
      }
      cancelCreate()
      reload()
      onOpen(c)
    } catch (e) {
      report(e)
    }
  }

  const startImport = async (file: File) => {
    setImporting(true)
    setError(null)
    try {
      const result = await importDocxFile(file)
      setPendingImport({ filename: file.name, html: result.html, warnings: result.warnings })
      setCode(suggestCodeFromFilename(file.name))
      setName(file.name.replace(/\.[^.]+$/, ''))
      setCreating(true)
    } catch (e) {
      setError(`Could not read ${file.name}: ${(e as Error).message}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const cancelCreate = () => {
    setCreating(false)
    setPendingImport(null)
    setCode('')
    setName('')
  }

  const newDirectory = async () => {
    const nm = window.prompt('New directory name:')
    if (!nm || !nm.trim()) return
    try {
      const d = await api.createDirectory(nm.trim())
      reload()
      setBucket(d.id)
    } catch (e) {
      report(e)
    }
  }

  const renameDir = async (d: DirectoryInfo) => {
    const nm = window.prompt(`Rename "${d.name}" to:`, d.name)
    if (!nm || !nm.trim() || nm.trim() === d.name) return
    try {
      await api.renameDirectory(d.id, nm.trim())
      reload()
    } catch (e) {
      report(e)
    }
  }

  const deleteDir = async (d: DirectoryInfo) => {
    if (!window.confirm(`Delete "${d.name}"? Its templates move to General; nothing is deleted.`)) return
    try {
      await api.deleteDirectory(d.id)
      if (bucket === d.id) setBucket('all')
      reload()
    } catch (e) {
      report(e)
    }
  }

  const move = async (t: TemplateInfo, value: string) => {
    const dirId = value === 'general' ? null : Number(value)
    try {
      await api.moveTemplate(t.code, dirId)
      reload()
    } catch (e) {
      report(e)
    }
  }

  const bucketTitle =
    bucket === 'all' ? 'All templates' : bucket === 'general' ? 'General' : dirs.find((d) => d.id === bucket)?.name

  return (
    <div className="journal">
      <aside className="journal-dirs">
        <button className="btn small primary full" onClick={newDirectory}>
          + New directory
        </button>
        <ul>
          <li>
            <button
              className={bucket === 'all' ? 'bucket active' : 'bucket'}
              onClick={() => setBucket('all')}
            >
              <span>All templates</span>
              <span className="bucket-count">{templates.length}</span>
            </button>
          </li>
          <li>
            <button
              className={bucket === 'general' ? 'bucket active' : 'bucket'}
              onClick={() => setBucket('general')}
            >
              <span>General</span>
              <span className="bucket-count">{generalCount}</span>
            </button>
          </li>
          {dirs.map((d) => (
            <li key={d.id} className="bucket-row">
              <button
                className={bucket === d.id ? 'bucket active' : 'bucket'}
                onClick={() => setBucket(d.id)}
              >
                <span>{d.name}</span>
                <span className="bucket-count">{d.template_count}</span>
              </button>
              <span className="bucket-actions">
                <button className="icon-btn" title="Rename" onClick={() => renameDir(d)}>
                  ✎
                </button>
                <button className="icon-btn" title="Delete" onClick={() => deleteDir(d)}>
                  🗑
                </button>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <section className="journal-main">
        <header className="journal-head">
          <h2>{bucketTitle}</h2>
          <div className="journal-actions">
            <button className="btn primary" onClick={() => setCreating(true)}>
              + New template
            </button>
            <button
              className="btn"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              title="Convert a Word document into a template"
            >
              {importing ? 'Importing…' : '+ New from .docx'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              aria-label="Choose a Word document to import"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) startImport(f)
              }}
            />
          </div>
        </header>

        {error && <div className="error-box">{error}</div>}

        {creating && (
          <div className="create-form inline">
            {pendingImport && <div className="import-badge">from {pendingImport.filename}</div>}
            <input
              placeholder="code (e.g. invoice)"
              aria-label="Template code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <input
              placeholder="Display name"
              aria-label="Template display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <span className="muted">→ {targetDir === null ? 'General' : bucketTitle}</span>
            {pendingImport && pendingImport.warnings.length > 0 && (
              <div className="error-box small">
                Conversion warnings:{'\n'}
                {pendingImport.warnings.slice(0, 5).join('\n')}
              </div>
            )}
            <div className="row">
              <button className="btn primary" onClick={create} disabled={!code.trim()}>
                Create
              </button>
              <button className="btn" onClick={cancelCreate}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {inBucket.length === 0 ? (
          <div className="journal-empty">No templates here yet.</div>
        ) : (
          <table className="journal-table">
            <thead>
              <tr>
                <th>Name</th>
                {showCodes && <th>Code</th>}
                <th>Directory</th>
              </tr>
            </thead>
            <tbody>
              {inBucket.map((t) => (
                <tr key={t.code}>
                  <td>
                    <button className="link-btn" onClick={() => onOpen(t.code)}>
                      {t.name}
                    </button>
                  </td>
                  {showCodes && (
                    <td>
                      <code>{t.code}</code>
                    </td>
                  )}
                  <td>
                    <select
                      value={t.directory_id === null ? 'general' : String(t.directory_id)}
                      onChange={(e) => move(t, e.target.value)}
                      title="Move to another directory"
                    >
                      <option value="general">General</option>
                      {dirs.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
