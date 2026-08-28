import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { cleanPastedHtml } from '../docx/clean-paste'
import { fitZoom } from '../layout'
import { BLOCKS, type BlockDef } from './blocks'
import { exportBody, prepareBody, prepareFragment } from './export-body'
import { SnapshotHistory } from './history'
import {
  CANVAS_AFFORDANCE_CSS,
  CANVAS_GUTTER_PX,
  PAGE_FORMATS,
  formatFromStyles,
} from './page'
import BoxModel from './BoxModel'
import { GRID_MAJOR_MM, GRID_MINOR_MM, PX_PER_MM } from './box-model'
import { CANVAS_SHORTCUTS, EDITOR_SHORTCUTS, intentFor, type CanvasIntent } from './keyboard'
import { CANVAS_MODIFIERS, isDuplicating, keepRatio, lockAxis } from './modifiers'
import { VERDICT_LABEL, crossingsAt, type BoxNode } from './page-breaks'
import { dropPlacement, place, placementFor, type Placement } from './placement'
import { scopesAt, type FieldRow, type LoopScope } from './fields'
import { rank, rankLabels, slashTriggerAt, triggerAt, type Trigger } from './typeahead'
import {
  ATOMIC_SELECTOR,
  allInline,
  caretAfter,
  caretAtPoint,
  caretBeside,
  caretRangeIn,
  clampOutOfAtomic,
} from './range-ops'
import { setDeclaration } from './style-attr'
import { SNAP_LABEL, edgeLines, snapTo, toMm, type Rect, type SnapKind, type SnapLine } from './snap'
import { KIND_LABEL, NodeKind, findSelectable, kindOf, parentSelectable } from './selection'
import ColorControl from './ColorControl'
import { type Colour, parse as parseColour, toCss, toHex } from './color'
import { getFilterArg, setFilterArg } from './filter-args'
import { parseMarginBoxes, parsePageBox, type PageBox } from './furniture'
import { RUNNING_ATTR, markRunning, runningBoxCss, slotsByName } from './running'
import PageSetupPanel from './PageSetupPanel'
import {
  RUNNING_NAME,
  hasFurniture,
  removeFurnitureBoxFromCss,
  runningElementHtml,
  type Edge,
} from './furniture-setup'
import ExpressionDialog from './ExpressionDialog'
import { laterOverrides, readPageSetup, type PageSetup } from './page-css'
import {
  canPaginate,
  gapToNextPage,
  overflowsItsPage,
  pageBreakOffsets,
  pageCountFor,
  sheetEdges,
  usablePageHeight,
  type PageGeometry,
} from './pagination'
import InspectorPanel, { SIDE_TABS, type SideTab } from './InspectorPanel'
import Splitter from '../components/Splitter'
import {
  getBoolPref,
  getNumPref,
  getStringPref,
  setBoolPref,
  setNumPref,
  setStringPref,
  PREF_INSPECTOR_OPEN,
  PREF_INSPECTOR_TAB,
  PREF_INSPECTOR_WIDTH,
} from '../prefs'
import { CROWDED, outlineOf, selectableChildren, type OutlineItem } from './outline'
import { describeRemoved, sanitizeHtml } from './sanitize'
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
import BorderControl from './BorderControl'
import { canMergeDown, canMergeRight, isMerged, mergeDown, mergeRight, splitCell } from './cells'
import { existingValue, isConditional, isRepeating, makeRepeating, wrapConditional } from './convert'
import { protect } from '../jinja-bridge'
import Icon from '../components/Icon'
import { PRESETS } from '../presets/registry'
import { setAlign, toggleInline } from './text-commands'

/** Edit the Jinja expression a chip, loop or conditional carries.
 *
 * The attribute is what restore() reads on the way out; the visible label is
 * kept in sync for placeholders. Shared by the double-click and the keyboard
 * path, because "the mouse can do one more thing than the keyboard" is how an
 * editor stops being usable without one. */
/** The inspector's column: wide enough for a spacing box and a colour, and
 * capped where it would start taking width from the page it describes. */
const INSPECTOR_DEFAULT = 288
const INSPECTOR_MIN = 240
const INSPECTOR_MAX = 460
/** The page keeps at least this much, whatever the inspector is set to. A
 * column that can squeeze the canvas to twenty pixels is not a column with a
 * maximum, and the zoom read-out then says 100 % over a page nobody can
 * see — fitZoom answers 100 for an impossible width. */
const CANVAS_MIN_PX = 360

const EXPR_ATTRS = ['data-jinja-expr', 'data-jinja-for', 'data-jinja-if'] as const
type ExprAttr = (typeof EXPR_ATTRS)[number]

/** Which kind of Jinja an element carries, if any. */
function expressionAttr(el: Element): ExprAttr | null {
  return EXPR_ATTRS.find((attr) => el.hasAttribute(attr)) ?? null
}

/** Write an edited expression back. The attribute is what restore() reads on
 * the way out; a placeholder's visible label is kept in step with it. */
function writeExpression(el: Element, attr: ExprAttr, expression: string): void {
  const expr = expression.trim()
  if (!expr) return
  el.setAttribute(attr, expr)
  if (attr === 'data-jinja-expr') el.textContent = `{{ ${expr} }}`
}

/**
 * Hand a shortcut the canvas does not use to the application around it.
 *
 * A key press inside an iframe never reaches the document hosting it, so every
 * shortcut the editor offers was dead for as long as the caret was in the page
 * — which is where somebody editing a document keeps it. Ctrl+S in particular
 * did the browser's "save this page as" instead of saving the draft.
 *
 * Rather than teach the canvas what the shell binds, the press is re-dispatched
 * on the host document: whatever the shell listens for works from inside too,
 * and neither side has to hold a copy of the other's list. The return value
 * says whether anything claimed it, so the browser's own binding is stopped
 * exactly when something else took the key and never otherwise.
 */
function forwardToApp(e: KeyboardEvent): boolean {
  const forwarded = new KeyboardEvent('keydown', {
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(forwarded)
  return forwarded.defaultPrevented
}

/** Does this element force a page break, and on which side? */
function breakSide(el: HTMLElement): 'after' | 'before' | null {
  const isBreak = (v: string) => v === 'always' || v === 'page'
  if (isBreak(el.style.pageBreakAfter) || isBreak(el.style.breakAfter)) return 'after'
  if (isBreak(el.style.pageBreakBefore) || isBreak(el.style.breakBefore)) return 'before'
  return null
}

/** Make the canvas body the page area: inset by the @page margins exactly as
 * the printed body is. Applied at mount and again whenever the page changes,
 * so the two can never say different things. */
function insetBody(body: HTMLElement, pageBox: PageBox | null): void {
  body.style.margin = '0'
  if (!pageBox) {
    body.style.removeProperty('position')
    for (const side of ['top', 'left', 'right'] as const) body.style.removeProperty(side)
    body.style.removeProperty('padding-bottom')
    return
  }
  const m = pageBox.margin
  body.style.position = 'absolute'
  body.style.top = m.top
  body.style.left = m.left
  body.style.right = m.right
  body.style.paddingBottom = m.bottom
}

/** Push content past a page break onto the next sheet, so the canvas shows the
 * following content on a new page as it will print. The pushes are canvas-only
 * spacer divs (data-lf-spacer), stripped on export; the caller detaches the
 * observer so they neither loop nor reach history. */
function paginate(body: HTMLElement, geom: PageGeometry | null): void {
  for (const s of Array.from(body.querySelectorAll('[data-lf-spacer]'))) s.remove()
  if (!canPaginate(geom)) return
  const doc = body.ownerDocument

  const spacerOf = (height: number): HTMLElement => {
    const spacer = doc.createElement('div')
    spacer.setAttribute('data-lf-spacer', '1')
    spacer.style.height = `${Math.round(height)}px`
    return spacer
  }

  // Explicit breaks first, and by their own element rather than by the top-level
  // block that holds them: `page-break-after` on a row inside a table is a
  // thing people write, and the spacer goes beside the element that asked.
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
    const side = breakSide(el)
    if (!side) continue
    const rect = el.getBoundingClientRect()
    const gap = gapToNextPage(side === 'after' ? rect.bottom : rect.top, geom)
    if (gap <= 2 || gap >= geom.pageHeight) continue
    if (side === 'after') el.after(spacerOf(gap))
    else el.before(spacerOf(gap))
  }

  // Then the natural ones. Each sheet occupies a whole page height in the strip,
  // so a block that would run past its page is moved to the next page's content
  // band and the space between the two sheets — one footer band, the paper edge,
  // one header band — is left standing where it belongs.
  //
  // In document order, measuring as it goes: a spacer shifts everything after
  // it, and every rect read here is read after the shifts above it have already
  // happened. That is what keeps this from needing to know how much it has
  // inserted, and from feeding its own output back into the next pass.
  for (const child of Array.from(body.children)) {
    if (child.hasAttribute('data-lf-spacer')) continue
    const rect = child.getBoundingClientRect()
    if (rect.height === 0) continue
    if (!overflowsItsPage(rect.top, rect.height, geom)) continue
    const gap = gapToNextPage(rect.top, geom)
    if (gap <= 2) continue
    child.before(spacerOf(gap))
  }
}

/** What the shell (Editor.tsx) may ask of the canvas. */
export interface CanvasEditorApi {
  /** Insert markup where the caret is (inline) or beside the selected block. */
  insertHtml: (html: string) => void
  /** Insert one of the palette's blocks, and select it so it can be edited. */
  insertBlock: (id: string) => void
  /** Switch a header or footer on or off — both halves, exactly as the page
   * panel's own checkbox does. The element half is a document edit and the
   * document is in here; rewriting the body from outside would rebuild the
   * canvas and lose the caret. */
  setFurniture: (edge: Edge, on: boolean) => void
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
  fields = [],
  onSanitized,
  onScopes,
  onPageSetup,
  onFurniture,
  onDropFiles,
  focusMode = false,
  onLeaveFocus,
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
  /** every value this document can name, for the `{{` typeahead */
  fields?: FieldRow[]
  /** fires with a warning when executable markup was stripped on load, or null */
  onSanitized?: (warning: string | null) => void
  /** fires with the loops in force at the selection, so the field list can say
   * which of them can be written here and under what name */
  onScopes?: (scopes: LoopScope[]) => void
  /** fires when the page itself is changed; the shell writes it into the
   * template's @page rule and hands the new stylesheet back */
  onPageSetup?: (setup: PageSetup) => void
  /** fires when a header or footer is switched on or off; the shell writes both
   * halves — the margin box and the element it pulls */
  onFurniture?: (edge: Edge, on: boolean) => void
  /** fires when files are dropped on the page, with the caret already placed
   * where they landed. The canvas knows about the document, not about storage:
   * uploading them and inserting whatever they became is the shell's half */
  onDropFiles?: (files: File[]) => void
  /** Everything but the page is folded away. Held by the editor around this
   * one, because it covers the navigation and the preview too. */
  focusMode?: boolean
  onLeaveFocus?: () => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasBodyRef = useRef<HTMLDivElement>(null)
  // The row holding the page and the inspector. Measured because the
  // inspector's limit is not a constant: it is whatever leaves the page its
  // minimum.
  const [bodyWidth, setBodyWidth] = useState(0)
  const bodyRef = useRef<HTMLElement | null>(null)
  const historyRef = useRef<SnapshotHistory | null>(null)
  const restoringRef = useRef(false)
  // Set while a gesture is under way — a drag, or a value being scrubbed in the
  // spacing boxes. History and the document's dirty state wait for it to end.
  const gestureRef = useRef(false)
  // What the document looked like when the gesture began, so Escape can put it
  // back without needing an undo step to have been recorded first.
  const gestureStartRef = useRef<string | null>(null)
  // Commit whatever is on the canvas now: the debounced path calls it, and so
  // does the end of a gesture.
  const commitRef = useRef<(() => void) | null>(null)
  // The palette lives in the shell, and the function it calls is declared
  // below the mount effect that publishes the API.
  const insertBlockRef = useRef<((id: string) => void) | null>(null)
  // Same reason as insertBlockRef: the API object is built inside the mount
  // effect, which cannot see a function this render defined.
  const furnitureRef = useRef<((edge: Edge, on: boolean) => void) | null>(null)
  const callbacksRef = useRef({
    onChange,
    onReady,
    onSanitized,
    onScopes,
    onPageSetup,
    onFurniture,
    onDropFiles,
    onLeaveFocus,
  })
  callbacksRef.current = {
    onChange,
    onReady,
    onSanitized,
    onScopes,
    onPageSetup,
    onFurniture,
    onDropFiles,
    onLeaveFocus,
  }
  // The stylesheet element the canvas injects, kept so a change to the page
  // can be applied without tearing the document down and losing its history.
  const styleElRef = useRef<HTMLStyleElement | null>(null)
  const bandsElRef = useRef<HTMLStyleElement | null>(null)
  const measureRef = useRef<(() => void) | null>(null)

  const format = useMemo(() => formatFromStyles(canvasStyles), [canvasStyles])
  const pageSetup = useMemo(() => readPageSetup(`<style>${canvasStyles}</style>`), [canvasStyles])
  const pageOverrides = useMemo(
    () => laterOverrides(`<style>${canvasStyles}</style>`),
    [canvasStyles],
  )
  // Which edges carry a header or a footer. Named apart from `furniture`, which
  // is the margin boxes the strips preview.
  const bands = useMemo(
    () => ({
      top: hasFurniture(`<style>${canvasStyles}</style>`, 'top'),
      bottom: hasFurniture(`<style>${canvasStyles}</style>`, 'bottom'),
    }),
    [canvasStyles],
  )
  // The expression being edited, in a dialog rather than a window prompt: a
  // prompt cannot be styled, cannot show what the expression is for, and on a
  // second monitor opens somewhere the user is not looking.
  const [editingExpr, setEditingExpr] = useState<{ el: Element; attr: ExprAttr } | null>(null)
  /**
   * How big the page is drawn.
   *
   * Two numbers, because there are two answers and the editor has to hold both:
   * the width the window happens to allow, and the size the reader asked for.
   * Fitting is the default — a page that arrives already whole is what somebody
   * opening a document wants — but it is a default, not a rule. Reading 8pt
   * small print, or placing something against a margin, needs a closer look,
   * and until now the only way to get one was to make the browser window
   * bigger.
   *
   * A manual choice wins until it is given back ("Fit"), and window resizes go
   * on updating the fitted value underneath, so handing it back is instant.
   */
  const [fitWidth, setFitWidth] = useState(1)
  const [fitPage, setFitPage] = useState(1)
  // 'width' fills the column with the page; 'page' shows the whole sheet at
  // once, which is the only way to judge where a break falls. A number is a
  // size the author chose and neither of those.
  const [zoomChoice, setZoomChoice] = useState<'width' | 'page' | number>('width')
  const zoom =
    typeof zoomChoice === 'number' ? zoomChoice : zoomChoice === 'page' ? fitPage : fitWidth
  // Read from inside the canvas document's own listeners, which are bound once
  // at mount and would otherwise hold the zoom the page had when it opened.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  // Where the context menu is, in host pixels. What it acts on is the
  // selection: right-clicking selects first, so the menu and the properties bar
  // are always talking about the same element.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [keysOpen, setKeysOpen] = useState(false)
  // A file is over the page. Shown, because a drop target that gives no sign
  // it is one is indistinguishable from a page that will refuse the file.
  const [dropping, setDropping] = useState(false)
  const menuRef = useRef(false)
  menuRef.current = menu !== null
  // Read from the canvas document's own listener, bound once at mount.
  const focusRef = useRef(focusMode)
  focusRef.current = focusMode
  const [frameHeight, setFrameHeight] = useState(400)
  const [selected, setSelected] = useState<{ el: Element; kind: NodeKind } | null>(null)
  const [histState, setHistState] = useState({ canUndo: false, canRedo: false })
  // Bumped on any mutation so the toolbar re-measures its position.
  const [tick, setTick] = useState(0)
  // Bumped on each new selection so the props inputs re-seed from that element.
  const [selId, setSelId] = useState(0)
  // The structure panel. Open by default where there is room for it: a panel
  // nobody knows about answers nobody's question.
  // Open by default at any width. It used to follow `compact` — the panel was
  // an extra then, and hiding it on a laptop bought the page some room. It
  // holds the properties now, so a closed inspector means clicking a block and
  // finding nowhere to set its margins: the controls were in a bar above the
  // canvas before, always there whatever the width.
  const [inspectorOpen, setInspectorOpen] = useState(() => getBoolPref(PREF_INSPECTOR_OPEN, true))
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    getNumPref(PREF_INSPECTOR_WIDTH, INSPECTOR_DEFAULT, INSPECTOR_MIN, INSPECTOR_MAX),
  )
  const [sideTab, setSideTab] = useState<SideTab>(() =>
    getStringPref(PREF_INSPECTOR_TAB, 'properties', SIDE_TABS),
  )
  useEffect(() => setBoolPref(PREF_INSPECTOR_OPEN, inspectorOpen), [inspectorOpen])
  useEffect(() => setNumPref(PREF_INSPECTOR_WIDTH, inspectorWidth), [inspectorWidth])
  useEffect(() => setStringPref(PREF_INSPECTOR_TAB, sideTab), [sideTab])
  // Which containers the panel has been told to open or close. A WeakMap rather
  // than the document, because opening a twisty is not an edit: writing it into
  // the DOM would put a mutation burst — repaginate, re-measure, re-export —
  // behind every click on an arrow.
  const outlineFolds = useRef(new WeakMap<Element, boolean>())
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
  // A millimetre grid over the sheet. Kept on while something is being dragged
  // without being asked for: that is the moment a person is judging alignment,
  // and a ruler that appears exactly then is the one nobody has to turn on.
  const [gridPinned, setGridPinned] = useState(false)
  // Live drop target while dragging a block to reorder it.
  const [moveDrop, setMoveDrop] = useState<Placement | null>(null)
  const dropRef = useRef<Placement | null>(null)
  // Whether the block being dragged should be copied rather than moved.
  const copyRef = useRef(false)
  // True while a spacing or size box has the focus: a ruler is wanted from the
  // moment somebody reaches for a number, not only once they drag something.
  const [adjusting, setAdjusting] = useState(false)
  // What the pointer is over, and what a click would therefore take.
  //
  // Held as a rectangle drawn over the canvas rather than as an attribute on
  // the element: marking the document would put a DOM mutation behind every
  // mouse move, and the observer that watches for edits would repaginate,
  // re-measure and consider committing history on each one.
  const [hover, setHover] = useState<{ left: number; top: number; width: number; height: number; label: string } | null>(null)
  const hoverRef = useRef<Element | null>(null)
  // Lines a drag has landed on, drawn while it holds them.
  const [guides, setGuides] = useState<{ axis: 'x' | 'y'; at: number; kind: SnapKind }[]>([])
  // The live measurement beside the cursor, in viewport coordinates.
  const [readout, setReadout] = useState<{ left: number; top: number; text: string } | null>(null)
  // Typing at the caret offers something: `{{` the fields, `/` the blocks. Held
  // here as a position plus a shortlist of labels; what each row MEANS is in the
  // ref, along with the text node it belongs to — the keyboard handler inside
  // the iframe is mounted once and cannot see state.
  const [typeahead, setTypeahead] = useState<
    { left: number; top: number; rows: { label: string; sample?: string }[]; active: number } | null
  >(null)
  const typeaheadRef = useRef<
    | { kind: 'field'; node: Text; trigger: Trigger; rows: FieldRow[]; active: number }
    | { kind: 'block'; node: Text; trigger: Trigger; rows: BlockDef[]; active: number }
    | null
  >(null)
  const fieldsRef = useRef<FieldRow[]>(fields)
  fieldsRef.current = fields

  const pageWidth = useMemo(
    () => PAGE_FORMATS.find((f) => f.id === format)?.width ?? null,
    [format],
  )
  const pageHeight = useMemo(
    () => PAGE_FORMATS.find((f) => f.id === format)?.height ?? null,
    [format],
  )
  // The @page margin boxes the browser cannot render: shown as strips.
  const furniture = useMemo(() => parseMarginBoxes(canvasStyles), [canvasStyles])
  // Page geometry so a page-background image can bleed past the margins.
  const pageBox = useMemo(() => parsePageBox(canvasStyles), [canvasStyles])
  // Margins in px, read back off the laid-out body (which is inset by the
  // @page margins), so no unit conversion is done by hand.
  const [margins, setMargins] = useState({ top: 0, bottom: 0 })
  // What a printed page can actually hold: the sheet minus the margins it
  // spends on EVERY page. Using the full sheet height here is the bug that put
  // the page-2 line two rows too low on real forms.
  const geometry: PageGeometry | null =
    pageHeight != null
      ? { pageHeight, marginTop: margins.top, marginBottom: margins.bottom }
      : null
  const pageCount = geometry ? pageCountFor(frameHeight, geometry) : 1
  const breakOffsets = geometry ? pageBreakOffsets(frameHeight, geometry) : []
  // The sheet shown always reaches the bottom edge of the last printed page.
  // Whole sheets: the strip is as tall as the pages it holds, so the space
  // between two of them is on screen rather than only in the arithmetic.
  const sheetHeight = geometry ? Math.max(frameHeight, pageCount * geometry.pageHeight) : frameHeight
  const edges = geometry ? sheetEdges(frameHeight, geometry) : []
  // The observer closure (mounted once) reads the live geometry from here.
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry

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

  /** What each page break passes through, and what the renderer will do with
   * it. The canvas cannot reflow the document, but it can stop the difference
   * from being a surprise — see page-breaks.ts.
   *
   * Only elements a boundary actually crosses are measured: reading a computed
   * style for every node of a long form on every mutation would cost more than
   * the answer is worth, and the rule never looks at the others anyway. */
  const pageCrossings = useMemo(() => {
    const body = bodyRef.current
    const view = body?.ownerDocument.defaultView
    if (!body || !view || breakOffsets.length === 0) return { list: [], boxes: new Map() }

    // Everything here is in sheet coordinates — the same ones breakOffsets and
    // the overlays use. Inside the iframe a rect is already measured from the
    // sheet corner, so nothing has to be rebased.
    const origin = body.getBoundingClientRect()
    const boxes = new Map<string, { left: number; top: number; width: number; height: number }>()
    let next = 0

    const crossesAny = (top: number, bottom: number): boolean =>
      breakOffsets.some((edge) => top < edge - 0.5 && bottom > edge + 0.5)

    const build = (el: Element, top: number, bottom: number): BoxNode => {
      const style = view.getComputedStyle(el)
      const key = String(next++)
      const rect = el.getBoundingClientRect()
      boxes.set(key, {
        left: rect.left,
        top,
        width: rect.width,
        height: bottom - top,
      })
      const node: BoxNode = {
        key,
        top,
        bottom,
        // What the renderer refuses to break: a table row, an image, and
        // anything the author said so about.
        keepsTogether:
          el.tagName === 'TR' ||
          el.tagName === 'IMG' ||
          style.breakInside === 'avoid' ||
          style.pageBreakInside === 'avoid',
        children: [],
      }
      for (const child of Array.from(el.children)) {
        if (child.hasAttribute('data-lf-spacer')) continue
        const box = child.getBoundingClientRect()
        if (!crossesAny(box.top, box.bottom)) continue
        node.children.push(build(child, box.top, box.bottom))
      }
      return node
    }

    const root: BoxNode = { key: 'body', top: 0, bottom: origin.bottom, keepsTogether: false, children: [] }
    for (const child of Array.from(body.children)) {
      if (child.hasAttribute('data-lf-spacer')) continue
      const box = child.getBoundingClientRect()
      if (!crossesAny(box.top, box.bottom)) continue
      root.children.push(build(child, box.top, box.bottom))
    }
    return { list: crossingsAt(root, breakOffsets), boxes }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, zoom, breakOffsets.join(',')])

  /** Put a field where the caret is. One builder for the panel and the `{{`
   * list, so the two cannot write different markup for the same field. */
  const insertField = (expression: string): void => {
    const body = bodyRef.current
    if (!body) return
    const chip = body.ownerDocument.createElement('span')
    chip.setAttribute('data-jinja-expr', expression)
    chip.textContent = `{{ ${expression} }}`
    prepareFragment(chip)
    insertNodes([chip], body)
  }

  /** Switch a header or footer on or off.
   *
   * The element half happens here, in the live document — so it is one undo
   * step like any other edit, and the canvas is not torn down and rebuilt
   * (which would shut the panel the switch is in). The shell writes the
   * stylesheet half.
   */
  const toggleFurniture = (edge: Edge, on: boolean): void => {
    const body = bodyRef.current
    if (!body) return
    const doc = body.ownerDocument
    // The name the margin box on this edge actually pulls, not the one this
    // editor would have chosen: a template written by hand calls its header
    // whatever it likes, and the switch turns off THAT header.
    const named = [...slotsByName(canvasStyles)].find(([, slot]) => slot.edge === edge)?.[0]
    const name = named ?? RUNNING_NAME[edge]
    const existing = body.querySelector(`[style*="running(${name})"]`)
    if (on && !existing) {
      const holder = doc.createElement('div')
      holder.innerHTML = runningElementHtml(edge)
      const node = holder.firstElementChild
      if (node) {
        prepareFragment(node)
        if (edge === 'top') body.prepend(node)
        else body.append(node)
        // Deliberately NOT selected. Turning a band on is a page-level act, and
        // the switch that does it lives in the page properties — which are what
        // the inspector shows when nothing is selected. Selecting the new
        // element took that panel away under the pointer, height control and
        // all. The band is drawn in its margin and can be clicked like anything
        // else.
      }
    } else if (!on && existing) {
      existing.remove()
      select(null)
    }
    // The rule half, for the stylesheets that live in the BODY — which is this
    // document, not the shell's copy of it. The old header and footer blocks
    // put their @page rule in a <style> here, and the shell rewriting the
    // template text left this one standing: the canvas went on rendering the
    // box, and it came back in the template the moment the canvas reported its
    // next change. The switch then looked as though it had refused.
    if (!on) {
      for (const style of Array.from(body.querySelectorAll('style'))) {
        const cleaned = removeFurnitureBoxFromCss(style.textContent ?? '', edge)
        if (cleaned !== style.textContent) style.textContent = cleaned
      }
    }
    callbacksRef.current.onFurniture?.(edge, on)
    setTick((t) => t + 1)
  }
  furnitureRef.current = toggleFurniture

  // ---- typing a field --------------------------------------------------

  const closeTypeahead = (): void => {
    typeaheadRef.current = null
    setTypeahead(null)
  }

  /** Look behind the caret for `{{` or `/` and offer what could follow it.
   * Called on every input, so it stays cheap and gives up early. */
  const refreshTypeahead = (): void => {
    const body = bodyRef.current
    const doc = body?.ownerDocument
    const selection = doc?.getSelection()
    if (!body || !doc || !selection || selection.rangeCount === 0) return closeTypeahead()
    const range = selection.getRangeAt(0)
    if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) {
      return closeTypeahead()
    }
    const node = range.startContainer as Text
    if (!body.contains(node)) return closeTypeahead()
    const caret = range.startOffset

    /** Where to draw it: measured over the trigger text rather than the caret,
     * because a collapsed range has no reliable rectangle and two characters
     * always do. */
    const show = (trigger: Trigger, rows: { label: string; sample?: string }[]): void => {
      const probe = doc.createRange()
      probe.setStart(node, trigger.start)
      probe.setEnd(node, trigger.end)
      const box = probe.getBoundingClientRect()
      setTypeahead({ left: box.left, top: box.bottom, rows, active: 0 })
    }

    const field = triggerAt(node.data, caret)
    if (field) {
      const rows = rank(fieldsRef.current, field.query)
      if (rows.length > 0) {
        typeaheadRef.current = { kind: 'field', node, trigger: field, rows, active: 0 }
        show(field, rows.map((row) => ({ label: row.label, sample: row.sample })))
        return
      }
    }

    const slash = slashTriggerAt(node.data, caret)
    if (slash) {
      const rows = rankLabels(BLOCKS, slash.query)
      if (rows.length > 0) {
        typeaheadRef.current = { kind: 'block', node, trigger: slash, rows, active: 0 }
        show(slash, rows.map((row) => ({ label: row.label, sample: 'block' })))
        return
      }
    }
    closeTypeahead()
  }

  const moveTypeahead = (by: number): void => {
    const open = typeaheadRef.current
    if (!open) return
    const active = (open.active + by + open.rows.length) % open.rows.length
    open.active = active
    setTypeahead((t) => (t ? { ...t, active } : t))
  }

  /** Take the offer: replace what was typed with what it stood for — a chip for
   * a field, a whole block for `/`. */
  const acceptTypeahead = (index?: number): void => {
    const open = typeaheadRef.current
    const body = bodyRef.current
    if (!open || !body) return
    const doc = body.ownerDocument
    const at = index ?? open.active

    // The typed trigger goes first in both cases: whatever is inserted takes
    // its place, and leaving `/tab` on the page beside a new table is the kind
    // of litter somebody then has to find and delete.
    const range = doc.createRange()
    range.setStart(open.node, open.trigger.start)
    range.setEnd(open.node, Math.min(open.trigger.end, open.node.data.length))
    range.deleteContents()

    if (open.kind === 'block') {
      const chosen = open.rows[at]
      if (!chosen) return closeTypeahead()
      // Put the caret where the trigger was, so the block lands there rather
      // than wherever the selection collapsed to when the text was removed.
      const selection = doc.getSelection()
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      closeTypeahead()
      insertBlockRef.current?.(chosen.id)
      return
    }

    const chosen = open.rows[at]
    if (!chosen?.expression) return closeTypeahead()
    const chip = doc.createElement('span')
    chip.setAttribute('data-jinja-expr', chosen.expression)
    chip.textContent = `{{ ${chosen.expression} }}`
    prepareFragment(chip)
    range.insertNode(chip)
    caretAfter(chip)
    closeTypeahead()
  }

  // ---- the structure panel ------------------------------------------------

  /** Whether a container shows its parts. Told, if it has been told; otherwise
   * open unless it is crowded — a static table of a hundred rows is a haystack,
   * and everything smaller is worth seeing without asking. */
  const outlineIsOpen = (el: HTMLElement, children?: number): boolean => {
    const told = outlineFolds.current.get(el)
    if (told !== undefined) return told
    return (children ?? selectableChildren(el).length) <= CROWDED
  }

  const outline = useMemo(() => {
    const body = bodyRef.current
    if (!body || !inspectorOpen) return { items: [] as OutlineItem[], hidden: 0 }
    return {
      items: outlineOf(body, outlineIsOpen),
      // Read off the document rather than kept beside it: the attribute IS the
      // state, so it cannot drift, and an undo that replaces the body takes the
      // hiding with it instead of leaving a counter behind.
      hidden: body.querySelectorAll('[data-lf-hidden]').length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, selId, inspectorOpen])

  /** Bring an element into view in the canvas. Selecting something from the
   * panel and watching nothing happen — because it is two pages down — reads as
   * a panel that does not work. */
  const revealInCanvas = (el: HTMLElement): void => {
    const scroll = scrollRef.current
    if (!scroll) return
    const box = el.getBoundingClientRect()
    const top = box.top * zoom
    const bottom = box.bottom * zoom
    const margin = 48
    if (top < scroll.scrollTop + margin) {
      scroll.scrollTop = Math.max(0, top - margin)
    } else if (bottom > scroll.scrollTop + scroll.clientHeight - margin) {
      scroll.scrollTop = bottom - scroll.clientHeight + margin
    }
  }

  /** Outline the element a row points at, using the same overlay a hover over
   * the canvas draws — so pointing at a row and pointing at the page say the
   * same thing in the same way. */
  const outlineHover = (el: HTMLElement | null): void => {
    hoverRef.current = el
    if (!el) {
      setHover(null)
      return
    }
    const box = el.getBoundingClientRect()
    setHover({
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      label: KIND_LABEL[kindOf(el)!],
    })
  }

  /** Out of sight, still in the document.
   *
   * `visibility: hidden` rather than `display: none` on purpose: the box keeps
   * its size, so the page breaks stay where the printed ones are and the canvas
   * does not start telling a different story about pagination than the PDF. It
   * is also canvas-only — data-lf-hidden is stripped on export, so nothing here
   * can reach the template or the render. The panel says how many are hidden
   * for exactly that reason: a view state that changes nothing must not look
   * like an edit that changed something. */
  const toggleHidden = (el: HTMLElement): void => {
    if (el.hasAttribute('data-lf-hidden')) el.removeAttribute('data-lf-hidden')
    else el.setAttribute('data-lf-hidden', '')
    setTick((t) => t + 1)
  }

  const showAllHidden = (): void => {
    const body = bodyRef.current
    if (!body) return
    for (const el of Array.from(body.querySelectorAll('[data-lf-hidden]'))) {
      el.removeAttribute('data-lf-hidden')
    }
    setTick((t) => t + 1)
  }

  // Which loops surround the selection. The field list needs it to know that
  // `items[].price` is writable here, and that this loop calls it `row`.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    callbacksRef.current.onScopes?.(scopesAt(selected?.el ?? null, body))
  }, [selId, selected])

  // A selection made in the canvas has to be findable in the panel, which means
  // opening whatever it is buried inside. The panel scrolls to it itself.
  useEffect(() => {
    const body = bodyRef.current
    if (!selected || !body || !inspectorOpen) return
    let changed = false
    for (let p = selected.el.parentElement; p && p !== body; p = p.parentElement) {
      if (outlineFolds.current.get(p) !== true) {
        outlineFolds.current.set(p, true)
        changed = true
      }
    }
    if (changed) setTick((t) => t + 1)
  }, [selId, inspectorOpen, selected])

  /** Begin a gesture: remember what to return to, and hold history open. */
  const beginGesture = (): void => {
    const body = bodyRef.current
    gestureStartRef.current = body ? exportBody(body) : null
    gestureRef.current = true
  }

  /** End it. Kept, the whole gesture becomes one undo step — a drag is one
   * action however many mutations it made, and an undo that lands halfway
   * through a resize reads as a broken program. Abandoned, the document goes
   * back to where the gesture found it, without having needed a step to be
   * recorded first. */
  const endGesture = (keep: boolean): void => {
    if (!gestureRef.current) return
    gestureRef.current = false
    if (keep) commitRef.current?.()
    else restoreSnapshot(gestureStartRef.current)
    gestureStartRef.current = null
    setDrag(null)
    setGuides([])
    setReadout(null)
    setMoveDrop(null)
  }

  const startDrag = (spec: {
    onMove: (e: MouseEvent) => void
    cursor: string
    onEnd?: () => void
  }): void => {
    beginGesture()
    setDrag(spec)
  }

  /** The selected element and everything it sits inside, outermost first. */
  const selectionTrail = (): Element[] => {
    const body = bodyRef.current
    if (!selected || !body || !selected.el.isConnected) return []
    const trail: Element[] = []
    for (let el: Element | null = selected.el; el; el = parentSelectable(el, body)) {
      trail.unshift(el)
    }
    return trail
  }

  /** Put prepared nodes where they can legally go.
   *
   * One function on purpose: this decision existed in two copies — the shell's
   * insert API and the canvas's own Insert menu — and fixing cells in one of
   * them left presets landing beside the table from the other.
   *
   * Inline content goes to the CARET. A field, a QR code, a run of character
   * cells belong in the sentence somebody is writing, and putting them after
   * the paragraph instead — which is what everything used to do, under a panel
   * that said "insert at cursor" — makes the commonest act in the editor
   * impossible: naming a value inside a line of text.
   *
   * Block content still lands beside the selected block. A table dropped into a
   * paragraph is not what anyone meant, and the parser would lift it out again
   * anyway. The choice is made by what is being inserted rather than by which
   * panel asked, so the answer is the same from all of them. */
  const insertNodes = (nodes: Node[], body: HTMLElement): void => {
    const target = body.querySelector('[data-lf-selected]')
    const caret = allInline(nodes) ? caretRangeIn(body) : null
    // Only when the caret is in the thing that is selected: picking a table in
    // the structure panel and inserting a field should not send it to wherever
    // the mouse happened to leave the caret ten minutes ago.
    if (caret && (!target || target.contains(caret.startContainer))) {
      const at = clampOutOfAtomic(caret.cloneRange())
      at.collapse(false)
      const fragment = body.ownerDocument.createDocumentFragment()
      for (const node of nodes) fragment.appendChild(node)
      const last = fragment.lastChild
      at.insertNode(fragment)
      if (last) caretAfter(last)
      return
    }
    if (!target) {
      for (const node of nodes) body.appendChild(node)
      return
    }
    const placement = placementFor(target, 'after')
    // Inside appends in order; after inserts each one directly behind the
    // target, so the last one written has to go first.
    for (const node of placement.where === 'inside' ? nodes : [...nodes].reverse()) {
      place(node, placement)
    }
  }

  /** Carry out what a key press asked for. Shared by the listener inside the
   * canvas document and the one on this document, so the two cannot drift. */
  const applyIntent = (intent: CanvasIntent, body: HTMLElement): void => {
    const doc = body.ownerDocument
    switch (intent.action) {
      case 'select':
        select(intent.el)
        break
      case 'remove': {
        const parent = parentSelectable(intent.el, body)
        intent.el.remove()
        select(parent)
        break
      }
      case 'editExpression': {
        const attr = expressionAttr(intent.el)
        if (attr) setEditingExpr({ el: intent.el, attr })
        break
      }
      case 'placeCaret': {
        // Hand the node to text editing: the caret goes to the end of it, the
        // same place a click inside would have left it. Focus first, since the
        // press may have come from outside the canvas document.
        body.focus()
        const range = doc.createRange()
        range.selectNodeContents(intent.el)
        range.collapse(false)
        const caret = doc.getSelection()
        caret?.removeAllRanges()
        caret?.addRange(range)
        break
      }
    }
  }

  // ---- mount the document once -------------------------------------------
  useEffect(() => {
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!iframe || !doc) return

    doc.open()
    doc.write('<!doctype html><html><head></head><body></body></html>')
    doc.close()

    const style = doc.createElement('style')
    styleElRef.current = style
    // Author CSS first, affordances second, so selection outlines win. The
    // running-element badges come from the author's own @page rules: a footer
    // parked at the top of <body> must read as a footer, not as stray text.
    style.textContent = canvasStyles + CANVAS_AFFORDANCE_CSS
    doc.head.appendChild(style)
    // A second sheet for the header/footer bands: it depends on measurements
    // this one is written before, and changes with the page rather than with
    // the document.
    const bands = doc.createElement('style')
    bandsElRef.current = bands
    doc.head.appendChild(bands)

    const body = doc.body
    // The iframe is same-origin by necessity (the editor reads contentDocument),
    // so a <script> in the template would execute with the editor's privileges.
    // Strip executable markup before it ever reaches the live document.
    const cleaned = sanitizeHtml(initialBody)
    body.innerHTML = cleaned.html
    callbacksRef.current.onSanitized?.(describeRemoved(cleaned.removed))
    prepareBody(body)
    // The printed <body> IS the page area. WeasyPrint spends the @page margins
    // on the page box, so the body box begins inside them — and everything that
    // resolves against the body resolves against the page: an absolutely
    // positioned logo, a percentage width, a `right: 0`.
    //
    // The canvas used to draw the same inset with padding on the body. Content
    // then LOOKED right while the origin for all of that was one margin away,
    // at the corner of the sheet — so a logo dragged into the top-right corner
    // of the canvas printed 18mm further right and 26mm further down, half of it
    // over the edge of the paper. Positioning the body instead makes the two
    // agree by construction rather than by correction.
    //
    // The bottom stays padding: it only has to draw the last page's margin band,
    // and as padding it keeps the body's own height honest for the measurement
    // below. body.style is canvas-only — export is body.innerHTML, never the
    // body element itself.
    insetBody(body, pageBox)
    // Read the margins back in px rather than converting mm/cm/in by hand: the
    // browser already did the conversion when it laid the body out.
    const shown = doc.defaultView?.getComputedStyle(body)
    const insetTop = parseFloat(shown?.top ?? '0') || 0
    setMargins({
      top: insetTop,
      bottom: parseFloat(shown?.paddingBottom ?? '0') || 0,
    })
    bodyRef.current = body
    historyRef.current = new SnapshotHistory(exportBody(body))

    // Selection: nearest structural node under the click; body click clears.
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element
      select(findSelectable(target, body))
      closeTypeahead()
      // A chip is contenteditable="false": clicking one leaves the document
      // with no caret, and every keystroke after that is silently discarded.
      // Give it one, on the side that was clicked, so the text around a field
      // can be written by aiming anywhere near it.
      // Not on the second click of a double click: that one means "edit the
      // expression", and moving the caret under it stops the pair being read
      // as a double click at all.
      const atomic = e.detail < 2 ? target.closest?.(ATOMIC_SELECTOR) : null
      if (atomic && body.contains(atomic)) caretBeside(atomic, e.clientX)
    }
    doc.addEventListener('click', onClick)

    /**
     * Right-click: select what is under the pointer and offer what can be done
     * to it, where the pointer already is.
     *
     * Everything in this menu exists elsewhere — in the properties bar, in the
     * structure panel, behind Alt — and all of it required knowing where to
     * look. A context menu is where people look first, and it is the one place
     * a list of "what applies to THIS" can be shown without a bar of controls
     * that mostly do not.
     *
     * Only over something structural. On bare background the browser's own menu
     * is left alone, because there it still carries spelling suggestions, and
     * replacing those with nothing is a loss.
     */
    const onContextMenu = (e: MouseEvent): void => {
      const under = doc.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element)
      const el = findSelectable(under, body)
      if (!el) return
      e.preventDefault()
      select(el)
      closeTypeahead()
      // The iframe's coordinates are its own and unscaled; the menu is drawn by
      // the host, over everything, so it needs the point in host pixels.
      const frame = iframeRef.current?.getBoundingClientRect()
      setMenu({
        x: (frame?.left ?? 0) + e.clientX * zoomRef.current,
        y: (frame?.top ?? 0) + e.clientY * zoomRef.current,
      })
    }
    doc.addEventListener('contextmenu', onContextMenu)
    // A press anywhere in the page closes it, including the one that lands on
    // whatever the menu was about. Right-click presses too, and its own
    // contextmenu arrives afterwards, so opening still wins.
    const closeMenu = (): void => setMenu(null)
    doc.addEventListener('mousedown', closeMenu)

    // Ctrl+wheel is what every drawing tool has taught people zoom is, and over
    // a page it is the gesture people reach for first. Not passive: the whole
    // point is to stop the browser scaling the application around the page.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoomChoice(clampZoom(zoomRef.current * (1 - e.deltaY / 400)))
    }
    doc.addEventListener('wheel', onWheel, { passive: false })

    /**
     * A file dragged onto the page.
     *
     * The alternative was: find the Assets tab, press Upload, find the file in
     * a dialog, then find where it went. Dropping it is what somebody tries
     * first, and until now the browser answered by navigating the canvas to the
     * image — the document simply disappeared, replaced by a picture.
     *
     * The caret is placed where the file landed before the shell is told, so
     * the image is inserted where it was aimed and not wherever the caret was
     * left. Everything past that point — storage, what markup a file becomes —
     * belongs to the shell.
     */
    const hasFiles = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onDragOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    }
    const onDragLeave = (e: DragEvent): void => {
      // relatedTarget is null when the pointer leaves the document itself; a
      // move between two elements inside it is not a departure.
      if (!e.relatedTarget) setDropping(false)
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDropping(false)
      caretAtPoint(doc, e.clientX, e.clientY)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length > 0) callbacksRef.current.onDropFiles?.(files)
    }
    doc.addEventListener('dragover', onDragOver)
    doc.addEventListener('dragleave', onDragLeave)
    doc.addEventListener('drop', onDrop)

    // `{{` is what somebody writes when they mean a value. In a canvas those
    // would otherwise be two characters that print.
    const onInput = () => refreshTypeahead()
    doc.addEventListener('input', onInput)

    // Double-click a chip / loop / conditional to edit its Jinja expression as
    // text. The attribute is the source of truth restore() reads; the visible
    // chip label is kept in sync for placeholders.
    const onDblClick = (e: MouseEvent) => {
      // By coordinates, not by the event's target. A chip is
      // contenteditable="false" inside a contenteditable body, and a double
      // click on one of those islands is retargeted to the editing host — so
      // the target here is the body, and the chip under the pointer is the one
      // thing the event does not name.
      const under = doc.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element)
      const el = findSelectable(under, body)
      if (!el) return
      const attr = expressionAttr(el)
      if (!attr) return
      e.preventDefault()
      setEditingExpr({ el, attr })
    }
    doc.addEventListener('dblclick', onDblClick)

    // What a click would select, shown before the click. Without it the canvas
    // is a "press and find out" surface, and structural selection is the part
    // people said they could not predict.
    const onPointerMove = (e: MouseEvent) => {
      const found = findSelectable(e.target as Element, body)
      if (found === hoverRef.current) return
      hoverRef.current = found
      if (!found) {
        setHover(null)
        return
      }
      const box = found.getBoundingClientRect()
      setHover({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        label: KIND_LABEL[kindOf(found)!],
      })
    }
    const forgetHover = () => {
      hoverRef.current = null
      setHover(null)
    }
    doc.addEventListener('mousemove', onPointerMove)
    doc.addEventListener('mouseleave', forgetHover)

    // Undo/redo shortcuts; native contenteditable history is unreliable after
    // programmatic mutations, so ours replaces it entirely. Everything else is
    // structural navigation — see keyboard.ts for why it hides behind Alt.
    const onKeydown = (e: KeyboardEvent) => {
      // While the field list is up it owns the arrows and Enter — everything
      // else, including ordinary typing, carries on filtering it.
      if (typeaheadRef.current) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          moveTypeahead(e.key === 'ArrowDown' ? 1 : -1)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          acceptTypeahead()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          closeTypeahead()
          return
        }
      }
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault()
          undo()
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault()
          redo()
        } else if (zoomKey(e.key)) {
          // The editor's own zoom, not the browser's: the browser would scale
          // the whole application, including the panels, which is never what
          // somebody looking closely at a page means.
          e.preventDefault()
        } else if (forwardToApp(e)) {
          e.preventDefault()
        }
        return
      }
      if (e.key === 'Escape' && focusRef.current) {
        e.preventDefault()
        callbacksRef.current.onLeaveFocus?.()
        return
      }
      if (e.key === 'Escape' && menuRef.current) {
        e.preventDefault()
        setMenu(null)
        return
      }
      // Changed your mind halfway through a drag: put it back, without letting
      // go of the mouse first. Checked before anything else, because during a
      // gesture Escape means this and nothing else.
      if (e.key === 'Escape' && gestureRef.current) {
        e.preventDefault()
        endGesture(false)
        return
      }
      // The current selection is read from the DOM, not from React state: this
      // effect runs once, so the state this closure captured is the state at
      // mount — which is null, forever.
      const intent = intentFor(e, body.querySelector('[data-lf-selected]'), body)
      if (!intent) return
      e.preventDefault()
      applyIntent(intent, body)
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
    //
    // Measured from the BODY, and with its bottom padding taken back off.
    // documentElement.scrollHeight is at least the viewport, and the viewport
    // is the iframe height this number decides — so feeding it back added the
    // bottom @page margin to the content on every pass, and pageCountFor turned
    // that into ceil((N*usable + marginBottom) / usable) = N+1. The canvas grew
    // by a page per edit, without a single page break in the document, and
    // leaving visual mode "fixed" it because a remount measures real content.
    const measure = () => {
      const padBottom = parseFloat(
        doc.defaultView?.getComputedStyle(body).paddingBottom ?? '0',
      )
      // The sheet is the top margin plus what the body holds. The body no longer
      // carries the top margin as padding — it is inset by it — so that band is
      // added back here rather than read out of the measurement.
      //
      // The BOX, not scrollHeight: a header or footer is placed in its margin
      // band with an absolute offset, and scrollHeight counts anything hanging
      // outside the box. A footer parked at the foot of page one therefore made
      // the document look a page and a bit long, and the canvas grew a second,
      // empty page to hold it. Out-of-flow children do not add to the box.
      const flow = body.getBoundingClientRect().height
      setFrameHeight(Math.max(insetTop + flow - (padBottom || 0), 200))
    }
    measure()
    measureRef.current = measure

    const observeOpts = { subtree: true, childList: true, characterData: true, attributes: true }
    // Any settled burst of DOM changes: repaginate, re-measure, reposition the
    // toolbar, commit one history snapshot, ship one export. The observer is
    // detached while pagination inserts its canvas-only spacers, so those never
    // loop back in or reach the export (exportBody strips them anyway).
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      observer.disconnect()
      paginate(body, geometryRef.current)
      observer.observe(body, observeOpts)
      measure()
      setTick((t) => t + 1)
      // A gesture holds the history open: a drag is one action however many
      // mutations it makes, and a pause in the middle of it is not a decision
      // to record. It commits once, when the hand lets go.
      if (restoringRef.current || gestureRef.current) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        // Checked again on the way out, not only on the way in: a timer armed
        // just before the gesture began — by the click that selected the thing
        // about to be dragged — would otherwise fire in the middle of it and
        // commit a half-finished state. Undo then went back to a width the drag
        // had merely passed through.
        if (gestureRef.current || restoringRef.current) return
        commitRef.current?.()
      }, 300)
    })

    commitRef.current = () => {
      const snapshot = exportBody(body)
      historyRef.current?.commit(snapshot)
      refreshHistState()
      callbacksRef.current.onChange(snapshot)
    }
    paginate(body, geometryRef.current)
    measure()
    observer.observe(body, observeOpts)
    // The document exists now. Everything derived from it — the structure
    // panel above all — is memoised on this counter, and nothing else will
    // move it until the first edit.
    setTick((t) => t + 1)

    callbacksRef.current.onReady?.({
      insertHtml: (html: string) => {
        const holder = doc.createElement('div')
        holder.innerHTML = html
        // childNodes, not children: bare text is content too, and it used to be
        // dropped on the floor unless the markup held no elements at all.
        const nodes = Array.from(holder.childNodes)
        for (const node of nodes) {
          if (node.nodeType === Node.ELEMENT_NODE) prepareFragment(node as Element)
        }
        if (nodes.length > 0) insertNodes(nodes, body)
      },
      insertBlock: (id: string) => insertBlockRef.current?.(id),
      setFurniture: (edge: Edge, on: boolean) => furnitureRef.current?.(edge, on),
      getBody: () => exportBody(body),
    })

    return () => {
      clearTimeout(timer)
      observer.disconnect()
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('contextmenu', onContextMenu)
      doc.removeEventListener('mousedown', closeMenu)
      doc.removeEventListener('wheel', onWheel)
      doc.removeEventListener('dragover', onDragOver)
      doc.removeEventListener('dragleave', onDragLeave)
      doc.removeEventListener('drop', onDrop)
      doc.removeEventListener('input', onInput)
      doc.removeEventListener('dblclick', onDblClick)
      doc.removeEventListener('mousemove', onPointerMove)
      doc.removeEventListener('mouseleave', forgetHover)
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

  // A change to the page arrives as new CSS. Re-injecting it and re-applying
  // the inset keeps the canvas honest without remounting — which would be a
  // remount per margin nudge, and an undo history thrown away with it.
  useEffect(() => {
    const style = styleElRef.current
    const body = bodyRef.current
    const doc = body?.ownerDocument
    if (!style || !body || !doc) return
    style.textContent = canvasStyles + CANVAS_AFFORDANCE_CSS
    insetBody(body, pageBox)
    const shown = doc.defaultView?.getComputedStyle(body)
    setMargins({
      top: parseFloat(shown?.top ?? '0') || 0,
      bottom: parseFloat(shown?.paddingBottom ?? '0') || 0,
    })
    measureRef.current?.()
    setTick((t) => t + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasStyles])

  // Paginate again once the page is known. At mount the margins have not been
  // measured yet — they are read off the laid-out body, which happens in the
  // same pass — so the first pagination runs against a page with no margins and
  // finds nothing to move. Without this, a document only ever paginated if
  // something else edited it afterwards.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    paginate(body, geometryRef.current)
    measureRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margins.top, margins.bottom, pageHeight])

  // Headers and footers, put in the band they print in. Re-run whenever the
  // document or the page changes: which box pulls which element comes from the
  // stylesheet, and how deep the band is comes from the margins.
  useEffect(() => {
    const body = bodyRef.current
    const bands = bandsElRef.current
    if (!body || !bands) return
    markRunning(body, canvasStyles)
    bands.textContent = runningBoxCss({
      top: margins.top,
      bottom: margins.bottom,
      usable: geometry && canPaginate(geometry) ? usablePageHeight(geometry) : null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasStyles, margins.top, margins.bottom, pageHeight, tick])

  // A press outside the canvas closes the menu too — including on the toolbar
  // above it, which is otherwise the one place a click leaves it standing.
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('.canvas-menu')) setMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  // The same shortcuts, for when focus is in the editor but not in the canvas
  // document — after using the toolbar, say.
  //
  // Without this, Alt+← and Alt+→ reach the browser, where on Windows they are
  // Back and Forward: the editor appeared to jump somewhere else entirely.
  // Handling them here means they are prevented wherever they are pressed, and
  // that the shortcuts work without clicking into the canvas first.
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      // Zoom belongs to the canvas wherever it is pressed from — the toolbar,
      // the structure panel — and it is taken from the browser deliberately.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && zoomKey(e.key)) {
        e.preventDefault()
        return
      }
      // The inspector is a column the author can put away; the page is what
      // they came for.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '.') {
        e.preventDefault()
        setInspectorOpen((on) => !on)
        return
      }
      // Before the guard below: a gesture can be started from a control that
      // holds the focus — scrubbing a spacing box is one — and Escape has to
      // reach it there too.
      if (e.key === 'Escape' && gestureRef.current) {
        e.preventDefault()
        endGesture(false)
        return
      }
      // An open menu takes Escape before the selection does: stepping out of
      // the element while its own menu is still on screen is not what the key
      // was pressed for.
      if (e.key === 'Escape' && menu) {
        e.preventDefault()
        setMenu(null)
        return
      }
      const target = e.target as HTMLElement | null
      // Anything being typed into keeps its own arrows — including the spacing
      // boxes, where up and down nudge a value.
      if (
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      ) {
        return
      }
      const body = bodyRef.current
      if (!body) return
      const intent = intentFor(e, body.querySelector('[data-lf-selected]'), body)
      if (!intent) return
      e.preventDefault()
      applyIntent(intent, body)
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  })

  useEffect(() => {
    const el = canvasBodyRef.current
    if (!el) return
    const measure = (): void => setBodyWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- fit the page into the space there is ------------------------------
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const fit = () => {
      if (pageWidth === null) {
        setFitWidth(1)
        setFitPage(1)
        return
      }
      const byWidth = fitZoom(scroll.clientWidth - CANVAS_GUTTER_PX, pageWidth) / 100
      setFitWidth(byWidth)
      // The whole sheet: the smaller of the two, since a page that fits the
      // width and runs off the bottom is not fitted.
      const byHeight =
        pageHeight === null
          ? byWidth
          : fitZoom(scroll.clientHeight - CANVAS_GUTTER_PX, pageHeight) / 100
      setFitPage(Math.min(byWidth, byHeight))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(scroll)
    return () => ro.disconnect()
  }, [pageWidth, pageHeight])

  // ---- zoom ---------------------------------------------------------------
  //
  // Stops rather than a free percentage for the buttons: the useful sizes are
  // few, and a control that lands on 100% and on half again is worth more than
  // one that can express 87%. Ctrl+wheel is continuous, because a wheel is.
  //
  // Everything here reads the live zoom through the ref and only calls setState
  // — so the canvas document's own listeners, bound once at mount, can call it
  // without holding a zoom from when the page opened.
  const ZOOM_STOPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
  const clampZoom = (value: number): number => Math.min(3, Math.max(0.25, value))

  const zoomStep = (dir: -1 | 1): void => {
    const current = zoomRef.current
    const next =
      dir === 1
        ? ZOOM_STOPS.find((stop) => stop > current + 0.005)
        : [...ZOOM_STOPS].reverse().find((stop) => stop < current - 0.005)
    setZoomChoice(next ?? (dir === 1 ? ZOOM_STOPS[ZOOM_STOPS.length - 1] : ZOOM_STOPS[0]))
  }

  /** True when a key press was a zoom command, so the caller can stop the
   * browser doing its own zoom with the same keys. */
  const zoomKey = (key: string): boolean => {
    if (key === '=' || key === '+') return zoomStep(1), true
    if (key === '-' || key === '_') return zoomStep(-1), true
    // The whole page, which is what "fit" means when a document has more
    // than one screenful of height.
    if (key === '0') return setZoomChoice('page'), true
    return false
  }

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

  /** Through the attribute rather than through el.style: a CSSOM write
   * reserialises the whole attribute from what the parser kept, and takes
   * `position: running(…)` with it — so changing a footer's font used to turn
   * it into an ordinary block. See style-attr.ts. */
  const applyStyle = (prop: string, value: string): void => {
    if (!selected) return
    setDeclaration(selected.el, prop, value.trim() || null)
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
  // The window the canvas document lives in: computed styles have to be read
  // from there, not from this one.
  const canvasWindow = iframeRef.current?.contentWindow ?? null
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
    // All top-level nodes (header/footer carry a <style> plus the div).
    insertNodes(nodes, body)
    // Select the last visible node so the author can edit it immediately.
    select(nodes[nodes.length - 1])
  }
  insertBlockRef.current = insertBlock

  const moveSelected = (dir: -1 | 1) => {
    if (!selected) return
    const el = selected.el
    const sibling = dir === -1 ? el.previousElementSibling : el.nextElementSibling
    if (!sibling) return
    if (dir === -1) sibling.before(el)
    else sibling.after(el)
    setTick((t) => t + 1)
  }

  /** The selectable element around this one, or null at the top. */
  const containerOf = (el: Element): Element | null =>
    bodyRef.current ? parentSelectable(el, bodyRef.current) : null

  /** Run a menu item and put the menu away. Wrapped rather than remembered at
   * each call site, so no item can be added that leaves it standing. */
  const runFromMenu = (run: () => void) => () => {
    setMenu(null)
    run()
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

  /** A merge or a split removes cells and adds them back, so the selection has
   * to be re-established rather than left pointing at something detached. */
  const cellOp = (op: (el: Element) => void) => {
    if (!selected) return
    const cell = selected.el
    op(cell)
    select(cell.isConnected ? cell : null)
    setTick((t) => t + 1)
  }

  /** Which tag a block is, for the style menu. */
  const blockTag = (el: Element): string => el.tagName.toLowerCase()

  /**
   * Turn a paragraph into a heading, or back.
   *
   * A new element carrying the same children and attributes rather than an
   * edit: a tag name is the one thing about an element that cannot be changed,
   * and rebuilding it keeps the inline styles, the Jinja markers and the text
   * — everything a person would be upset to lose by choosing from a menu.
   */
  const retag = (tag: string) => {
    const body = bodyRef.current
    if (!selected || !body || blockTag(selected.el) === tag) return
    const el = selected.el
    const fresh = body.ownerDocument.createElement(tag)
    for (const attr of Array.from(el.attributes)) fresh.setAttribute(attr.name, attr.value)
    while (el.firstChild) fresh.appendChild(el.firstChild)
    el.replaceWith(fresh)
    prepareFragment(fresh)
    select(fresh)
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

  // ---- snapping ----------------------------------------------------------

  /** How near a dragged edge must come before it falls onto a line — in SCREEN
   * pixels, divided by the zoom, so the pull feels identical however far out
   * the sheet is scaled. */
  const SNAP_SCREEN_PX = 5

  /** The lines a drag may land on, gathered once when the gesture starts.
   *
   * Once, because this reads the geometry of every element on the page: doing
   * it per mouse move would force a full layout on each pixel of a drag. They
   * also should not move mid-gesture — a target that shifts while you reach for
   * it is worse than no target. */
  const snapLinesFor = (axis: 'x' | 'y', dragged: Element | null): SnapLine[] => {
    const body = bodyRef.current
    if (!body) return []
    const lines: SnapLine[] = []
    // Sheet coordinates throughout — the guides are drawn over the stage, whose
    // origin is the sheet corner, and the body's own edges ARE the page margins.
    const page = body.getBoundingClientRect()
    if (axis === 'x') {
      lines.push({ at: page.left, kind: 'page' })
      lines.push({ at: page.right, kind: 'page' })
    } else {
      lines.push({ at: margins.top, kind: 'page' })
      // Where each printed page ends: getting flush with a page break is a
      // thing people do deliberately in a form.
      for (const offset of breakOffsets) lines.push({ at: offset, kind: 'page' })
    }
    const rects: Rect[] = []
    for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
      // Its own edges are not something to align to; its ancestors' are — a
      // cell lining up with the table around it is exactly the intent.
      if (el === dragged || dragged?.contains(el)) continue
      if (el.hasAttribute('data-lf-spacer') || !kindOf(el)) continue
      const box = el.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      rects.push({ left: box.left, right: box.right, top: box.top, bottom: box.bottom })
      if (rects.length >= 300) break
    }
    return lines.concat(edgeLines(rects, axis))
  }

  /** Snap one edge, and remember the line to draw. `keepOther` is for a corner
   * drag, where the second axis must not wipe the first axis's guide. */
  const snapEdge = (
    value: number,
    lines: SnapLine[],
    axis: 'x' | 'y',
    altKey: boolean,
    keepOther = false,
  ): number => {
    const { value: snapped, line } = snapTo(value, lines, {
      // Alt turns it off for the duration: the document wins over every helper.
      threshold: altKey ? 0 : SNAP_SCREEN_PX / zoom,
      gridStep: GRID_MINOR_MM * PX_PER_MM,
    })
    const drawn = line ? [{ axis, at: line.at, kind: line.kind }] : []
    setGuides((previous) =>
      keepOther ? previous.filter((g) => g.axis !== axis).concat(drawn) : drawn,
    )
    return snapped
  }

  /** The live figure beside the cursor. Printed work is measured work, and
   * pixels are a unit nobody using this program needs. */
  const readOut = (ev: MouseEvent, text: string): void =>
    setReadout({ left: ev.clientX + 14, top: ev.clientY + 16, text })

  /** Set a size, then close the gap between where the edge was asked to go and
   * where it actually landed.
   *
   * A drag positions an EDGE, and a size written into CSS is not the same
   * quantity: under `content-box` the padding and the border are added on top
   * of it. Reproducing those rules here would mean keeping a copy of the
   * browser's box model in this file; reading where the edge actually went and
   * closing the gap cannot drift from it.
   *
   * It does not always close: inside a table the layout has the last word — a
   * cell cannot push its table past the container's content width, and the
   * cell's own edge stays `border-spacing` inside the table's. That is the box
   * model, not a miss, and the correction leaves it where the layout put it. */
  const settleEdge = (
    el: HTMLElement,
    target: number,
    axis: 'x' | 'y',
    size: number,
    apply: (px: number) => void,
  ): void => {
    apply(Math.round(size))
    const box = el.getBoundingClientRect()
    const residual = target - (axis === 'x' ? box.right : box.bottom)
    if (Math.abs(residual) > 0.5) apply(Math.round(size + residual))
  }

  const startColResize = (e: ReactMouseEvent) => {
    if (!selected) return
    e.preventDefault()
    const cell = selected.el as HTMLElement
    const box = cell.getBoundingClientRect()
    const startX = e.clientX
    const lines = snapLinesFor('x', cell)
    startDrag({
      cursor: 'col-resize',
      onMove: (ev) => {
        // The thing being dragged is the column's right EDGE, so that is what
        // is offered to the page margins and to the columns above it. A width
        // has nothing to line up with.
        const edge = snapEdge(box.right + (ev.clientX - startX) / zoom, lines, 'x', ev.altKey)
        const width = Math.max(8, edge - box.left)
        settleEdge(cell, edge, 'x', width, (px) => setColumnWidth(cell, `${px}px`))
        readOut(ev, `${toMm(width)} mm wide`)
        setTick((t) => t + 1)
      },
    })
  }

  const startRowResize = (e: ReactMouseEvent) => {
    if (!selected) return
    e.preventDefault()
    const cell = selected.el as HTMLElement
    const box = cell.getBoundingClientRect()
    const startY = e.clientY
    const lines = snapLinesFor('y', cell)
    startDrag({
      cursor: 'row-resize',
      onMove: (ev) => {
        const edge = snapEdge(box.bottom + (ev.clientY - startY) / zoom, lines, 'y', ev.altKey)
        const height = Math.max(8, edge - box.top)
        settleEdge(cell, edge, 'y', height, (px) => setRowHeight(cell, `${px}px`))
        readOut(ev, `${toMm(height)} mm tall`)
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
    const box = el.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const linesX = snapLinesFor('x', el)
    const linesY = snapLinesFor('y', el)
    startDrag({
      cursor: 'nwse-resize',
      onMove: (ev) => {
        const right = snapEdge(box.right + (ev.clientX - startX) / zoom, linesX, 'x', ev.altKey)
        const bottom = snapEdge(
          box.bottom + (ev.clientY - startY) / zoom,
          linesY,
          'y',
          ev.altKey,
          true,
        )
        const asked = {
          width: Math.max(8, right - box.left),
          height: Math.max(8, bottom - box.top),
        }
        // Shift keeps the proportion, which for a logo or a stamp is usually
        // the whole point of resizing it carefully.
        const { width, height } = ev.shiftKey
          ? keepRatio(asked.width, asked.height, { width: box.width, height: box.height })
          : asked
        settleEdge(el, box.left + width, 'x', width, (px) => (el.style.width = `${px}px`))
        settleEdge(el, box.top + height, 'y', height, (px) => (el.style.height = `${px}px`))
        readOut(ev, `${toMm(width)} × ${toMm(height)} mm${ev.shiftKey ? ' · proportional' : ''}`)
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
    startDrag({
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
        // Near an edge means beside it; the middle of something that can hold
        // blocks means inside it. Which is also how a block comes back out:
        // aim at the edge of what it is in.
        const at = dropPlacement(target, y, tr)
        dropRef.current = at
        setMoveDrop(at)
        // Read on every move rather than at the start: people press Ctrl once
        // they can see where the thing is going, not before.
        copyRef.current = isDuplicating(ev)
        readOut(ev, copyRef.current ? 'copy here' : 'move here')
      },
      onEnd: () => {
        const d = dropRef.current
        if (d && d.el !== dragged && !dragged.contains(d.el)) {
          if (copyRef.current) {
            const copy = dragged.cloneNode(true) as Element
            // A clone arrives carrying two things it must not keep.
            //
            // The selection marker is an affordance of this editor, and two
            // marked elements would leave the toolbar acting on whichever the
            // query found first.
            //
            // The id is the document's, and it has to be unique: two elements
            // answering to the same one is invalid markup, and a stylesheet
            // rule written for `#total` would quietly apply to both. Dropped
            // rather than renamed — a guessed name would keep the duplicate out
            // of the way while silently losing whatever styling the id carried,
            // where dropping it shows up on the canvas at once. Classes and
            // inline styles come along, which is what most templates style by.
            for (const el of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
              el.removeAttribute('data-lf-selected')
              el.removeAttribute('id')
            }
            place(copy, d)
            select(copy)
          } else {
            place(dragged, d)
          }
        }
        dropRef.current = null
        copyRef.current = false
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
    // Where it sits on the sheet now. `style.left` is relative to whatever
    // positions it; the snap lines are in the canvas's own coordinates, so the
    // move is worked out as a delta between the two.
    const box = el.getBoundingClientRect()
    const linesX = snapLinesFor('x', el)
    const linesY = snapLinesFor('y', el)
    startDrag({
      cursor: 'move',
      onMove: (ev) => {
        // Shift holds it to one axis: nudging something sideways without
        // losing the vertical placement it already had is most of what moving
        // a stamp or a logo is.
        const moved = ev.shiftKey
          ? lockAxis((ev.clientX - startX) / zoom, (ev.clientY - startY) / zoom)
          : { dx: (ev.clientX - startX) / zoom, dy: (ev.clientY - startY) / zoom }
        const left = snapEdge(box.left + moved.dx, linesX, 'x', ev.altKey)
        const top = snapEdge(box.top + moved.dy, linesY, 'y', ev.altKey, true)
        el.style.left = `${Math.round(startLeft + (left - box.left))}px`
        el.style.top = `${Math.round(startTop + (top - box.top))}px`
        readOut(
          ev,
          `${toMm(left)} × ${toMm(top)} mm from the sheet corner${ev.shiftKey ? ' · one axis' : ''}`,
        )
        setTick((t) => t + 1)
      },
    })
  }

  const stageWidth = pageWidth === null ? undefined : pageWidth * zoom

  /**
   * What is selected, and what can be done to it.
   *
   * Rendered here and handed to the inspector rather than lifted out into it:
   * every control below closes over the selection, the live document, the
   * commands and a dozen other things that belong to this component. Moving the
   * markup one column to the right should not cost a second copy of the
   * editor's state to keep in step.
   *
   * With nothing selected it is the PAGE that has properties — size, margins,
   * background, the running head and foot. That is a better answer than an
   * empty bar, and it is the same set of controls the topbar's Page button
   * opens, embedded rather than floated.
   */
  /** What the inspector may take, and what it actually takes. A remembered
   * width from a wider window must not crush the page on a narrower one. */
  const inspectorMax =
    bodyWidth > 0
      ? Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, bodyWidth - CANVAS_MIN_PX))
      : INSPECTOR_MAX
  const inspectorShown = Math.min(inspectorWidth, inspectorMax)
  // Folded by the mode, not instead of the setting: leaving focus mode
  // brings the column back the width it was.
  const inspectorShowing = inspectorOpen && !focusMode

  const renderProperties = (): ReactNode => (
    <div key={selId}>
        {!selected && (
          <span className="muted">
            Nothing selected — click something on the page, or take it from the panel
          </span>
        )}
        {selected && (
          <>
          {/* Where the selection sits in the document, and a way to move
              through it. A single label said what was selected; this says what
              it is INSIDE, which is the question somebody actually has when a
              click lands somewhere unexpected. */}
          <nav className="crumbs" aria-label="Path to the selected element">
            {selectionTrail().map((el, index, all) => (
              <button
                key={index}
                className={index === all.length - 1 ? 'crumb current' : 'crumb'}
                aria-current={index === all.length - 1 ? 'true' : undefined}
                onClick={() => select(el)}
              >
                {KIND_LABEL[kindOf(el)!]}
              </button>
            ))}
          </nav>
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
              aria-label="Font size"
              defaultValue={styleValue('font-size')}
              placeholder="12pt"
              onChange={(e) => applyStyle('font-size', e.target.value)}
            />
          </label>
          {selected.el.hasAttribute(RUNNING_ATTR) && (
            <span className="muted">
              The band is as tall as the page margin — set it in Page. What is
              inside it is edited like anything else.
            </span>
          )}
          {canvasWindow && !selected.el.hasAttribute(RUNNING_ATTR) && (
            <BoxModel
              el={selected.el as HTMLElement}
              view={canvasWindow}
              sizeLabel={{
                width: isCell ? 'Column width' : 'Width',
                height: isCell ? 'Row height' : 'Height',
              }}
              onAdjusting={setAdjusting}
              onGesture={(active) => (active ? beginGesture() : endGesture(true))}
              onApply={(prop, value) => {
                // Width and height on a cell mean the column and the row, so a
                // change grows the whole one rather than one lopsided cell.
                if (prop === 'width') applyWidth(value ?? '')
                else if (prop === 'height') applyHeight(value ?? '')
                else applyStyle(prop, value ?? '')
              }}
            />
          )}
          {canvasWindow && selected.kind !== 'chip' && selected.kind !== 'raw' && (
            <BorderControl
              el={selected.el as HTMLElement}
              view={canvasWindow}
              onChange={() => setTick((t) => t + 1)}
            />
          )}
          {isCell && (
            <label className="prop">
              Align in cell
              <select
                aria-label="Align in cell"
                defaultValue={styleValue('vertical-align') || 'top'}
                onChange={(e) => applyStyle('vertical-align', e.target.value)}
              >
                <option value="top">top</option>
                <option value="middle">middle</option>
                <option value="bottom">bottom</option>
              </select>
            </label>
          )}
          {selected.kind === 'block' && (
            <label className="prop">
              Style
              {/* Named explicitly: a <label> wrapping a <select> takes the
                  chosen option into its accessible name, so "Style" alone would
                  read as "Style Paragraph" and change under the user. */}
              <select
                aria-label="Block style"
                value={blockTag(selected.el)}
                onChange={(e) => retag(e.target.value)}
              >
                <option value="p">Paragraph</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="div">Block</option>
              </select>
            </label>
          )}
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
          {expressionAttr(selected.el) && (
            <button
              className="tb"
              title="Edit the Jinja this element carries"
              onClick={() => setEditingExpr({ el: selected.el, attr: expressionAttr(selected.el)! })}
            >
              Expression…
            </button>
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
                    aria-label="Loop variable name"
                    value={convert.item}
                    onChange={(e) => setConvert({ ...convert, item: e.target.value })}
                  />
                  <span className="cc-label">in</span>
                  <input
                    list="convert-arrays"
                    placeholder="items"
                    aria-label="Array to repeat over"
                    value={convert.value}
                    onChange={(e) => setConvert({ ...convert, value: e.target.value })}
                  />
                  <datalist id="convert-arrays">
                    {arrayHints.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
              {convert.type !== 'repeat' && (
                <input
                  placeholder={convert.type === 'if' ? 'condition' : 'value'}
                  aria-label={convert.type === 'if' ? 'Condition' : 'Value'}
                  value={convert.value}
                  onChange={(e) => setConvert({ ...convert, value: e.target.value })}
                />
              )}
              <button className="tb" onClick={applyConvert}>
                Apply
              </button>
              <button className="tb" aria-label="Cancel the conversion" onClick={() => setConvert(null)}>
                <Icon name="close" size={13} />
              </button>
            </span>
          )}
          </>
        )}
      {!selected && (
        <div className="inspector-page">
          <h3 className="inspector-section">Page</h3>
          <PageSetupPanel
            embedded
            setup={pageSetup}
            overrides={pageOverrides}
            furniture={bands}
            onFurniture={toggleFurniture}
            onChange={(next) => callbacksRef.current.onPageSetup?.(next)}
            onClose={() => undefined}
          />
        </div>
      )}
    </div>
  )

  return (
    <div className="canvas-editor">
      <div className="canvas-topbar">
        {/* The page, from the document's own @page rule — not a view setting.
            The menu that used to be here changed the canvas and left the PDF
            printing something else. */}
        {/* The page's own controls live in the inspector, where they are what
            "properties" means when nothing is selected. This is the way to
            them, not a second copy: a floating card holding the same four
            controls as the column beside it is two things to keep in step and
            two things to close. */}
        <button
          className="tb"
          title="Size, orientation, margins and background of the printed page"
          onClick={() => {
            // Page properties are what the Properties tab shows with nothing
            // selected, so asking for them lets go of the selection.
            select(null)
            setSideTab('properties')
            setInspectorOpen(true)
          }}
        >
          Page: {pageSetup.size || 'A4'}
          {pageSetup.landscape ? ' landscape' : ''}
        </button>
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
        <span className="topbar-group">
          <button
            className={gridPinned ? 'tb active' : 'tb'}
            title={`Millimetre grid (${GRID_MINOR_MM} mm, heavier every ${GRID_MAJOR_MM} mm). Shown while dragging either way.`}
            aria-pressed={gridPinned}
            onClick={() => setGridPinned((on) => !on)}
          >
            Grid
          </button>
          <button
            className={inspectorOpen ? 'tb active' : 'tb'}
            title="The structure of the document, and the fields it can name"
            aria-label="Structure and fields panel"
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorOpen((on) => !on)}
          >
            <Icon name="structure" size={14} />
            Panel
          </button>
        </span>
        {/* The percentage was a read-out of a number nobody could change. It is
            the control now, and pressing it hands the size back to the window. */}
        <span className="topbar-group zoom-group">
          <button className="tb" aria-label="Zoom out" title="Zoom out (Ctrl+−)" onClick={() => zoomStep(-1)}>
            −
          </button>
          <button
            className={
              typeof zoomChoice === 'number' ? 'tb zoom-value' : 'tb zoom-value fitted'
            }
            title="Fit the width of the page to the column"
            onClick={() => setZoomChoice('width')}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button className="tb" aria-label="Zoom in" title="Zoom in (Ctrl++)" onClick={() => zoomStep(1)}>
            +
          </button>
          {/* Two different questions: "can I read this" and "where does the
              page end". A form that fits the width can still run three
              screens deep, and a break you cannot see is a break you find in
              the PDF. */}
          <button
            className={zoomChoice === 'width' ? 'tb active' : 'tb'}
            onClick={() => setZoomChoice('width')}
          >
            Fit width
          </button>
          <button
            className={zoomChoice === 'page' ? 'tb active' : 'tb'}
            title="Show the whole sheet at once (Ctrl+0)"
            onClick={() => setZoomChoice('page')}
          >
            Fit page
          </button>
        </span>
        {/* The shortcuts, on the bar rather than in a disclosure below it —
            26 px of chrome above the page, spent on a summary nobody opened
            twice. Same list, so the hint and the code cannot drift. */}
        <span className="canvas-keys">
          <button
            className={keysOpen ? 'tb active' : 'tb'}
            aria-expanded={keysOpen}
            title="What the keyboard does here"
            onClick={() => setKeysOpen((on) => !on)}
          >
            Keyboard
          </button>
          {keysOpen && (
            <div className="keys-popover" role="dialog" aria-label="Keyboard">
              <dl>
                {[...CANVAS_SHORTCUTS, ...CANVAS_MODIFIERS, ...EDITOR_SHORTCUTS].map(
                  (shortcut) => (
                    <div key={shortcut.keys}>
                      <dt>{shortcut.keys}</dt>
                      <dd>{shortcut.does}</dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          )}
        </span>
      </div>

      {/* A structural selection has no focus ring of its own — the caret stays
          with the text — so what is selected is announced instead. */}
      <p className="sr-only" aria-live="polite">
        {selected ? `${KIND_LABEL[selected.kind]} selected` : 'No element selected'}
      </p>
      {/* Closed by default and reachable by Tab. Shortcuts nobody can discover
          are shortcuts nobody has, and the canvas offers no other hint that
          Alt does anything. */}
      {/* The page and its structure, side by side. The panel points at the
          canvas — it outlines what a row is about — so it must never be drawn
          over the thing it points at. */}
      <div className="canvas-body" ref={canvasBodyRef}>
        {/* The menu is placed in window coordinates, so a scroll would leave it
            hanging over a different element than the one it is about. */}
        <div className="canvas-scroll" ref={scrollRef} onScroll={() => menu && setMenu(null)}>
          <div
            className="canvas-stage"
            style={{ width: stageWidth, height: sheetHeight * zoom }}
          >
            <FurnitureStrip edge="top" boxes={furniture} zoom={zoom} />
            {/* Everything below is positioned in the canvas document's own
                coordinates, so it lives in a box that starts exactly where that
                document starts. It used to sit directly in the stage, which also
                holds the margin-box strips — and a strip is in normal flow, so on
                any template with a running header it pushed the canvas down and
                left every handle and page line drawn that much too high. */}
            <div className="canvas-sheet" style={{ height: sheetHeight * zoom }}>
              <iframe
                ref={iframeRef}
                title="template canvas"
                style={{
                  width: pageWidth ?? '100%',
                  height: sheetHeight,
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                  border: 'none',
                  display: 'block',
                }}
              />
              {/* A drop target that gives no sign it is one cannot be told
                  apart from a page that will refuse the file. */}
              {dropping && (
                <div className="drop-veil" aria-hidden="true">
                  <span>Drop the image where it should go</span>
                </div>
              )}
              {hover && !drag && (
                <div
                  aria-hidden="true"
                  className="hover-outline"
                  style={{
                    left: hover.left * zoom,
                    top: hover.top * zoom,
                    width: hover.width * zoom,
                    height: hover.height * zoom,
                  }}
                >
                  <span>{hover.label}</span>
                </div>
              )}
              {typeahead && (
              <ul
                className="field-typeahead"
                style={{ left: typeahead.left * zoom, top: typeahead.top * zoom }}
              >
                {typeahead.rows.map((row, index) => (
                  <li key={row.label}>
                    <button
                      className={index === typeahead.active ? 'active' : undefined}
                      // The canvas keeps the caret: taking focus here would put
                      // the chip back at wherever the selection collapsed to.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        acceptTypeahead(index)
                      }}
                      onMouseEnter={() => moveTypeahead(index - typeahead.active)}
                    >
                      <span className="field-label">{row.label}</span>
                      {row.sample !== undefined && (
                        <span className="field-sample">{row.sample}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {guides.map((guide, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className={`snap-guide ${guide.kind}`}
                  style={
                    guide.axis === 'x'
                      ? { left: guide.at * zoom, top: 0, height: sheetHeight * zoom, width: 1 }
                      : { top: guide.at * zoom, left: 0, width: (pageWidth ?? 0) * zoom, height: 1 }
                  }
                />
              ))}
              {(gridPinned || !!drag || adjusting) && (
                <div
                  aria-hidden="true"
                  className="canvas-grid"
                  style={
                    {
                      '--grid-minor': `${GRID_MINOR_MM * PX_PER_MM * zoom}px`,
                      '--grid-major': `${GRID_MAJOR_MM * PX_PER_MM * zoom}px`,
                    } as CSSProperties
                  }
                />
              )}
              {/* What each page break passes through. The canvas draws the
                  document as one strip, so without this the line is honest about
                  where the page ends and silent about what that costs. */}
              {pageCrossings.list.map(({ node, boundary, verdict }) => {
                const box = pageCrossings.boxes.get(node.key!)
                if (!box) return null
                return (
                  <div
                    key={node.key}
                    className={`break-warning ${verdict}`}
                    style={{
                      left: box.left * zoom,
                      top: box.top * zoom,
                      width: box.width * zoom,
                      height: box.height * zoom,
                    }}
                  >
                    <span style={{ top: (boundary - box.top) * zoom }}>
                      {VERDICT_LABEL[verdict]}
                    </span>
                  </div>
                )
              })}
              {/* Between two sheets: the footer band of the page above, the
                  paper edge, and the header band of the page below. Real space
                  in the strip rather than a line, so what a header or footer
                  costs on every page is visible on every page. */}
              {edges.map((edge, i) => (
                <div
                  key={i}
                  className="sheet-gap"
                  style={{
                    top: (edge - margins.bottom) * zoom,
                    height: (margins.bottom + margins.top) * zoom,
                    width: (pageWidth ?? 0) * zoom,
                  }}
                >
                  <span className="sheet-band foot" style={{ height: margins.bottom * zoom }}>
                    {bands.bottom ? 'footer' : ''}
                  </span>
                  <span className="sheet-edge">page {i + 2}</span>
                  <span className="sheet-band head" style={{ height: margins.top * zoom }}>
                    {bands.top ? 'header' : ''}
                  </span>
                </div>
              ))}
              {cellRect && (
                <>
                  {/* Pointer-only affordance, hidden from assistive tech on
                      purpose: the same change is reachable from the labelled
                      properties bar above (Col W / Row H / W / H), and choosing
                      which cell to change is a keyboard gesture now too
                      (Alt+arrows, see keyboard.ts). What has no keyboard
                      equivalent is the drag itself. */}
                  {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                  <div
                    aria-hidden="true"
                    className="col-resize"
                    title="Drag to resize column"
                    style={{
                      left: cellRect.right * zoom - 3,
                      top: cellRect.top * zoom,
                      height: cellRect.height * zoom,
                    }}
                    onMouseDown={startColResize}
                  />
                  {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                  <div
                    aria-hidden="true"
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
                  {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                  <div
                    aria-hidden="true"
                    className="img-resize"
                    title="Drag to resize"
                    style={{ left: imgRect.right * zoom - 7, top: imgRect.bottom * zoom - 7 }}
                    onMouseDown={startImageResize}
                  />
                  {positioned && (
                    <div
                      aria-hidden="true"
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
                  // Dropping into a cell is not a line between two things, it is
                  // a place with an inside — so it is drawn as one.
                  return moveDrop.where === 'inside' ? (
                    <div
                      className="drop-inside"
                      style={{
                        left: tr.left * zoom,
                        top: tr.top * zoom,
                        width: tr.width * zoom,
                        height: tr.height * zoom,
                      }}
                    />
                  ) : (
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
            </div>
            <FurnitureStrip edge="bottom" boxes={furniture} zoom={zoom} />
            {drag && (
              // A transient layer that owns the mouse for the duration of a
              // drag; it has no meaning to a screen reader.
              <div
                aria-hidden="true"
                className="drag-overlay"
                style={{ cursor: drag.cursor }}
                onMouseMove={(e) => drag.onMove(e.nativeEvent)}
                onMouseUp={() => {
                  drag.onEnd?.()
                  endGesture(true)
                }}
                onMouseLeave={() => {
                  // The pointer left the sheet mid-drag: keep what was already
                  // applied, but do not complete a pending drop.
                  endGesture(true)
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
                    {isCell && canMergeRight(selected.el) && (
                      <button title="Merge with the cell to the right" onClick={() => cellOp(mergeRight)}>
                        ⇥|
                      </button>
                    )}
                    {isCell && canMergeDown(selected.el) && (
                      <button title="Merge with the cell below" onClick={() => cellOp(mergeDown)}>
                        ⤓|
                      </button>
                    )}
                    {isCell && isMerged(selected.el) && (
                      <button title="Split this merged cell" onClick={() => cellOp(splitCell)}>
                        ⊞
                      </button>
                    )}
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
                <button aria-label="Delete the selected element" title="Delete" onClick={removeSelected}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
            )}
          </div>
        </div>
        {inspectorShowing ? (
          <>
            <Splitter
              value={inspectorShown}
              min={INSPECTOR_MIN}
              max={inspectorMax}
              defaultValue={INSPECTOR_DEFAULT}
              label="Resize the inspector"
              grows="after"
              onChange={setInspectorWidth}
            />
            <InspectorPanel
              width={inspectorShown}
              properties={renderProperties()}
              tab={sideTab}
              onTab={setSideTab}
            fields={fields}
            onInsertField={insertField}
            items={outline.items}
            selected={selected?.el ?? null}
            hiddenCount={outline.hidden}
            isOpen={(el) => outlineIsOpen(el)}
            isHidden={(el) => el.hasAttribute('data-lf-hidden')}
            onHover={outlineHover}
            onSelect={(el) => {
              select(el)
              revealInCanvas(el)
            }}
            onToggleOpen={(el) => {
              outlineFolds.current.set(el, !outlineIsOpen(el))
              setTick((t) => t + 1)
            }}
            onToggleHidden={toggleHidden}
            onShowAll={showAllHidden}
              onClose={() => setInspectorOpen(false)}
            />
          </>
        ) : (
          /* Put away, not gone. The strip is also the way back for anybody
             who does not know the shortcut. */
          <button
            className="pane-strip"
            aria-label="Show the inspector"
            title="Show the inspector (Ctrl + .)"
            onClick={() => setInspectorOpen(true)}
          >
            <span>INSPECTOR</span>
          </button>
        )}
      </div>
      {/* The live figure, in viewport coordinates so it follows the cursor
          rather than the sheet. It says what the drag has reached and, when
          something stopped it, what it landed on — a measurement without a
          reason is only half of what the person needs. */}
      {editingExpr && (
        <ExpressionDialog
          attr={editingExpr.attr}
          value={editingExpr.el.getAttribute(editingExpr.attr) ?? ''}
          fields={fields}
          onSave={(expression) => {
            writeExpression(editingExpr.el, editingExpr.attr, expression)
            setTick((t) => t + 1)
          }}
          onClose={() => setEditingExpr(null)}
        />
      )}
      {/* What can be done to the thing under the pointer, where the pointer is.
          Everything here exists elsewhere too — the properties bar, the
          structure panel, Alt — and all of it had to be looked for. Clamped
          into the window by a rough size rather than measured: a menu that has
          to be drawn before it can be placed flickers, and being a few pixels
          off the corner costs nobody anything. */}
      {menu && selected && (
        <div
          className="canvas-menu"
          role="menu"
          aria-label="What can be done with the selected element"
          style={{
            left: Math.min(menu.x, window.innerWidth - 240),
            top: Math.min(menu.y, window.innerHeight - 280),
          }}
        >
          <span className="canvas-menu-head">{KIND_LABEL[selected.kind]}</span>
          {expressionAttr(selected.el) && (
            <button
              role="menuitem"
              onClick={runFromMenu(() =>
                setEditingExpr({ el: selected.el, attr: expressionAttr(selected.el)! }),
              )}
            >
              Edit expression…
            </button>
          )}
          <button role="menuitem" onClick={runFromMenu(duplicateSelected)}>
            Duplicate
          </button>
          <button role="menuitem" onClick={runFromMenu(() => moveSelected(-1))}>
            Move up
          </button>
          <button role="menuitem" onClick={runFromMenu(() => moveSelected(1))}>
            Move down
          </button>
          {canRepeat && (
            <button
              role="menuitem"
              onClick={runFromMenu(() =>
                setConvert({ type: 'repeat', value: arrayHints[0] ?? 'items', item: 'item' }),
              )}
            >
              Repeat for each…
            </button>
          )}
          {canCondition && (
            <button
              role="menuitem"
              onClick={runFromMenu(() =>
                setConvert({ type: 'if', value: existingValue(selected.el) || 'flag', item: '' }),
              )}
            >
              Show only if…
            </button>
          )}
          <button
            role="menuitem"
            onClick={runFromMenu(() => toggleHidden(selected.el as HTMLElement))}
          >
            {selected.el.hasAttribute('data-lf-hidden') ? 'Show' : 'Hide while editing'}
          </button>
          {containerOf(selected.el) && (
            <button role="menuitem" onClick={runFromMenu(() => select(containerOf(selected.el)))}>
              Select what contains this
            </button>
          )}
          <button className="danger" role="menuitem" onClick={runFromMenu(removeSelected)}>
            Delete
          </button>
        </div>
      )}
      {readout && (
        <div className="drag-readout" style={{ left: readout.left, top: readout.top }}>
          {readout.text}
          {guides.length > 0 && (
            <span className="snapped">
              {' · '}
              {[...new Set(guides.map((guide) => SNAP_LABEL[guide.kind]))].join(' + ')}
            </span>
          )}
        </div>
      )}
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
  // Boxes that pull a running element are not previewed here any more: the
  // element itself is drawn in its band, in the page, where it can be clicked
  // and edited. A grey "⟨element lf-footer⟩" beside the real thing would be a
  // second, worse copy of it.
  const own = boxes.filter((b) => b.edge === edge && !b.runningName)
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
