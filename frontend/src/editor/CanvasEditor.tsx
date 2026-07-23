import { useEffect, useMemo, useRef, useState } from 'react'
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
import { addColumn, addRow, deleteColumn, deleteRow } from './table-ops'
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
}: {
  /** protected body HTML with canvas asset URLs */
  initialBody: string
  /** CSS text from the template's <style> blocks, injected read-only */
  canvasStyles: string
  /** fires (debounced) with the current canvas-form body HTML */
  onChange: (bodyHtml: string) => void
  onReady?: (api: CanvasEditorApi) => void
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

  const pageWidth = useMemo(
    () => PAGE_FORMATS.find((f) => f.id === format)?.width ?? null,
    [format],
  )

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
    // Author CSS first, affordances second, so selection outlines win.
    style.textContent = canvasStyles + CANVAS_AFFORDANCE_CSS
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

  const insertBlock = (id: string) => {
    const block = BLOCKS.find((b) => b.id === id)
    const body = bodyRef.current
    const doc = iframeRef.current?.contentDocument
    if (!block || !body || !doc) return
    const holder = doc.createElement('div')
    holder.innerHTML = block.content
    const node = holder.firstElementChild
    if (!node) return
    prepareFragment(node)
    const target = selected?.el.isConnected ? selected.el : null
    if (target) target.after(node)
    else body.appendChild(node)
    select(node)
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

  const inTable = selected && ['cell', 'row', 'loop'].includes(selected.kind)
    ? !!selected.el.closest('table')
    : false

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
      <div className="canvas-scroll" ref={scrollRef}>
        <div
          className="canvas-stage"
          style={{ width: stageWidth, height: frameHeight * zoom }}
        >
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
          {selected && toolbarPos && (
            <div className="el-toolbar" style={{ left: toolbarPos.left, top: toolbarPos.top }}>
              <span className="el-kind">{KIND_LABEL[selected.kind]}</span>
              <button title="Select parent" onClick={() => select(parentSelectable(selected.el, bodyRef.current!))}>
                ↑
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
