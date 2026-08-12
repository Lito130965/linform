import { useState } from 'react'
import Modal from '../components/Modal'
import type { FieldRow } from './fields'

/**
 * Editing the Jinja an element carries.
 *
 * It was a `window.prompt`. A prompt cannot say what the expression is for,
 * cannot offer the fields this document has, cannot be styled to match anything
 * around it, and on a second screen opens wherever the browser feels like. It
 * is also the one dialog a person cannot resize when the expression is longer
 * than the box.
 *
 * The three kinds are genuinely different sentences, so each is introduced as
 * what it is rather than all three as "Jinja expression".
 */

const ABOUT: Record<string, { title: string; hint: string; example: string }> = {
  'data-jinja-expr': {
    title: 'Field',
    hint: 'A value to print here. Written between {{ and }} in the template.',
    example: 'customer.name',
  },
  'data-jinja-for': {
    title: 'Repeat',
    hint: 'This element is repeated once for each item of a list.',
    example: 'row in items',
  },
  'data-jinja-if': {
    title: 'Condition',
    hint: 'This element appears only when the condition is true.',
    example: 'notes',
  },
}

export default function ExpressionDialog({
  attr,
  value,
  fields,
  onSave,
  onClose,
}: {
  attr: string
  value: string
  /** What this document can name, to save typing and typos. */
  fields: FieldRow[]
  onSave: (expression: string) => void
  onClose: () => void
}) {
  const about = ABOUT[attr] ?? ABOUT['data-jinja-expr']
  const [draft, setDraft] = useState(value)
  const usable = fields.filter((f) => f.expression).slice(0, 40)

  const save = () => {
    if (draft.trim()) onSave(draft.trim())
    onClose()
  }

  return (
    <Modal title={about.title} onClose={onClose} className="expr-dialog">
      <p className="muted">{about.hint}</p>
      <label className="prop expr-input">
        <span className="expr-braces">{attr === 'data-jinja-expr' ? '{{' : '{%'}</span>
        <input
          aria-label={`${about.title} expression`}
          value={draft}
          placeholder={about.example}
          spellCheck={false}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
        />
        <span className="expr-braces">{attr === 'data-jinja-expr' ? '}}' : '%}'}</span>
      </label>

      {usable.length > 0 && (
        <div className="expr-fields">
          <span className="cc-label">Fields in this document</span>
          <div className="expr-chips">
            {usable.map((field) => (
              <button
                key={field.label}
                className="chip"
                title={`Use ${field.expression}`}
                onClick={() => setDraft(field.expression!)}
              >
                {field.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={!draft.trim()}>
          Apply
        </button>
      </div>
    </Modal>
  )
}
