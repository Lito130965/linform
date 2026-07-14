import { useEffect, useState } from 'react'
import { api, TemplateInfo } from '../api'

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
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    api.listTemplates().then(setTemplates).catch((e) => setError(e.message))
  }

  useEffect(reload, [])

  const create = async () => {
    setError(null)
    try {
      await api.createTemplate(code.trim(), name.trim() || code.trim())
      setCreating(false)
      setCode('')
      setName('')
      reload()
      onSelect(code.trim())
    } catch (e) {
      setError((e as Error).message)
    }
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
          <input
            placeholder="code (e.g. invoice)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="row">
            <button className="btn primary" onClick={create} disabled={!code.trim()}>
              Create
            </button>
            <button className="btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="btn new-template" onClick={() => setCreating(true)}>
          + New template
        </button>
      )}
      {error && <div className="error-box">{error}</div>}
    </div>
  )
}
