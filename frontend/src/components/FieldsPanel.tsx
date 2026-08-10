import { useEffect, useState } from 'react'
import { api } from '../api'
import { fieldRows, type FieldRow, type LoopScope } from '../editor/fields'

/**
 * The values this document can name — from the test data and from the template
 * itself — with the ones that cannot be written where the caret is greyed and
 * told why.
 *
 * Click puts the field where you are. That sentence is the whole point of the
 * panel and it was not true before: insertion landed after the selected block,
 * so a field could never go inside a line of text (see editor/range-ops.ts).
 */
export default function FieldsPanel({
  html,
  testData,
  scopes,
  onInsert,
}: {
  html: string
  /** The editor's test JSON — the nearest thing to a schema this service has. */
  testData: string
  /** Loops in force where the caret is; empty in Code mode. */
  scopes: LoopScope[]
  onInsert: (expression: string) => void
}) {
  const [placeholders, setPlaceholders] = useState<string[]>([])

  // Extracted server-side so the parsing matches the engine that will render.
  useEffect(() => {
    if (!html.trim()) {
      setPlaceholders([])
      return
    }
    const t = setTimeout(() => {
      api
        .placeholders(html)
        .then((r) => setPlaceholders(r.placeholders))
        .catch(() => setPlaceholders([]))
    }, 1000)
    return () => clearTimeout(t)
  }, [html])

  const rows = fieldRows(testData, placeholders, scopes)

  return (
    <div className="fields-panel">
      <h2 className="panel-heading">
        Fields
        <span className="muted"> — click to place one where the caret is</span>
      </h2>
      {rows.length === 0 ? (
        <p className="muted">
          Nothing to offer yet. Put a sample payload in <strong>Test data</strong> and its keys
          appear here as fields.
        </p>
      ) : (
        <ul className="field-list">
          {rows.map((row) => (
            <FieldItem key={`${row.label}:${row.depth}`} row={row} onInsert={onInsert} />
          ))}
        </ul>
      )}
    </div>
  )
}

const SOURCE_NOTE: Record<FieldRow['source'], string> = {
  both: 'in the template and in the test data',
  data: 'in the test data, not yet used in the template',
  template: 'used in the template, missing from the test data',
}

function FieldItem({ row, onInsert }: { row: FieldRow; onInsert: (e: string) => void }) {
  const style = { paddingLeft: 4 + row.depth * 14 }

  // A heading for a group, and for an array a heading that says what would make
  // its fields usable — the answer to "why is items[].price greyed out".
  if (row.expression === null) {
    const note =
      row.kind === 'array'
        ? row.needs
          ? `repeat a row over ${row.needs} to use these`
          : 'in scope here'
        : row.kind === 'value'
          ? row.needs
            ? `inside a repeat over ${row.needs}`
            : 'not a name a template can write'
          : ''
    return (
      <li className="field-item is-group" style={style}>
        <span className="field-label">{row.label}</span>
        <span className="field-note">{note}</span>
      </li>
    )
  }

  return (
    <li className={`field-item source-${row.source}`} style={style}>
      <button
        className="field-row"
        title={`Insert {{ ${row.expression} }} — ${SOURCE_NOTE[row.source]}`}
        onClick={() => onInsert(row.expression!)}
      >
        <span className="field-label">{row.label}</span>
        {row.sample !== undefined && <span className="field-sample">{row.sample}</span>}
        {row.source === 'template' && (
          <span className="field-flag" title="No sample value — the preview cannot show it">
            no sample
          </span>
        )}
      </button>
    </li>
  )
}
