import { useEffect, useRef } from 'react'
import grapesjs, { type Component, type Editor as GrapesEditor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'

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

/** GrapesJS holds every style (including inline styles parsed from block
 * content) in its own CSS registry, which the mode switch deliberately
 * discards — it would rewrite template CSS and drop @page. So the export
 * inlines the editor's CSS back onto the elements: what you see in the
 * canvas is exactly what reaches the HTML, the PDF and the round-trip. */
function exportInlinedBody(editor: GrapesEditor): string {
  const rawHtml = editor.getHtml() // ids kept: the CSS selectors need them
  const css = editor.getCss({ avoidProtected: true }) ?? ''
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html')

  if (css.trim()) {
    const styleEl = doc.createElement('style')
    styleEl.textContent = css
    doc.head.appendChild(styleEl)
    const sheet = styleEl.sheet
    if (sheet) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type !== CSSRule.STYLE_RULE) continue // media/device rules are not print
        const styleRule = rule as CSSStyleRule
        if (styleRule.selectorText.includes('*')) continue // editor-internal resets
        let matched: NodeListOf<Element>
        try {
          matched = doc.querySelectorAll(styleRule.selectorText)
        } catch {
          continue
        }
        matched.forEach((el) => {
          const target = (el as HTMLElement).style
          for (let i = 0; i < styleRule.style.length; i++) {
            const prop = styleRule.style[i]
            target.setProperty(
              prop,
              styleRule.style.getPropertyValue(prop),
              styleRule.style.getPropertyPriority(prop),
            )
          }
        })
      }
    }
    styleEl.remove()
  }

  // Auto-generated ids existed only for the editor's own selectors; ids the
  // template author set (present in component attributes) are kept.
  const authoredIds = new Set<string>()
  const generatedIds = new Set<string>()
  const walk = (c: Component) => {
    const attrId = (c.get('attributes') as Record<string, unknown> | undefined)?.id
    if (attrId) authoredIds.add(String(attrId))
    else generatedIds.add(c.getId())
    c.components().forEach(walk)
  }
  const wrapper = editor.getWrapper()
  if (wrapper) walk(wrapper)
  doc.body.querySelectorAll('[id]').forEach((el) => {
    if (generatedIds.has(el.id) && !authoredIds.has(el.id)) el.removeAttribute('id')
  })

  // doc.body is GrapesJS's exported wrapper — taking innerHTML unwraps it.
  return doc.body.innerHTML
}

const tagOf = (c: Component | undefined | null): string =>
  ((c?.get('tagName') as string) ?? '').toLowerCase()
const isCell = (c: Component | undefined | null): boolean => tagOf(c) === 'td' || tagOf(c) === 'th'

/** Walk up from any component to the nearest ancestor matching a predicate. */
function ancestor(c: Component | null, pred: (x: Component) => boolean): Component | null {
  let n: Component | null | undefined = c
  while (n) {
    if (pred(n)) return n
    n = n.parent() ?? null
  }
  return null
}

/** Table tools GrapesJS lacks out of the box. Commands resolve the cell by
 * walking up from whatever is selected — clicking a cell often selects the
 * text component inside it, not the <td> — so they work either way, and are
 * exposed both on the cell toolbar and as always-available top-panel buttons. */
function registerTableTools(editor: GrapesEditor) {
  const cellOf = (): Component | null => {
    const sel = editor.getSelected()
    return sel ? ancestor(sel, isCell) : null
  }
  const rowsOf = (cell: Component): Component[] => {
    const table = ancestor(cell, (c) => tagOf(c) === 'table')
    return table ? (table.find('tr') as Component[]) : []
  }

  editor.Commands.add('table:add-row', () => {
    const cell = cellOf()
    const row = cell && ancestor(cell, (c) => tagOf(c) === 'tr')
    if (!row) return
    const cols = Math.max(row.components().length, 1)
    row.parent()?.append(`<tr>${'<td> </td>'.repeat(cols)}</tr>`, { at: row.index() + 1 })
  })

  editor.Commands.add('table:del-row', () => {
    const cell = cellOf()
    const row = cell && ancestor(cell, (c) => tagOf(c) === 'tr')
    row?.remove()
  })

  editor.Commands.add('table:add-col', () => {
    const cell = cellOf()
    if (!cell) return
    const colIndex = cell.index()
    for (const row of rowsOf(cell)) {
      const isHead = ancestor(row, (c) => tagOf(c) === 'thead') != null
      row.append(isHead ? '<th> </th>' : '<td> </td>', { at: colIndex + 1 })
    }
  })

  editor.Commands.add('table:del-col', () => {
    const cell = cellOf()
    if (!cell) return
    const colIndex = cell.index()
    for (const row of rowsOf(cell)) row.components().at(colIndex)?.remove()
  })

  // Cells are a first-class type: their toolbar and width-resize handle come
  // from the type defaults, not a mutation on selection.
  editor.DomComponents.addType('cell', {
    isComponent: (el) =>
      el.tagName === 'TD' || el.tagName === 'TH' ? { type: 'cell' } : undefined,
    model: {
      defaults: {
        toolbar: [
          { attributes: { title: 'Add column' }, command: 'table:add-col', label: '+C' },
          { attributes: { title: 'Remove column' }, command: 'table:del-col', label: '−C' },
          { attributes: { title: 'Add row' }, command: 'table:add-row', label: '+R' },
          { attributes: { title: 'Remove row' }, command: 'table:del-row', label: '−R' },
        ],
        resizable: { tl: 0, tc: 0, tr: 0, cl: 0, cr: 1, bl: 0, bc: 0, br: 0 },
      },
    },
  })

  // Always-available fallback: table buttons in the top options panel act on
  // whichever table contains the current selection.
  const panel = editor.Panels
  panel.addButton('options', { id: 'tbl-add-col', command: 'table:add-col', label: '+Col', attributes: { title: 'Table: add column' } })
  panel.addButton('options', { id: 'tbl-del-col', command: 'table:del-col', label: '−Col', attributes: { title: 'Table: remove column' } })
  panel.addButton('options', { id: 'tbl-add-row', command: 'table:add-row', label: '+Row', attributes: { title: 'Table: add row' } })
  panel.addButton('options', { id: 'tbl-del-row', command: 'table:del-row', label: '−Row', attributes: { title: 'Table: remove row' } })
}

/** Paper formats at 96dpi (portrait widths). The canvas width is a hint —
 * the PDF preview remains the truth about pages — but matching widths make
 * wrapping in the canvas realistic. */
const PAGE_FORMATS = [
  { id: 'A4', name: 'A4', width: '794px', widthMedia: '' },
  { id: 'A4 landscape', name: 'A4 landscape', width: '1123px', widthMedia: '' },
  { id: 'A5', name: 'A5', width: '559px', widthMedia: '' },
  { id: 'A5 landscape', name: 'A5 landscape', width: '794px', widthMedia: '' },
  { id: 'A3', name: 'A3', width: '1123px', widthMedia: '' },
  { id: 'Letter', name: 'Letter', width: '816px', widthMedia: '' },
  { id: 'Free', name: 'Free width', width: '', widthMedia: '' },
]

/** Pick the initial canvas format from the template's own @page rule. */
function formatFromStyles(styles: string): string {
  const m = /size\s*:\s*(a3|a4|a5|letter)\s*(landscape)?/i.exec(styles)
  if (!m) return 'A4'
  const base = m[1].length === 2 ? m[1].toUpperCase() : 'Letter'
  const candidate = m[2] ? `${base} landscape` : base
  return PAGE_FORMATS.some((f) => f.id === candidate) ? candidate : 'A4'
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
    // Explicit widths (not flex:1) so resizing one column never rebalances
    // the other — each keeps whatever width you give it.
    content:
      '<div style="display: flex;">' +
      '<div style="width: 50%; flex-shrink: 0; min-height: 24px;">Left</div>' +
      '<div style="width: 50%; flex-shrink: 0; min-height: 24px;">Right</div></div>',
  },
  {
    id: 'columns-3',
    label: '3 columns',
    category: 'Layout',
    content:
      '<div style="display: flex;">' +
      '<div style="width: 33.33%; flex-shrink: 0; min-height: 24px;">One</div>' +
      '<div style="width: 33.33%; flex-shrink: 0; min-height: 24px;">Two</div>' +
      '<div style="width: 33.33%; flex-shrink: 0; min-height: 24px;">Three</div></div>',
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
      deviceManager: { devices: PAGE_FORMATS },
    })
    registerJinjaComponents(editor)
    registerTableTools(editor)
    editor.setDevice(formatFromStyles(canvasStyles))

    // Page-level styling belongs to the template's own markup (Code mode);
    // a styled wrapper would not survive the export.
    editor.getWrapper()?.set({ selectable: false, hoverable: false, stylable: false })

    const exportBody = () => exportInlinedBody(editor)

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
