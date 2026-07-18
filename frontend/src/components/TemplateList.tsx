import { useEffect, useRef, useState } from 'react'
import { api, TemplateInfo } from '../api'
import { importDocxFile, suggestCodeFromFilename } from '../docx/import'

interface PendingImport {
  filename: string
  html: string
  warnings: string[]
}

export default function TemplateList({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (code: string) => void
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = () => {
    api.listTemplates().then(setTemplates).catch((e) => setError(e.message))
  }

  useEffect(reload, [])

  const create = async () => {
    setError(null)
    try {
      const trimmedCode = code.trim()
      await api.createTemplate(trimmedCode, name.trim() || trimmedCode)
      if (pendingImport) {
        await api.saveVersion(
          trimmedCode,
          pendingImport.html,
          `Imported from ${pendingImport.filename}`,
        )
      }
      setCreating(false)
      setCode('')
      setName('')
      setPendingImport(null)
      reload()
      onSelect(trimmedCode)
    } catch (e) {
      setError((e as Error).message)
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

  return (
    <div className="template-list">
      <ul>
        {templates.map((t) => (
          <li key={t.code}>
            <button
              className={selected === t.code ? 'template-item active' : 'template-item'}
              onClick={() => onSelect(t.code)}
            >
              <span className="template-name">{t.name}</span>
              <span className="template-code">{t.code}</span>
            </button>
          </li>
        ))}
      </ul>

      {creating ? (
        <div className="create-form">
          {pendingImport && (
            <div className="import-badge" title={pendingImport.filename}>
              from {pendingImport.filename}
            </div>
          )}
          <input
            placeholder="code (e.g. invoice)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
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
      ) : (
        <>
          <button className="btn new-template" onClick={() => setCreating(true)}>
            + New template
          </button>
          <button
            className="btn new-template"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            title="Convert a Word document into a template (mammoth.js), then place the placeholders"
          >
            {importing ? 'Importing…' : '+ New from .docx'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) startImport(f)
            }}
          />
        </>
      )}
      {error && <div className="error-box">{error}</div>}
    </div>
  )
}
