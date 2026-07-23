import { useEffect, useMemo, useRef, useState } from 'react'
import { fitZoom } from '../layout'
import {
  CANVAS_AFFORDANCE_CSS,
  CANVAS_GUTTER_PX,
  PAGE_FORMATS,
  formatFromStyles,
} from './page'
import { exportBody, prepareBody, prepareFragment } from './export-body'
import { KIND_LABEL, NodeKind, findSelectable, kindOf, parentSelectable } from './selection'

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
  const callbacksRef = useRef({ onChange, onReady })
  callbacksRef.current = { onChange, onReady }

  const [format, setFormat] = useState(() => formatFromStyles(canvasStyles))
  const [zoom, setZoom] = useState(1)
  const [frameHeight, setFrameHeight] = useState(400)
  const [selected, setSelected] = useState<{ el: Element; kind: NodeKind } | null>(null)
  // Bumped on any mutation so the toolbar re-measures its position.
  const [, setTick] = useState(0)

  const pageWidth = useMemo(
    () => PAGE_FORMATS.find((f) => f.id === format)?.width ?? null,
    [format],
  )

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

    // Selection: nearest structural node under the click; body click clears.
    const onClick = (e: MouseEvent) => {
      const hit = findSelectable(e.target as Element, body)
      for (const prev of Array.from(body.querySelectorAll('[data-lf-selected]'))) {
        prev.removeAttribute('data-lf-selected')
      }
      if (hit) {
        hit.setAttribute('data-lf-selected', '')
        setSelected({ el: hit, kind: kindOf(hit)! })
      } else {
        setSelected(null)
      }
    }
    doc.addEventListener('click', onClick)

    // Content height drives the iframe height (the outer pane scrolls).
    const measure = () => setFrameHeight(Math.max(doc.documentElement.scrollHeight, 200))
    measure()

    // Any DOM change: re-measure, reposition the toolbar, debounce an export.
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      measure()
      setTick((t) => t + 1)
      clearTimeout(timer)
      timer = setTimeout(() => callbacksRef.current.onChange(exportBody(body)), 300)
    })
    observer.observe(body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      // Selection marks are canvas-only; exporting on them would be noise.
      attributeFilter: undefined,
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
      // Flush the final state so mode switches never lose an edit.
      callbacksRef.current.onChange(exportBody(body))
      bodyRef.current = null
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

  // ---- element toolbar ----------------------------------------------------
  const removeSelected = () => {
    if (!selected) return
    const next = parentSelectable(selected.el, bodyRef.current!)
    selected.el.remove()
    select(next)
  }

  const duplicateSelected = () => {
    if (!selected) return
    const copy = selected.el.cloneNode(true) as Element
    copy.removeAttribute('data-lf-selected')
    selected.el.after(copy)
  }

  const selectParent = () => {
    if (!selected || !bodyRef.current) return
    select(parentSelectable(selected.el, bodyRef.current))
  }

  const select = (el: Element | null) => {
    const body = bodyRef.current
    if (!body) return
    for (const prev of Array.from(body.querySelectorAll('[data-lf-selected]'))) {
      prev.removeAttribute('data-lf-selected')
    }
    if (el) {
      el.setAttribute('data-lf-selected', '')
      setSelected({ el, kind: kindOf(el)! })
    } else {
      setSelected(null)
    }
  }

  // Toolbar position in stage coordinates (iframe has no internal scroll).
  let toolbarPos: { left: number; top: number } | null = null
  if (selected && selected.el.isConnected) {
    const rect = (selected.el as HTMLElement).getBoundingClientRect()
    toolbarPos = {
      left: Math.max(0, rect.left * zoom),
      top: Math.max(0, rect.top * zoom - 30),
    }
  } else if (selected && !selected.el.isConnected) {
    // The node was removed by an edit (e.g. text retype around it).
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
              <button title="Select parent" onClick={selectParent}>
                ↑
              </button>
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
