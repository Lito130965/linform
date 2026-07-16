import { useEffect, useRef } from 'react'
import grapesjs, { type Component, type Editor as GrapesEditor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import { unwrapBody } from '../jinja-bridge'

/** Canvas-only affordances for Jinja constructs: visible, but pure CSS —
 * nothing here can leak into the exported HTML. */
const CANVAS_AFFORDANCE_CSS = `
  body { background: #fff; margin: 8px; }
  [data-jinja-expr] {
    background: rgba(79, 140, 255, 0.14);
    border: 1px solid rgba(79, 140, 255, 0.45);
    border-radius: 3px;
    padding: 0 2px;
    white-space: nowrap;
  }
  [data-jinja-for] { outline: 1px dashed rgba(79, 140, 255, 0.65); outline-offset: 1px; }
  [data-jinja-if] { outline: 1px dashed rgba(63, 178, 111, 0.7); outline-offset: 1px; }
`

function registerJinjaComponents(editor: GrapesEditor) {
  const dc = editor.DomComponents

  dc.addType('jinja-expr', {
    isComponent: (el) =>
      el.nodeType === 1 && (el as HTMLElement).hasAttribute('data-jinja-expr')
        ? { type: 'jinja-expr' }
        : undefined,
    model: {
      defaults: {
        name: 'Placeholder',
        editable: false,
        droppable: false,
        traits: [{ name: 'data-jinja-expr', label: 'Expression' }],
      },
    },
    view: {
      events: () => ({ dblclick: 'editExpression' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editExpression(this: any) {
        const current = this.model.getAttributes()['data-jinja-expr'] ?? ''
        const next = window.prompt('Jinja expression', current)
        if (next && next.trim()) {
          const expr = next.trim()
          this.model.addAttributes({ 'data-jinja-expr': expr })
          this.model.components(`{{ ${expr} }}`)
        }
      },
    },
  })

  dc.addType('jinja-for', {
    isComponent: (el) =>
      el.nodeType === 1 && (el as HTMLElement).hasAttribute('data-jinja-for')
        ? { type: 'jinja-for' }
        : undefined,
    model: {
      defaults: {
        name: 'Repeating (for)',
        traits: [{ name: 'data-jinja-for', label: 'Repeat for (Jinja)' }],
      },
    },
  })

  dc.addType('jinja-if', {
    isComponent: (el) =>
      el.nodeType === 1 && (el as HTMLElement).hasAttribute('data-jinja-if')
        ? { type: 'jinja-if' }
        : undefined,
    model: {
      defaults: {
        name: 'Conditional (if)',
        traits: [{ name: 'data-jinja-if', label: 'Show if (Jinja)' }],
      },
    },
  })
}

/** Table tools GrapesJS lacks out of the box: add/remove rows and columns
 * from the toolbar of any selected cell, plus a width-resize handle. */
function registerTableTools(editor: GrapesEditor) {
  const selectedCell = (): Component | null => {
    const sel = editor.getSelected()
    return sel && sel.is('cell') ? sel : null
  }

  const eachRow = (cell: Component): { rows: Component[]; colIndex: number } => {
    const table = cell.closest('table')
    const rows: Component[] = table ? (table.find('tr') as Component[]) : []
    return { rows, colIndex: cell.index() }
  }

  editor.Commands.add('table:add-row', () => {
    const cell = selectedCell()
    if (!cell) return
    const row = cell.parent()
    if (!row) return
    const cols = row.components().length
    row.parent()?.append(`<tr>${'<td> </td>'.repeat(cols)}</tr>`, { at: row.index() + 1 })
  })

  editor.Commands.add('table:del-row', () => {
    const cell = selectedCell()
    cell?.parent()?.remove()
  })

  editor.Commands.add('table:add-col', () => {
    const cell = selectedCell()
    if (!cell) return
    const { rows, colIndex } = eachRow(cell)
    for (const row of rows) {
      const isHead = row.closest('thead') != null
      row.append(isHead ? '<th> </th>' : '<td> </td>', { at: colIndex + 1 })
    }
  })

  editor.Commands.add('table:del-col', () => {
    const cell = selectedCell()
    if (!cell) return
    const { rows, colIndex } = eachRow(cell)
    for (const row of rows) {
      const target = row.components().at(colIndex)
      target?.remove()
    }
  })

  editor.on('component:selected', (comp?: Component) => {
    if (!comp || !comp.is('cell')) return
    const toolbar = (comp.get('toolbar') ?? []) as { command?: string }[]
    if (toolbar.some((t) => t.command === 'table:add-col')) return
    // GrapesJS type declarations lag behind its runtime API here.
    const set = comp.set.bind(comp) as (key: string, value: unknown) => void
    set('toolbar', [
      ...toolbar,
      { command: 'table:add-col', label: '+C' },
      { command: 'table:del-col', label: '−C' },
      { command: 'table:add-row', label: '+R' },
      { command: 'table:del-row', label: '−R' },
    ])
    // Drag handle on the right edge: writes width into the inline style.
    set('resizable', { tl: 0, tc: 0, tr: 0, cl: 0, cr: 1, bl: 0, bc: 0, br: 0 })
  })
}

const BLOCKS = [
  { id: 'text', label: 'Text', category: 'Basic', content: '<p>Text</p>' },
  { id: 'heading', label: 'Heading', category: 'Basic', content: '<h2>Heading</h2>' },
  {
    id: 'table',
    label: 'Table',
    category: 'Basic',
    content:
      '<table style="width: 100%; border-collapse: collapse;">' +
      '<thead><tr><th>Column</th><th>Column</th></tr></thead>' +
      '<tbody><tr><td>Value</td><td>Value</td></tr></tbody></table>',
  },
  { id: 'image', label: 'Image', category: 'Basic', content: { type: 'image' } },
  { id: 'divider', label: 'Divider', category: 'Basic', content: '<hr>' },
  {
    id: 'columns-2',
    label: '2 columns',
    category: 'Layout',
    content:
      '<div style="display: flex; gap: 8px;">' +
      '<div style="flex: 1; min-height: 24px;">Left</div>' +
      '<div style="flex: 1; min-height: 24px;">Right</div></div>',
  },
  {
    id: 'columns-3',
    label: '3 columns',
    category: 'Layout',
    content:
      '<div style="display: flex; gap: 8px;">' +
      '<div style="flex: 1; min-height: 24px;">One</div>' +
      '<div style="flex: 1; min-height: 24px;">Two</div>' +
      '<div style="flex: 1; min-height: 24px;">Three</div></div>',
  },
  {
    id: 'page-break',
    label: 'Page break',
    category: 'Print',
    content: '<div style="page-break-after: always;"></div>',
  },
]

export default function VisualEditor({
  initialBody,
  canvasStyles,
  onChange,
  onReady,
}: {
  /** protected body HTML with canvas asset URLs */
  initialBody: string
  /** CSS text from the template's <style> blocks, injected read-only */
  canvasStyles: string
  /** fires (debounced) with the current protected body HTML */
  onChange: (bodyHtml: string) => void
  onReady?: (editor: GrapesEditor) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbacksRef = useRef({ onChange, onReady })
  callbacksRef.current = { onChange, onReady }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const editor = grapesjs.init({
      container,
      height: '100%',
      storageManager: false,
      components: initialBody,
      blockManager: { blocks: BLOCKS },
      canvas: { styles: [] },
      // Style Manager edits must live inside the exported HTML (we discard
      // the editor's separate CSS on purpose — it would rewrite template
      // CSS and drop @page). Inline styles survive the round-trip and PDF.
      avoidInlineStyle: false,
    })
    registerJinjaComponents(editor)
    registerTableTools(editor)

    // Page-level styling belongs to the template's own markup (Code mode);
    // a styled wrapper would not survive the export.
    editor.getWrapper()?.set({ selectable: false, hoverable: false, stylable: false })

    const exportBody = () => unwrapBody(editor.getHtml({ cleanId: true }))

    let loaded = false
    let timer: ReturnType<typeof setTimeout> | undefined
    editor.on('load', () => {
      const doc = editor.Canvas.getDocument()
      const styleEl = doc.createElement('style')
      styleEl.textContent = canvasStyles + CANVAS_AFFORDANCE_CSS
      doc.head.appendChild(styleEl)
      loaded = true
      callbacksRef.current.onReady?.(editor)
    })
    editor.on('update', () => {
      if (!loaded) return
      clearTimeout(timer)
      timer = setTimeout(() => callbacksRef.current.onChange(exportBody()), 300)
    })

    return () => {
      clearTimeout(timer)
      if (loaded) callbacksRef.current.onChange(exportBody())
      editor.destroy()
    }
    // The editor is mounted once per template/version — parent remounts via key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="visual-editor" ref={containerRef} />
}
