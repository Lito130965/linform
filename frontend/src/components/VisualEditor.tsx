import { useEffect, useRef } from 'react'
import grapesjs, { type Editor as GrapesEditor } from 'grapesjs'
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
    })
    registerJinjaComponents(editor)

    const exportBody = () => editor.getHtml({ cleanId: true })

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
