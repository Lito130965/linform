import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { cleanPastedHtml } from '../docx/clean-paste'
import { fitZoom } from '../layout'
import { BLOCKS } from './blocks'
import { exportBody, prepareBody, prepareFragment } from './export-body'
import { SnapshotHistory } from './history'
import {
  CANVAS_AFFORDANCE_CSS,
  CANVAS_GUTTER_PX,
  PAGE_FORMATS,
  formatFromStyles,
} from './page'
import { KIND_LABEL, NodeKind, findSelectable, kindOf, parentSelectable } from './selection'
import ColorControl from './ColorControl'
import { type Colour, parse as parseColour, toCss, toHex } from './color'
import { getFilterArg, setFilterArg } from './filter-args'
import { parseMarginBoxes, parsePageBox, runningAffordanceCss } from './furniture'
import {
  BorderMode,
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  setColumnWidth,
  setRowHeight,
  setTableBorders,
} from './table-ops'
import { type Layer, layerOf, setLayer } from './layer'
import { existingValue, isConditional, isRepeating, makeRepeating, wrapConditional } from './convert'
import { protect } from '../jinja-bridge'
import { PRESETS } from '../presets/registry'
import { setAlign, toggleInline } from './text-commands'

/** What the shell (Editor.tsx) may ask of the canvas. */
export interface CanvasEditorApi {
  /** Insert markup at the selection (after the selected node) or append. */
  insertHtml: (html: string) => void
  /** Current canvas-form body (protected markup, canvas asset URLs). */
  getBody: () => string
}

/**
 * The custom visual editor: the DOM in the iframe IS the document model.
 *
 * The template body (already protect()-ed by the shell) is written into an
 * iframe as-is; the author's CSS is injected read-only next to the canvas
 * affordance CSS; text is edited through contenteditable; structure through
 * toolbar commands on the selected node. Export is innerHTML minus exactly
 * the affordances we added (export-body.ts) — no model, no re-serialization,
 * which is the whole reason this editor exists.
 *
 * Undo/redo is snapshot-based (see history.ts for why): every settled burst
 * of mutations commits one clean snapshot; restoring one rewrites the body
 * and re-applies the canvas affordances.
 */
export default function CanvasEditor({
  initialBody,
  canvasStyles,
  onChange,
  onReady,
  arrayHints = [],
}: {
  /** protected body HTML with canvas asset URLs */
  initialBody: string
  /** CSS text from the template's <style> blocks, injected read-only */
  canvasStyles: string
  /** fires (debounced) with the current canvas-form body HTML */
  onChange: (bodyHtml: string) => void
  onReady?: (api: CanvasEditorApi) => void
  /** array names from the editor's test data, to suggest in convert dialogs */
  arrayHints?: string[]
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLElement | null>(null)
  const historyRef = useRef<SnapshotHistory | null>(null)
  const restoringRef = useRef(false)
  const callbacksRef = useRef({ onChange, onReady })
  callbacksRef.current = { onChange, onReady }

  const [format, setFormat] = useState(() => formatFromStyles(canvasStyles))
  const [zoom, setZoom] = useState(1)
  const [frameHeight, setFrameHeight] = useState(400)
  const [selected, setSelected] = useState<{ el: Element; kind: NodeKind } | null>(null)
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false })
  // Bumped on any mutation so the toolbar re-measures its position.
  const [, setTick] = useState(0)
  // Bumped on each new selection so the props inputs re-seed from that element.
  const [selId, setSelId] = useState(0)
  const [convert, setConvert] = useState<
    { type: 'repeat' | 'if' | 'cells'; value: string; item: string } | null
  >(null)
  // An active drag. While set, a transparent overlay covers the stage so the
  // iframe never swallows mousemove/mouseup — the bug where a resize kept
  // following the cursor after the button was released.
  const [drag, setDrag] = useState<{
    onMove: (e: MouseEvent) => void
    cursor: string
    onEnd?: () => void
  } | null>(null)
  // Live drop target while dragging a block to reorder it.
  const [moveDrop, setMoveDrop] = useState<{ el: Element; where: 'before' | 'after' } | null>(null)
  const dropRef = useRef<{ el: Element; where: 'before' | 'after' } | null>(null)

  const pageWidth = useMemo(
    () => PAGE_FORMATS.find((f) => f.id === format)?.width ?? null,
    [format],
  )
  // The @page margin boxes the browser cannot render: shown as strips.
  const furniture = useMemo(() => parseMarginBoxes(canvasStyles), [canvasStyles])
  // Page geometry so a page-background image can bleed past the margins.
  const pageBox = useMemo(() => parsePageBox(canvasStyles), [canvasStyles])

  const select = (el: Element | null) => {
    const body = bodyRef.current
    if (!body) return
    for (const prev of Array.from(body.querySelectorAll('[data-lf-selected]'))) {
      prev.removeAttribute('data-lf-selected')
    }
    if (el && el.isConnected) {
      el.setAttribute('data-lf-selected', '')
      setSelected({ el, kind: kindOf(el)! })
    } else {
      setSelected(null)
    }
    setSelId((n) => n + 1)
    setConvert(null)
  }

  const refreshHistState = () => {
    const h = historyRef.current
    if (h) setHistState({ canUndo: h.canUndo, canRedo: h.canRedo })
  }

  const restoreSnapshot = (snapshot: string | null) => {
    const body = bodyRef.current
    if (snapshot === null || !body) return
    restoringRef.current = true
    body.innerHTML = snapshot
    prepareBody(body)
    setSelected(null)
    callbacksRef.current.onChange(snapshot)
    refreshHistState()
    // Let the observer flush the burst before listening again.
    queueMicrotask(() => {
      restoringRef.current = false
    })
  }

  const undo = () => restoreSnapshot(historyRef.current?.undo() ?? null)
  const redo = () => restoreSnapshot(historyRef.current?.redo() ?? null)

  // ---- mount the document once -------------------------------------------
  useEffect(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!iframe || !doc) return

    doc.open()
    doc.write('<!doctype html><html><head></head><body></body></html>')
    doc.close()

    const style = doc.createElement('style')
    // Author CSS first, affordances second, so selection outlines win. The
    // running-element badges come from the author's own @page rules: a footer
    // parked at the top of <body> must read as a footer, not as stray text.
    style.textContent = canvasStyles + CANVAS_AFFORDANCE_CSS + runningAffordanceCss(canvasStyles)
    doc.head.appendChild(style)

    const body = doc.body
    body.innerHTML = initialBody
    prepareBody(body)
    bodyRef.current = body
    historyRef.current = new SnapshotHistory(exportBody(body))

    // Selection: nearest structural node under the click; body click clears.
    const onClick = (e: MouseEvent) => {
      select(findSelectable(e.target as Element, body))
    }
    doc.addEventListener('click', onClick)

    // Double-click a chip / loop / conditional to edit its Jinja expression as
    // text. The attribute is the source of truth restore() reads; the visible
    // chip label is kept in sync for placeholders.
    const onDblClick = (e: MouseEvent) => {
      const el = findSelectable(e.target as Element, body)
      if (!el) return
      const attr = el.hasAttribute('data-jinja-expr')
        ? 'data-jinja-expr'
        : el.hasAttribute('data-jinja-for')
          ? 'data-jinja-for'
          : el.hasAttribute('data-jinja-if')
            ? 'data-jinja-if'
            : null
      if (!attr) return
      e.preventDefault()
      const current = el.getAttribute(attr) ?? ''
      const next = doc.defaultView?.prompt('Jinja expression', current)
      if (next === null || next === undefined) return
      const expr = next.trim()
      if (!expr) return
      el.setAttribute(attr, expr)
      if (attr === 'data-jinja-expr') el.textContent = `{{ ${expr} }}`
    }
    doc.addEventListener('dblclick', onDblClick)

    // Undo/redo shortcuts; native contenteditable history is unreliable after
    // programmatic mutations, so ours replaces it entirely.
    const onKeydown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    doc.addEventListener('keydown', onKeydown)

    // Paste from Word / Google Docs arrives as mso-soup; replace it with
    // allowlisted structural markup before it can reach the document.
    const onPaste = (e: ClipboardEvent) => {
      const html = e.clipboardData?.getData('text/html')
      if (!html) return
      e.preventDefault()
      const cleaned = cleanPastedHtml(html)
      if (!cleaned) return
      const sel = doc.getSelection()
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const holder = doc.createElement('div')
        holder.innerHTML = cleaned
        const frag = doc.createDocumentFragment()
        while (holder.firstChild) frag.appendChild(holder.firstChild)
        range.insertNode(frag)
        sel.collapseToEnd()
      } else {
        body.insertAdjacentHTML('beforeend', cleaned)
      }
    }
    doc.addEventListener('paste', onPaste)

    // Content height drives the iframe height (the outer pane scrolls).
    const measure = () => setFrameHeight(Math.max(doc.documentElement.scrollHeight, 200))
    measure()

    // Any settled burst of DOM changes: re-measure, reposition the toolbar,
    // commit one history snapshot, ship one export.
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      measure()
      setTick((t) => t + 1)
      if (restoringRef.current) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const snapshot = exportBody(body)
        historyRef.current?.commit(snapshot)
        refreshHistState()
        callbacksRef.current.onChange(snapshot)
      }, 300)
    })
    observer.observe(body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })

    callbacksRef.current.onReady?.({
      insertHtml: (html: string) => {
        const target = body.querySelector('[data-lf-selected]')
        const holder = doc.createElement('div')
        holder.innerHTML = html
        const nodes = Array.from(holder.children)
        for (const node of nodes) prepareFragment(node)
        if (target) {
          for (const node of nodes.reverse()) target.after(node)
        } else {
          for (const node of nodes) body.appendChild(node)
        }
        // Plain text (no element) — append as text at the end.
        if (nodes.length === 0 && holder.textContent) {
          body.appendChild(doc.createTextNode(holder.textContent))
        }
      },
      getBody: () => exportBody(body),
    })

    return () => {
      clearTimeout(timer)
      observer.disconnect()
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('dblclick', onDblClick)
      doc.removeEventListener('keydown', onKeydown)
      doc.removeEventListener('paste', onPaste)
      // Flush the final state so mode switches never lose an edit.
      callbacksRef.current.onChange(exportBody(body))
      bodyRef.current = null
      historyRef.current = null
    }
    // Mounted once per template/version — the parent remounts via key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- fit the page into the available width -----------------------------
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const fit = () => {
      if (pageWidth === null) {
        setZoom(1)
        return
      }
      setZoom(fitZoom(scroll.clientWidth - CANVAS_GUTTER_PX, pageWidth) / 100)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(scroll)
    return () => ro.disconnect()
  }, [pageWidth])

  // ---- commands -----------------------------------------------------------
  const withDoc = (fn: (doc: Document) => void) => {
    const doc = iframeRef.current?.contentDocument
    if (doc) fn(doc)
  }

  // Inline style read/write on the selected element — the only channel that
  // survives export while the author's <style> stays read-only. Setting a
  // property mutates the DOM, which the observer picks up for history/export.
  const styleValue = (prop: string): string =>
    selected ? (selected.el as HTMLElement).style.getPropertyValue(prop) : ''

  const applyStyle = (prop: string, value: string): void => {
    if (!selected) return
    const s = (selected.el as HTMLElement).style
    if (value.trim()) s.setProperty(prop, value.trim())
    else s.removeProperty(prop)
    setTick((t) => t + 1)
  }

  // A qr/barcode image carries its colour as filter arguments on data-lf-src,
  // not as CSS — so the two palettes edit the filter call there instead.
  const lfSrc = selected ? ((selected.el as HTMLElement).getAttribute('data-lf-src') ?? '') : ''
  const codeFilter = /\|\s*qr\b/.test(lfSrc) ? 'qr' : /\|\s*barcode\b/.test(lfSrc) ? 'barcode' : null
  const codeKeys =
    codeFilter === 'qr'
      ? { fg: 'dark', bg: 'light' }
      : { fg: 'foreground', bg: 'background' }

  const applyCodeColour = (key: string, c: Colour): void => {
    if (!selected || !codeFilter) return
    const next = setFilterArg(lfSrc, codeFilter, key, toHex(c))
    ;(selected.el as HTMLElement).setAttribute('data-lf-src', next)
    setTick((t) => t + 1)
  }

  const codeColour = (key: string, fallback: string): Colour =>
    parseColour((codeFilter && getFilterArg(lfSrc, codeFilter, key)) || fallback)

  // Width/height mean the column and row when a table cell is selected, so a
  // resize grows the whole column, not one lopsided cell.
  const isCell = selected?.kind === 'cell'
  const applyWidth = (v: string): void => {
    if (isCell && selected) {
      setColumnWidth(selected.el, v)
      setTick((t) => t + 1)
    } else applyStyle('width', v)
  }
  const applyHeight = (v: string): void => {
    if (isCell && selected) {
      setRowHeight(selected.el, v)
      setTick((t) => t + 1)
    } else applyStyle('height', v)
  }

  const applyLayer = (layer: Layer): void => {
    if (!selected) return
    setLayer(selected.el as HTMLElement, layer, pageBox)
    setTick((t) => t + 1)
  }
  const imageInCell = selected?.kind === 'image' && !!selected.el.closest('td, th')

  // Convert-existing: which transforms apply to the current selection, and a
  // small form to collect their one or two parameters.
  const canRepeat =
    !!selected && ['row', 'block'].includes(selected.kind) && !isRepeating(selected.el)
  const canCondition =
    !!selected && selected.kind === 'block' && !isConditional(selected.el)
  const canSplit = !!selected && ['cell', 'chip'].includes(selected.kind)

  const applyConvert = (): void => {
    if (!selected || !convert) return
    const el = selected.el
    if (convert.type === 'repeat') {
      makeRepeating(el, convert.item || 'item', convert.value || 'items')
    } else if (convert.type === 'if') {
      wrapConditional(el, convert.value || 'flag')
    } else if (convert.type === 'cells') {
      const gen = PRESETS.find((p) => p.id === 'char-cells')!.generate
      const target = el.matches('td, th') ? el : el.closest('td, th') ?? el
      target.innerHTML = protect(gen({ value: convert.value || 'value' }))
      prepareFragment(target)
    }
    setTick((t) => t + 1)
    setConvert(null)
  }

  const insertBlock = (id: string) => {
    const block = BLOCKS.find((b) => b.id === id)
    const body = bodyRef.current
    const doc = iframeRef.current?.contentDocument
    if (!block || !body || !doc) return
    const holder = doc.createElement('div')
    holder.innerHTML = block.content
    const nodes = Array.from(holder.children)
    if (nodes.length === 0) return
    for (const node of nodes) prepareFragment(node)
    const target = selected?.el.isConnected ? selected.el : null
    // Insert all top-level nodes (header/footer carry a <style> plus the div).
    if (target) for (const node of [...nodes].reverse()) target.after(node)
    else for (const node of nodes) body.appendChild(node)
    // Select the last visible node so the author can edit it immediately.
    select(nodes[nodes.length - 1])
  }

  const moveSelected = (dir: -1 | 1) => {
    if (!selected) return
    const el = selected.el
    const sibling = dir === -1 ? el.previousElementSibling : el.nextElementSibling
    if (!sibling) return
    if (dir === -1) sibling.before(el)
    else sibling.after(el)
    setTick((t) => t + 1)
  }

  const removeSelected = () => {
    if (!selected || !bodyRef.current) return
    const next = parentSelectable(selected.el, bodyRef.current)
    selected.el.remove()
    select(next)
  }

  const duplicateSelected = () => {
    if (!selected) return
    const copy = selected.el.cloneNode(true) as Element
    copy.removeAttribute('data-lf-selected')
    selected.el.after(copy)
  }

  const tableOp = (op: (el: Element) => unknown) => {
    if (!selected) return
    op(selected.el)
    setTick((t) => t + 1)
  }

  const inTable = selected ? !!selected.el.closest('table') : false

  // Toolbar position in stage coordinates (iframe has no internal scroll).
  let toolbarPos: { left: number; top: number } | null = null
  if (selected && selected.el.isConnected) {
    const rect = (selected.el as HTMLElement).getBoundingClientRect()
    toolbarPos = {
      left: Math.max(0, rect.left * zoom),
      top: Math.max(0, rect.top * zoom - 30),
    }
  } else if (selected && !selected.el.isConnected) {
    // The node was removed by an edit (e.g. an undo or a retype around it).
    queueMicrotask(() => setSelected(null))
  }

  // Selected cell rect in stage coordinates, for the column/row drag handles.
  const cellRect =
    isCell && selected?.el.isConnected
      ? (selected.el as HTMLElement).getBoundingClientRect()
      : null
  const imgRect =
    selected?.kind === 'image' && selected.el.isConnected
      ? (selected.el as HTMLElement).getBoundingClientRect()
      : null

  const startColResize = (e: ReactMouseEvent) => {
    if (!selected) return
    e.preventDefault()
    const startX = e.clientX
    const startW = (selected.el as HTMLElement).offsetWidth
    setDrag({
      cursor: 'col-resize',
      onMove: (ev) => {
        setColumnWidth(selected.el, `${Math.round(Math.max(8, startW + (ev.clientX - startX) / zoom))}px`)
        setTick((t) => t + 1)
      },
    })
  }

  const startRowResize = (e: ReactMouseEvent) => {
    if (!selected) return
    e.preventDefault()
    const startY = e.clientY
    const startH = (selected.el as HTMLElement).offsetHeight
    setDrag({
      cursor: 'row-resize',
      onMove: (ev) => {
        setRowHeight(selected.el, `${Math.round(Math.max(8, startH + (ev.clientY - startY) / zoom))}px`)
        setTick((t) => t + 1)
      },
    })
  }

  // Image resize: drag the bottom-right corner. Width/height go on the element
  // inline, so they survive export and drive the printed size.
  const startImageResize = (e: ReactMouseEvent) => {
    if (!selected) return
    e.preventDefault()
    const el = selected.el as HTMLElement
    const startX = e.clientX
    const startY = e.clientY
    const startW = el.offsetWidth
    const startH = el.offsetHeight
    setDrag({
      cursor: 'nwse-resize',
      onMove: (ev) => {
        el.style.width = `${Math.round(Math.max(8, startW + (ev.clientX - startX) / zoom))}px`
        el.style.height = `${Math.round(Math.max(8, startH + (ev.clientY - startY) / zoom))}px`
        setTick((t) => t + 1)
      },
    })
  }

  // Drag a block to reorder it: hit-test through the overlay into the iframe,
  // highlight a drop line before/after the block under the cursor, and on
  // release move the dragged node there.
  const startBlockMove = (e: ReactMouseEvent) => {
    if (!selected) return
    e.preventDefault()
    const dragged = selected.el
    setDrag({
      cursor: 'grabbing',
      onMove: (ev) => {
        const doc = iframeRef.current?.contentDocument
        const iframe = iframeRef.current
        const body = bodyRef.current
        if (!doc || !iframe || !body) return
        const rect = iframe.getBoundingClientRect()
        const x = (ev.clientX - rect.left) / zoom
        const y = (ev.clientY - rect.top) / zoom
        const under = doc.elementFromPoint(x, y)
        const target = under ? findSelectable(under, body) : null
        if (!target || target === dragged || dragged.contains(target)) {
          dropRef.current = null
          setMoveDrop(null)
          return
        }
        const tr = (target as HTMLElement).getBoundingClientRect()
        const where = y < tr.top + tr.height / 2 ? 'before' : 'after'
        dropRef.current = { el: target, where }
        setMoveDrop({ el: target, where })
      },
      onEnd: () => {
        const d = dropRef.current
        if (d && d.el !== dragged && !dragged.contains(d.el)) {
          if (d.where === 'before') d.el.before(dragged)
          else d.el.after(dragged)
        }
        dropRef.current = null
        setMoveDrop(null)
      },
    })
  }

  // A positioned image (behind text / page / cell background) may be dragged to
  // any coordinate; its top/left move with the cursor.
  const positioned = selected?.kind === 'image' &&
    ['absolute', 'fixed'].includes((selected.el as HTMLElement).style.position)
  const startImageMove = (e: ReactMouseEvent) => {
    if (!selected) return
    e.preventDefault()
    const el = selected.el as HTMLElement
    const startX = e.clientX
    const startY = e.clientY
    const startTop = parseFloat(el.style.top) || 0
    const startLeft = parseFloat(el.style.left) || 0
    setDrag({
      cursor: 'move',
      onMove: (ev) => {
        el.style.top = `${Math.round(startTop + (ev.clientY - startY) / zoom)}px`
        el.style.left = `${Math.round(startLeft + (ev.clientX - startX) / zoom)}px`
        setTick((t) => t + 1)
      },
    })
  }

  const stageWidth = pageWidth === null ? undefined : pageWidth * zoom

  return (
    <div className="canvas-editor">
      <div className="canvas-topbar">
        <label>
          Page
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {PAGE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Insert
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) insertBlock(e.target.value)
            }}
          >
            <option value="">block…</option>
            {BLOCKS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <span className="topbar-group">
          <button className="tb" title="Bold" onClick={() => withDoc((d) => toggleInline(d, 'bold'))}>
            <b>B</b>
          </button>
          <button className="tb" title="Italic" onClick={() => withDoc((d) => toggleInline(d, 'italic'))}>
            <i>I</i>
          </button>
          <button
            className="tb"
            title="Underline"
            onClick={() => withDoc((d) => toggleInline(d, 'underline'))}
          >
            <u>U</u>
          </button>
        </span>
        <span className="topbar-group">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              className="tb"
              title={`Align ${a}`}
              onClick={() => selected && setAlign(selected.el, a)}
              disabled={!selected}
            >
              {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
            </button>
          ))}
        </span>
        <span className="topbar-group">
          <button className="tb" title="Undo (Ctrl+Z)" onClick={undo} disabled={!histState.canUndo}>
            ↶
          </button>
          <button className="tb" title="Redo (Ctrl+Y)" onClick={redo} disabled={!histState.canRedo}>
            ↷
          </button>
        </span>
        <span className="muted">{Math.round(zoom * 100)}%</span>
      </div>
      {selected && (
        <div className="canvas-props" key={selId}>
          <span className="props-kind">{KIND_LABEL[selected.kind]}</span>
          <label className="prop">
            Font
            <select
              defaultValue={styleValue('font-family')}
              onChange={(e) => applyStyle('font-family', e.target.value)}
            >
              <option value="">—</option>
              <option value="serif">Serif</option>
              <option value="sans-serif">Sans-serif</option>
              <option value="monospace">Monospace</option>
              <option value='"Times New Roman", serif'>Times New Roman</option>
              <option value="Arial, sans-serif">Arial</option>
            </select>
          </label>
          <label className="prop">
            Size
            <input
              defaultValue={styleValue('font-size')}
              placeholder="12pt"
              onChange={(e) => applyStyle('font-size', e.target.value)}
            />
          </label>
          <label className="prop">
            {isCell ? 'Col W' : 'W'}
            <input
              defaultValue={styleValue('width')}
              placeholder="auto"
              onChange={(e) => applyWidth(e.target.value)}
            />
          </label>
          <label className="prop">
            {isCell ? 'Row H' : 'H'}
            <input
              defaultValue={styleValue('height')}
              placeholder="auto"
              onChange={(e) => applyHeight(e.target.value)}
            />
          </label>
          {selected.kind === 'image' && (
            <label className="prop">
              Layer
              <select
                defaultValue={layerOf(selected.el as HTMLElement)}
                onChange={(e) => applyLayer(e.target.value as Layer)}
              >
                <option value="normal">In flow</option>
                <option value="behind">Behind text</option>
                {imageInCell && <option value="cell">Cell background</option>}
                <option value="page">Page background (every page)</option>
              </select>
            </label>
          )}
          {codeFilter ? (
            <>
              <ColorControl
                label="Code"
                value={codeColour(codeKeys.fg, '#000000')}
                onChange={(c) => applyCodeColour(codeKeys.fg, c)}
              />
              <ColorControl
                label="Fill"
                value={codeColour(codeKeys.bg, '#ffffff')}
                onChange={(c) => applyCodeColour(codeKeys.bg, c)}
              />
            </>
          ) : (
            <>
              <ColorControl
                label="Text"
                value={parseColour(styleValue('color'))}
                onChange={(c) => applyStyle('color', toCss(c))}
              />
              <ColorControl
                label="Background"
                value={parseColour(styleValue('background-color') || '#ffffff')}
                onChange={(c) => applyStyle('background-color', toCss(c))}
              />
            </>
          )}
          {(canRepeat || canCondition || canSplit) && !convert && (
            <span className="topbar-group convert-actions">
              {canRepeat && (
                <button
                  className="tb"
                  title="Repeat this for each item of an array"
                  onClick={() =>
                    setConvert({ type: 'repeat', value: arrayHints[0] ?? 'items', item: 'item' })
                  }
                >
                  ⟳ Repeat
                </button>
              )}
              {canCondition && (
                <button
                  className="tb"
                  title="Show only when a field is present"
                  onClick={() => setConvert({ type: 'if', value: existingValue(selected.el) || 'flag', item: '' })}
                >
                  ? If
                </button>
              )}
              {canSplit && (
                <button
                  className="tb"
                  title="Split the value into one box per character"
                  onClick={() =>
                    setConvert({ type: 'cells', value: existingValue(selected.el) || 'value', item: '' })
                  }
                >
                  ▦ Cells
                </button>
              )}
            </span>
          )}
          {convert && (
            <span className="topbar-group convert-form">
              {convert.type === 'repeat' && (
                <>
                  <input
                    placeholder="item"
                    value={convert.item}
                    onChange={(e) => setConvert({ ...convert, item: e.target.value })}
                  />
                  <span className="cc-label">in</span>
                  <input
                    list="convert-arrays"
                    placeholder="items"
                    value={convert.value}
                    onChange={(e) => setConvert({ ...convert, value: e.target.value })}
                  />
                  <datalist id="convert-arrays">
                    {arrayHints.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </>
              )}
              {convert.type !== 'repeat' && (
                <input
                  placeholder={convert.type === 'if' ? 'condition' : 'value'}
                  value={convert.value}
                  onChange={(e) => setConvert({ ...convert, value: e.target.value })}
                />
              )}
              <button className="tb" onClick={applyConvert}>
                Apply
              </button>
              <button className="tb" onClick={() => setConvert(null)}>
                ✕
              </button>
            </span>
          )}
        </div>
      )}
      <div className="canvas-scroll" ref={scrollRef}>
        <div
          className="canvas-stage"
          style={{ width: stageWidth, height: frameHeight * zoom }}
        >
          <FurnitureStrip edge="top" boxes={furniture} zoom={zoom} />
          <iframe
            ref={iframeRef}
            title="template canvas"
            style={{
              width: pageWidth ?? '100%',
              height: frameHeight,
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              border: 'none',
              display: 'block',
            }}
          />
          <FurnitureStrip edge="bottom" boxes={furniture} zoom={zoom} />
          {cellRect && (
            <>
              <div
                className="col-resize"
                title="Drag to resize column"
                style={{
                  left: cellRect.right * zoom - 3,
                  top: cellRect.top * zoom,
                  height: cellRect.height * zoom,
                }}
                onMouseDown={startColResize}
              />
              <div
                className="row-resize"
                title="Drag to resize row"
                style={{
                  left: cellRect.left * zoom,
                  top: cellRect.bottom * zoom - 3,
                  width: cellRect.width * zoom,
                }}
                onMouseDown={startRowResize}
              />
            </>
          )}
          {imgRect && (
            <>
              <div
                className="img-resize"
                title="Drag to resize"
                style={{ left: imgRect.right * zoom - 7, top: imgRect.bottom * zoom - 7 }}
                onMouseDown={startImageResize}
              />
              {positioned && (
                <div
                  className="img-move"
                  title="Drag to move freely"
                  style={{
                    left: imgRect.left * zoom,
                    top: imgRect.top * zoom,
                    width: imgRect.width * zoom,
                    height: imgRect.height * zoom,
                  }}
                  onMouseDown={startImageMove}
                />
              )}
            </>
          )}
          {moveDrop &&
            (() => {
              const tr = (moveDrop.el as HTMLElement).getBoundingClientRect()
              return (
                <div
                  className="drop-line"
                  style={{
                    left: tr.left * zoom,
                    top: (moveDrop.where === 'before' ? tr.top : tr.bottom) * zoom - 1,
                    width: tr.width * zoom,
                  }}
                />
              )
            })()}
          {drag && (
            <div
              className="drag-overlay"
              style={{ cursor: drag.cursor }}
              onMouseMove={(e) => drag.onMove(e.nativeEvent)}
              onMouseUp={() => {
                drag.onEnd?.()
                setDrag(null)
              }}
              onMouseLeave={() => {
                setDrag(null)
                setMoveDrop(null)
              }}
            />
          )}
          {selected && toolbarPos && (
            <div className="el-toolbar" style={{ left: toolbarPos.left, top: toolbarPos.top }}>
              <span className="el-kind">{KIND_LABEL[selected.kind]}</span>
              <button title="Select parent" onClick={() => select(parentSelectable(selected.el, bodyRef.current!))}>
                ↑
              </button>
              <button className="grip" title="Drag to move" onMouseDown={startBlockMove}>
                ⠿
              </button>
              <button title="Move up" onClick={() => moveSelected(-1)}>
                ▲
              </button>
              <button title="Move down" onClick={() => moveSelected(1)}>
                ▼
              </button>
              {inTable && (
                <>
                  <button title="Add row" onClick={() => tableOp(addRow)}>
                    +R
                  </button>
                  <button title="Delete row" onClick={() => tableOp(deleteRow)}>
                    −R
                  </button>
                  <button title="Add column" onClick={() => tableOp(addColumn)}>
                    +C
                  </button>
                  <button title="Delete column" onClick={() => tableOp(deleteColumn)}>
                    −C
                  </button>
                  <select
                    className="el-borders"
                    title="Table borders"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) tableOp((el) => setTableBorders(el, e.target.value as BorderMode))
                      e.target.value = ''
                    }}
                  >
                    <option value="">border…</option>
                    <option value="all">all cells</option>
                    <option value="outer">outer only</option>
                    <option value="none">none</option>
                  </select>
                </>
              )}
              <button title="Duplicate" onClick={duplicateSelected}>
                ⧉
              </button>
              <button title="Delete" onClick={removeSelected}>
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The @page margin boxes, rendered where the browser refuses to: a strip
 * above or below the page. Content is an approximation — counters become
 * ⟨1⟩/⟨N⟩ — because true values exist only at paginate time; the strip's job
 * is to stop headers and footers from being invisible in the editor. */
function FurnitureStrip({
  edge,
  boxes,
  zoom,
}: {
  edge: 'top' | 'bottom'
  boxes: ReturnType<typeof parseMarginBoxes>
  zoom: number
}) {
  const own = boxes.filter((b) => b.edge === edge)
  if (own.length === 0) return null
  const slot = (name: 'left' | 'center' | 'right') =>
    own
      .filter((b) => b.slot === name)
      .map((b) => b.preview)
      .join(' ')
  return (
    <div className="furniture-strip" style={{ fontSize: 11 * zoom }}>
      <span>{slot('left')}</span>
      <span>{slot('center')}</span>
      <span>{slot('right')}</span>
      <i className="furniture-note">{edge === 'top' ? 'page header' : 'page footer'}</i>
    </div>
  )
}
