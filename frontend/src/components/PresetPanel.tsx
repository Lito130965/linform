import { useState } from 'react'
import { detect } from '../jinja-bridge'
import { PRESETS, PRESET_GROUPS, type Preset } from '../presets/registry'
import { addCustom, loadCustom, removeCustom, toPreset } from '../presets/custom'

/** The preset palette: grouped cards the author browses instead of facing an
 * empty {% %}. Built-in presets first, then the author's own saved snippets in
 * a Custom group they can add to and delete from. Clicking a card opens the
 * config dialog (via onInsert); built-ins carry params, custom ones insert
 * their fixed source. */
export default function PresetPanel({ onInsert }: { onInsert: (preset: Preset) => void }) {
  const [custom, setCustom] = useState(loadCustom)
  const [adding, setAdding] = useState(false)

  const refresh = () => setCustom(loadCustom())

  return (
    <div className="preset-panel">
      <div className="preset-head">
        <label>Presets</label>
        <button className="btn small" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : '+ Add'}
        </button>
      </div>

      {adding && (
        <AddPresetForm
          onSaved={() => {
            refresh()
            setAdding(false)
          }}
        />
      )}

      {PRESET_GROUPS.map((group) => {
        const items = PRESETS.filter((p) => p.group === group)
        if (items.length === 0) return null
        return <Group key={group} name={group} presets={items} onInsert={onInsert} />
      })}

      {custom.length > 0 && (
        <Group
          name="Custom"
          presets={custom.map(toPreset)}
          onInsert={onInsert}
          onDelete={(id) => {
            removeCustom(id)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function Group({
  name,
  presets,
  onInsert,
  onDelete,
}: {
  name: string
  presets: Preset[]
  onInsert: (p: Preset) => void
  onDelete?: (id: string) => void
}) {
  return (
    <div className="preset-group">
      <div className="preset-group-name">{name}</div>
      <div className="preset-cards">
        {presets.map((p) => (
          <div key={p.id} className="preset-card-wrap">
            <button className="preset-card" onClick={() => onInsert(p)} title={p.description}>
              <span className="preset-card-label">{p.label}</span>
              <span className="preset-card-desc">{p.description}</span>
            </button>
            {onDelete && (
              <button className="preset-del" title="Delete preset" onClick={() => onDelete(p.id)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function AddPresetForm({ onSaved }: { onSaved: () => void }) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [source, setSource] = useState('')

  const check = source.trim() ? detect(source) : { supported: false, reasons: [] as string[] }
  const canSave = label.trim().length > 0 && source.trim().length > 0 && check.supported

  return (
    <div className="add-preset">
      <input
        placeholder="Name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        placeholder="Jinja snippet, e.g.  {% if paid %}<div>PAID</div>{% endif %}"
        spellCheck={false}
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      {source.trim() && !check.supported && (
        <div className="error-box small">
          Not representable visually: {check.reasons.join('; ') || 'empty'}
        </div>
      )}
      <div className="add-preset-actions">
        <button
          className="btn small primary"
          disabled={!canSave}
          onClick={() => {
            addCustom(label, description, source)
            onSaved()
          }}
        >
          Save preset
        </button>
      </div>
    </div>
  )
}
