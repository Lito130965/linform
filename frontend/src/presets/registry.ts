/**
 * Jinja preset registry — "Способ A": every preset expands into ordinary Jinja
 * source, the same markup the bridge already round-trips. There is no runtime
 * macro library and no hidden contract: Code mode shows exactly what executes,
 * and a preset's Visual form is simply `protect()` of its source.
 *
 * Presets are presentation only. Anything that is a data or business rule —
 * a total, a page number, a threshold like `if amount > 1000` — stays with the
 * consumer and is deliberately absent here (see the plan's exclusions).
 *
 * A generator returns Jinja SOURCE. The caller inserts it raw in Code mode, or
 * `protect()`-ed in Visual — which keeps the two forms provably identical.
 */

import type { NodeKind } from '../editor/selection'

export type PresetGroup = 'Tables' | 'Fields' | 'Sections' | 'Codes' | 'Custom'

export interface PresetParam {
  name: string
  label: string
  /** placeholder → offer known field names; array → offer arrays from test
   * data; columns → checklist of the chosen array's item fields (comma list);
   * text/number → free entry. */
  kind: 'placeholder' | 'array' | 'columns' | 'text' | 'number'
  default: string
  /** For a 'columns' param: which 'array' param supplies its field checklist. */
  fieldsFrom?: string
}

export interface Preset {
  id: string
  group: PresetGroup
  label: string
  description: string
  /** Selected-node kinds this preset can CONVERT; [] = insert-fresh only.
   * Used by the context detector in a later increment; palette shows all. */
  convertsFrom: NodeKind[]
  params: PresetParam[]
  /** params → Jinja source (Способ A). Missing params fall back to defaults. */
  generate: (params: Record<string, string>) => string
}

function withDefaults(preset: Preset, params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of preset.params) out[p.name] = (params[p.name] ?? '').trim() || p.default
  return out
}

/** A cell styled to look like a character box, never wrapping (the hard-won
 * lesson: inline-block cells wrap like words and a 12-cell id becomes 8+4). */
const CELL_STYLE =
  'display:inline-block;width:5mm;height:6mm;line-height:6mm;' +
  'border:1px solid #000;text-align:center;font-family:monospace;'

export const PRESETS: Preset[] = [
  {
    id: 'dynamic-table',
    group: 'Tables',
    label: 'Repeating table',
    description: 'A table whose body row repeats for each item of an array.',
    convertsFrom: ['row', 'table'],
    params: [
      { name: 'array', label: 'Array', kind: 'array', default: 'items' },
      { name: 'item', label: 'Item name', kind: 'text', default: 'item' },
      { name: 'columns', label: 'Columns', kind: 'columns', default: 'name, amount', fieldsFrom: 'array' },
    ],
    generate: (raw) => {
      const p = withDefaults(PRESETS[0], raw)
      const fields = p.columns.split(',').map((c) => c.trim()).filter(Boolean)
      const th = fields.map((f) => `<th>${f}</th>`).join('')
      const td = fields.map((f) => `<td>{{ ${p.item}.${f} }}</td>`).join('')
      return (
        '<table style="width:100%;border-collapse:collapse;">' +
        `<thead><tr>${th}</tr></thead>` +
        `<tbody>{% for ${p.item} in ${p.array} %}<tr>${td}</tr>{% endfor %}</tbody>` +
        '</table>'
      )
    },
  },
  {
    id: 'fill-rows',
    group: 'Tables',
    label: 'Pad empty rows',
    description: 'Add blank rows so a table always shows a fixed number of lines.',
    convertsFrom: ['row', 'table'],
    params: [
      { name: 'array', label: 'Array', kind: 'array', default: 'items' },
      { name: 'total', label: 'Total rows', kind: 'number', default: '10' },
      { name: 'columns', label: 'Column count', kind: 'number', default: '2' },
    ],
    generate: (raw) => {
      const p = withDefaults(PRESETS[1], raw)
      const cols = Math.max(1, parseInt(p.columns, 10) || 1)
      const td = '<td>&nbsp;</td>'.repeat(cols)
      return `{% for _ in range(${p.array}|length, ${p.total}) %}<tr>${td}</tr>{% endfor %}`
    },
  },
  {
    id: 'char-cells',
    group: 'Fields',
    label: 'Character cells',
    description: 'One box per character of a value — for government form combs.',
    convertsFrom: ['chip', 'cell', 'block'],
    params: [{ name: 'value', label: 'Value', kind: 'placeholder', default: 'number' }],
    generate: (raw) => {
      const p = withDefaults(PRESETS[2], raw)
      return (
        '<span style="white-space:nowrap;">' +
        `{% for ch in ${p.value} %}<span style="${CELL_STYLE}">{{ ch }}</span>{% endfor %}` +
        '</span>'
      )
    },
  },
  {
    id: 'present-if',
    group: 'Fields',
    label: 'Value or dash',
    description: 'Show the value when present, an em dash when empty.',
    convertsFrom: ['chip', 'cell'],
    params: [{ name: 'value', label: 'Value', kind: 'placeholder', default: 'amount' }],
    generate: (raw) => {
      const p = withDefaults(PRESETS[3], raw)
      return `{{ ${p.value} if ${p.value} else '—' }}`
    },
  },
  {
    id: 'checkbox',
    group: 'Fields',
    label: 'Checkbox ☑ / ☐',
    description: 'A filled or empty checkbox driven by a true/false field.',
    convertsFrom: ['chip', 'cell'],
    params: [{ name: 'condition', label: 'Condition', kind: 'placeholder', default: 'agreed' }],
    generate: (raw) => {
      const p = withDefaults(PRESETS[4], raw)
      return `{{ '☑' if ${p.condition} else '☐' }}`
    },
  },
  {
    id: 'conditional',
    group: 'Sections',
    label: 'Show if present',
    description: 'A block that appears only when a field has a value.',
    convertsFrom: ['block'],
    params: [{ name: 'condition', label: 'Condition', kind: 'placeholder', default: 'note' }],
    generate: (raw) => {
      const p = withDefaults(PRESETS[5], raw)
      return `{% if ${p.condition} %}<div>{{ ${p.condition} }}</div>{% endif %}`
    },
  },
  {
    id: 'qr',
    group: 'Codes',
    label: 'QR code',
    description: 'A scannable QR built from a value (drawn by the server).',
    convertsFrom: [],
    params: [
      { name: 'value', label: 'Value', kind: 'placeholder', default: 'order_id' },
      { name: 'size', label: 'Size (mm)', kind: 'number', default: '25' },
    ],
    generate: (raw) => {
      const p = withDefaults(PRESETS[6], raw)
      return `<img src="{{ ${p.value} | qr }}" style="width:${p.size}mm">`
    },
  },
  {
    id: 'barcode',
    group: 'Codes',
    label: 'Barcode',
    description: 'A Code128 barcode from a value, with the digits underneath.',
    convertsFrom: [],
    params: [
      { name: 'value', label: 'Value', kind: 'placeholder', default: 'tracking' },
      { name: 'size', label: 'Width (mm)', kind: 'number', default: '60' },
    ],
    generate: (raw) => {
      const p = withDefaults(PRESETS[7], raw)
      return `<img src="{{ ${p.value} | barcode('code128', text=True) }}" style="width:${p.size}mm">`
    },
  },
]

export const PRESET_GROUPS: PresetGroup[] = ['Tables', 'Fields', 'Sections', 'Codes']
