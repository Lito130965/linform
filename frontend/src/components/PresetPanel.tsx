import { PRESETS, PRESET_GROUPS, type Preset } from '../presets/registry'

/** The preset palette: grouped cards the author browses instead of facing an
 * empty {% %}. Clicking one inserts its Способ A markup — raw Jinja in Code,
 * protected in Visual — at the cursor / selection. Configuration dialogs and
 * context filtering arrive in later increments; here every preset inserts with
 * sensible defaults the author then edits. */
export default function PresetPanel({ onInsert }: { onInsert: (preset: Preset) => void }) {
  return (
    <div className="preset-panel">
      <label>Presets</label>
      {PRESET_GROUPS.map((group) => {
        const items = PRESETS.filter((p) => p.group === group)
        if (items.length === 0) return null
        return (
          <div key={group} className="preset-group">
            <div className="preset-group-name">{group}</div>
            <div className="preset-cards">
              {items.map((p) => (
                <button
                  key={p.id}
                  className="preset-card"
                  onClick={() => onInsert(p)}
                  title={p.description}
                >
                  <span className="preset-card-label">{p.label}</span>
                  <span className="preset-card-desc">{p.description}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
