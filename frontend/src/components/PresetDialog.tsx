import { useId, useMemo, useState } from 'react'
import { detect } from '../jinja-bridge'
import { parseHints } from '../presets/hints'
import type { Preset } from '../presets/registry'
import Modal from './Modal'

/**
 * One dialog for every preset, driven by its param schema. It seeds each field
 * from the template's placeholders and the test data — an array param offers
 * the arrays found in the test JSON, a columns param offers the chosen array's
 * item fields as a checklist — so the author picks rather than recalls.
 *
 * Before inserting it runs detect() on the generated source and refuses,
 * with the reason, anything the bridge cannot represent: never a silent bad
 * insert: an unrepresentable construct is refused with its reason, never
 * accepted and quietly mangled.
 */
export default function PresetDialog({
  preset,
  placeholders,
  testData,
  onInsert,
  onClose,
}: {
  preset: Preset
  placeholders: string[]
  testData: string
  onInsert: (source: string) => void
  onClose: () => void
}) {
  const hints = useMemo(() => parseHints(testData), [testData])
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(preset.params.map((p) => [p.name, p.default])),
  )

  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }))

  const source = preset.generate(values)
  const check = detect(source)

  // Field candidates offered to placeholder inputs: test-data scalars first,
  // then names already used in the template.
  const fieldOptions = [...new Set([...hints.fields, ...placeholders])]
  // One id prefix per dialog instance, so each label points at its own input
  // even when two dialogs' params share a name.
  const idPrefix = useId()

  return (
    <Modal title={preset.label} onClose={onClose}>
        <p className="dialog-desc">{preset.description}</p>

        <div className="dialog-fields">
          {preset.params.map((p) => {
            if (p.kind === 'array') {
              return (
                <label key={p.name} className="dialog-field" htmlFor={`${idPrefix}-${p.name}`}>
                  {p.label}
                  <input
                    id={`${idPrefix}-${p.name}`}
                    list={`arr-${p.name}`}
                    value={values[p.name]}
                    onChange={(e) => set(p.name, e.target.value)}
                  />
                  <datalist id={`arr-${p.name}`}>
                    {hints.arrays.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                  </datalist>
                </label>
              )
            }
            if (p.kind === 'columns') {
              const chosen = p.fieldsFrom ? values[p.fieldsFrom] : ''
              const itemFields = hints.arrays.find((a) => a.name === chosen)?.itemFields ?? []
              const selected = new Set(
                values[p.name].split(',').map((s) => s.trim()).filter(Boolean),
              )
              const toggle = (f: string) => {
                const next = new Set(selected)
                if (next.has(f)) next.delete(f)
                            else next.add(f)
                set(p.name, [...next].join(', '))
              }
              return (
                <label key={p.name} className="dialog-field" htmlFor={`${idPrefix}-${p.name}`}>
                  {p.label}
                  {itemFields.length > 0 && (
                    <span className="dialog-checks">
                      {itemFields.map((f) => (
                        <button
                          key={f}
                          type="button"
                          className={selected.has(f) ? 'chip on' : 'chip'}
                          onClick={() => toggle(f)}
                        >
                          {f}
                        </button>
                      ))}
                    </span>
                  )}
                  <input
                    id={`${idPrefix}-${p.name}`}
                    value={values[p.name]}
                    onChange={(e) => set(p.name, e.target.value)}
                  />
                </label>
              )
            }
            const list = p.kind === 'placeholder' ? `ph-${p.name}` : undefined
            return (
              <label key={p.name} className="dialog-field" htmlFor={`${idPrefix}-${p.name}`}>
                {p.label}
                <input
                  id={`${idPrefix}-${p.name}`}
                  list={list}
                  type={p.kind === 'number' ? 'number' : 'text'}
                  value={values[p.name]}
                  onChange={(e) => set(p.name, e.target.value)}
                />
                {list && (
                  <datalist id={list}>
                    {fieldOptions.map((f) => (
                      <option key={f} value={f}>
                      {f}
                    </option>
                    ))}
                  </datalist>
                )}
              </label>
            )
          })}
        </div>

        <pre className="dialog-preview">{source}</pre>
        {!check.supported && (
          <div className="error-box small">Cannot insert: {check.reasons.join('; ')}</div>
        )}

        <div className="dialog-actions">
          <button className="btn small" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn small primary"
            disabled={!check.supported}
            onClick={() => {
              onInsert(source)
              onClose()
            }}
          >
            Insert
          </button>
        </div>
    </Modal>
  )
}
