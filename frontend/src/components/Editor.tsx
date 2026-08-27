import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html as htmlLang } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import { api, AssistantStatus, TemplateDetail } from '../api'
import {
  detect,
  fromCanvasAssets,
  joinFromVisual,
  protect,
  restore,
  splitForVisual,
  toCanvasAssets,
} from '../jinja-bridge'
import PreviewPane from './PreviewPane'
import FieldsPanel from './FieldsPanel'
import InsertPanel from './InsertPanel'
import PresetPanel from './PresetPanel'
import PresetDialog from './PresetDialog'
import AssetsPanel from './AssetsPanel'
import { PRESETS, type Preset } from '../presets/registry'
import { parseHints } from '../presets/hints'
import { BLOCKS } from '../editor/blocks'
import { checkData, fillMissing, generateSample, type SampleResult } from '../editor/sample-data'
import { ensurePageCounterRules, readPageSetup, writePageSetup, type PageSetup } from '../editor/page-css'
import { setFurniture, setFurnitureBox, type Edge } from '../editor/furniture-setup'
import VersionHistory from './VersionHistory'
import CanvasEditor, { type CanvasEditorApi } from '../editor/CanvasEditor'
import { fieldRows, type LoopScope } from '../editor/fields'
import { describeRemoved, scanForExecutableMarkup } from '../editor/sanitize'
import AssistantPanel from './AssistantPanel'
import Splitter from './Splitter'
import Icon from './Icon'
import { useViewportWidth } from '../layout'
import {
  getBoolPref,
  getNumPref,
  setBoolPref,
  setNumPref,
  PREF_PREVIEW_OPEN,
  PREF_PREVIEW_WIDTH,
} from '../prefs'
import { describeOp, type Op } from '../assistant/ops'
import { applyEdit } from '../assistant/edit'

/** The preview's column: its default width, and the narrowest it is worth
 * drawing. Narrower than this and the rendered page is a thumbnail nobody
 * can check anything against. */
const PREVIEW_DEFAULT = 560
const PREVIEW_MIN = 360

const STARTER_TEMPLATE = `<style>
  @page {
    size: A4;
    margin: 20mm 15mm;
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; }
  }
  body { font-family: sans-serif; font-size: 11pt; }
</style>

<h1>{{ title }}</h1>
<p>Hello, {{ name }}!</p>
`

/** An example opened in the editor as a throwaway: fully editable and
 * renderable, but never saved — reload drops it. */
export interface ScratchDoc {
  id: string
  title: string
  html: string
  data: string
}

export default function Editor({
  code,
  overlayPanels = false,
  assets = true,
  scratch = null,
  onExitScratch,
}: {
  code: string
  /** float the assistant and history over the preview instead of giving them a
   * column of their own — below ~1600px a fixed column starves the canvas */
  overlayPanels?: boolean
  /** Whether this instance has asset storage behind it. A demo has the editor
   * and no way to keep anything, and a panel that answers "Not Found" is worse
   * than a panel that is not offered. */
  assets?: boolean
  /** When set, the editor runs in scratch mode: no load from the API, no
   * Save/Publish/History — an example playground that never persists. */
  scratch?: ScratchDoc | null
  onExitScratch?: () => void
}) {
  const isScratch = scratch !== null
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  // What is open. A draft is addressed by id, a published version by number —
  // they are different kinds of thing, so the editor tracks which one it holds
  // rather than pretending both are "a version".
  const [open, setOpen] = useState<
    { kind: 'draft'; id: number } | { kind: 'version'; version: number } | null
  >(null)
  const [html, setHtml] = useState('')
  const [testData, setTestData] = useState('{}')
  const [comment, setComment] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)
  const [presetFor, setPresetFor] = useState<Preset | null>(null)
  const [panelTab, setPanelTab] = useState<'insert' | 'fields' | 'presets' | 'assets' | 'data'>(
    'insert',
  )
  // Loops in force where the caret is, reported by the canvas. They decide
  // whether `items[].price` can be written here, and under what name.
  const [scopes, setScopes] = useState<LoopScope[]>([])
  // Names the template already uses. Extracted server-side so the parsing
  // matches the engine that will render it.
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [panelHeight, setPanelHeight] = useState(220)

  // Drag the panel's top edge to resize it. Bounds keep it from swallowing the
  // editor or vanishing; the value is otherwise the user's to set.
  const startPanelResize = (e: ReactMouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelHeight
    const onMove = (ev: MouseEvent) =>
      setPanelHeight(Math.max(80, Math.min(700, startH + (startY - ev.clientY))))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const [assistant, setAssistant] = useState<AssistantStatus | null>(null)
  const [fixError, setFixError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [sanitizeWarning, setSanitizeWarning] = useState<string | null>(null)
  const [mode, setMode] = useState<'code' | 'visual'>('code')
  // Something that just happened, said briefly and then gone. A save from the
  // keyboard has no other visible effect — the "unsaved" badge simply stops
  // being there, which nobody notices mid-sentence. It floats over the page
  // rather than taking a row in the toolbar: anything that appears above the
  // canvas moves the canvas, and a page that moves under the pointer costs more
  // than the message is worth.
  const [notice, setNotice] = useState<string | null>(null)
  // Bumped when a file arrives by a door other than the Assets panel, so the
  // panel goes and looks again instead of listing what it found on opening.
  const [assetsVersion, setAssetsVersion] = useState(0)
  // Bumped whenever the open document is replaced, so the canvas is rebuilt
  // around the new one instead of going on showing the old.
  const [canvasNonce, setCanvasNonce] = useState(0)

  /**
   * How the width is divided between the page and its preview.
   *
   * Both panes used to be `flex: 1` — an even split with nothing to grab —
   * which is why an A4 page came out at 70 % on a 1920 screen. Where the
   * space goes is the author's business: a form being laid out wants the
   * page, a form being checked wants the render.
   *
   * Below 1600 the preview starts put away rather than squeezing the page to
   * nothing. It is one key press back, and a column too narrow to read is not
   * a kindness.
   */
  const shellWidth = useViewportWidth()
  const maxPreview = Math.max(PREVIEW_MIN, Math.round(shellWidth * 0.6))
  const [previewOpen, setPreviewOpen] = useState(() =>
    getBoolPref(PREF_PREVIEW_OPEN, shellWidth >= 1600),
  )
  const [previewWidth, setPreviewWidth] = useState(() =>
    getNumPref(PREF_PREVIEW_WIDTH, PREVIEW_DEFAULT, PREVIEW_MIN, 2000),
  )
  useEffect(() => setBoolPref(PREF_PREVIEW_OPEN, previewOpen), [previewOpen])
  useEffect(() => setNumPref(PREF_PREVIEW_WIDTH, previewWidth), [previewWidth])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(t)
  }, [notice])

  // Which panels this instance can actually serve. Assets need storage behind
  // them; on a demo the panel would offer an upload button and answer "Not
  // Found", which is a worse welcome than not offering it.
  //
  // Fields live beside the canvas in Visual mode, where they belong next to the
  // structure. Code mode has no such column, so they get a tab here instead —
  // present exactly where they are not a second copy of something.
  const panelTabs = (['insert', 'fields', 'presets', 'assets', 'data'] as const).filter(
    (t) => (t !== 'assets' || assets) && (t !== 'fields' || mode === 'code'),
  )
  useEffect(() => {
    if (!assets && panelTab === 'assets') setPanelTab('insert')
    // Leaving Code mode takes the Fields tab with it.
    if (mode !== 'code' && panelTab === 'fields') setPanelTab('insert')
  }, [assets, panelTab, mode])
  const viewRef = useRef<EditorView | null>(null)
  const canvasApiRef = useRef<CanvasEditorApi | null>(null)
  const htmlRef = useRef('')
  // Set on entering Visual: the document scaffolding and <style> the canvas
  // shows read-only but must not let the user edit into the body.
  const splitRef = useRef<{ prefix: string; suffix: string; styles: string } | null>(null)
  const visualInitialRef = useRef('')
  // Set while the document is being replaced wholesale, and cleared once the
  // canvas that held the previous one is gone — see applyFromAssistant.
  const replacingRef = useRef(false)

  const currentVersion = detail?.current_version ?? null
  const openDraftId = open?.kind === 'draft' ? open.id : null

  const loadVersion = useCallback(
    async (version: number) => {
      const full = await api.getVersion(code, version)
      setHtml(full.html_content)
      setOpen({ kind: 'version', version })
      setDirty(false)
    },
    [code],
  )

  const loadDraft = useCallback(
    async (draftId: number) => {
      const full = await api.getDraft(code, draftId)
      setHtml(full.html_content)
      setComment(full.comment)
      setOpen({ kind: 'draft', id: draftId })
      setDirty(false)
    },
    [code],
  )

  // Initial load: prefer the published version, else the newest, else a starter.
  useEffect(() => {
    // Scratch mode seeds straight from the example — no template to fetch.
    if (scratch) {
      setDetail(null)
      setHtml(scratch.html)
      setTestData(scratch.data)
      setOpen(null)
      setDirty(false)
      return
    }
    api
      .getTemplate(code)
      .then(async (d) => {
        setDetail(d)
        // Unfinished work first: coming back to a draft you left open is the
        // common case. Then whatever consumers currently get, then the newest
        // published version.
        if (d.drafts.length > 0) await loadDraft(d.drafts[0].id)
        else if (d.current_version != null) await loadVersion(d.current_version)
        else if (d.versions.length > 0) await loadVersion(d.versions[0].version)
        else {
          setHtml(STARTER_TEMPLATE)
          setTestData('{\n  "title": "Demo",\n  "name": "world"\n}')
          setOpen(null)
          setDirty(true)
        }
      })
      .catch((e) => setError(e.message))
  }, [code, loadVersion, loadDraft, scratch])

  const refreshDetail = async () => setDetail(await api.getTemplate(code))

  const switchVersion = async (version: number) => {
    if (dirty && !confirm('Discard unsaved changes in the editor?')) return
    setError(null)
    exitVisual()
    try {
      await loadVersion(version)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** The selector holds both kinds, so its value is prefixed: `d12` is a draft
   * id, `v3` a published version number. */
  const openFromSelector = async (value: string) => {
    if (!value) return
    if (dirty && !confirm('Discard unsaved changes in the editor?')) return
    setError(null)
    exitVisual()
    try {
      if (value.startsWith('d')) await loadDraft(Number(value.slice(1)))
      else await loadVersion(Number(value.slice(1)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** Save the working copy. Editing a draft updates it in place; saving while
   * a published version is open starts a NEW draft, because a published
   * version is immutable — that is what makes pinning trustworthy. */
  const save = async () => {
    // The button is disabled in these cases; the shortcut has to say the same
    // thing itself, and saying it out loud beats doing nothing silently.
    if (isScratch) {
      setNotice('This example is a scratch copy — there is nothing to save.')
      return
    }
    if (busy || !currentHtml().trim()) return
    setBusy(true)
    setError(null)
    try {
      const source = currentHtml()
      if (source !== htmlRef.current) {
        htmlRef.current = source
        setHtml(source)
      }
      const draft =
        openDraftId != null
          ? await api.updateDraft(code, openDraftId, source, comment)
          : await api.createDraft(code, source, comment)
      setOpen({ kind: 'draft', id: draft.id })
      await refreshDetail()
      setDirty(false)
      setNotice('Draft saved')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Publish the open draft: it is numbered, frozen, and becomes what
   * consumers get. This is the only way a template becomes renderable. */
  const publish = async () => {
    if (openDraftId == null) return
    setBusy(true)
    setError(null)
    try {
      const published = await api.publishDraft(code, openDraftId)
      setComment('')
      setOpen({ kind: 'version', version: published.version })
      await refreshDetail()
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Point consumers at an already-published version — the rollback. */
  const makeCurrent = async (version: number) => {
    setBusy(true)
    setError(null)
    try {
      await api.setCurrentVersion(code, version)
      await refreshDetail()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const discardDraft = async (draftId: number) => {
    if (
      !confirm(
        'Delete this draft? It was never published, so nothing a consuming application uses is affected.',
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      await api.deleteDraft(code, draftId)
      const fresh = await api.getTemplate(code)
      setDetail(fresh)
      if (openDraftId === draftId) {
        if (fresh.drafts.length > 0) await loadDraft(fresh.drafts[0].id)
        else if (fresh.current_version != null) await loadVersion(fresh.current_version)
        else {
          setHtml(STARTER_TEMPLATE)
          setOpen(null)
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const insertText = (text: string) => {
    if (mode === 'visual') {
      canvasApiRef.current?.insertHtml(toCanvasAssets(text))
      setDirty(true)
      return
    }
    const view = viewRef.current
    if (!view) return
    view.dispatch(view.state.replaceSelection(text))
    view.focus()
    setDirty(true)
  }

  // Placeholders insert as marker chips in Visual (the bridge unfolds them
  // back to {{ … }} on export) and as plain Jinja in Code.
  const insertPlaceholder = (name: string) =>
    insertText(
      mode === 'visual' ? `<span data-jinja-expr="${name}">{{ ${name} }}</span>` : `{{ ${name} }}`,
    )

  // Preset source (from the dialog, configured against test-data hints). Code
  // inserts it raw; Visual inserts its protected form, so the two modes stay
  // provably identical (protect/restore inverse). detect() already guarded the
  // dialog's Insert button, so this cannot corrupt the canvas silently.
  /** A page number is an empty span plus a rule that fills it. The span goes
   * where the caret is; the rule has to be in the stylesheet, so it is written
   * the same way the page setup is — to the source, once. */
  const ensureCounterRules = () => {
    const current = currentHtml()
    const next = ensurePageCounterRules(current)
    if (next === current) return
    const split = splitForVisual(next)
    if (split.ok) splitRef.current = { prefix: split.prefix, suffix: split.suffix, styles: split.styles }
    htmlRef.current = next
    setHtml(next)
  }

  const insertPresetSource = (source: string) => {
    if (source.includes('lf-page-no') || source.includes('lf-page-count')) ensureCounterRules()
    if (mode !== 'visual') {
      insertText(source)
      return
    }
    try {
      canvasApiRef.current?.insertHtml(toCanvasAssets(protect(source)))
      setDirty(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // One assembly of the field list. The panel lists it and the canvas offers it
  // behind `{{` — two assemblies would be two lists that one day disagree.
  const fields = useMemo(() => fieldRows(testData, placeholders, scopes), [
    testData,
    placeholders,
    scopes,
  ])

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

  // What the last generate did, so the panel can say it rather than leaving
  // somebody to diff two blobs of JSON by eye.
  const [sampleNote, setSampleNote] = useState<string | null>(null)

  const applySample = (result: SampleResult) => {
    setTestData(result.json)
    setSampleNote(
      result.added.length === 0
        ? 'Nothing missing — the payload already covers every value the template names.'
        : `Added ${result.added.length}: ${result.added.slice(0, 6).join(', ')}${
            result.added.length > 6 ? '…' : ''
          }`,
    )
  }

  /** The page changed. It lives in the template's own stylesheet, so this is a
   * source edit like any other — and the canvas is told about it by handing it
   * the new CSS, not by being rebuilt. */
  const applyPageSetup = (setup: PageSetup) => {
    const next = writePageSetup(currentHtml(), setup)
    const split = splitForVisual(next)
    if (split.ok) splitRef.current = { prefix: split.prefix, suffix: split.suffix, styles: split.styles }
    htmlRef.current = next
    setHtml(next)
    setDirty(true)
  }

  /** A header or footer switched on or off.
   *
   * Only the stylesheet half — the margin box that pulls the element. The
   * canvas has already put the element in the body, or taken it out, because
   * that half is a document edit and the canvas is where the document lives:
   * rewriting the body from here would rebuild the canvas and shut the panel
   * the switch is in. See furniture-setup.ts for why both halves are needed.
   */
  const applyFurniture = (edge: Edge, on: boolean) => {
    const next = setFurnitureBox(currentHtml(), edge, on)
    const split = splitForVisual(next)
    if (split.ok) splitRef.current = { prefix: split.prefix, suffix: split.suffix, styles: split.styles }
    htmlRef.current = next
    setHtml(next)
    setDirty(true)
  }

  /**
   * Files dropped on the page. The canvas has already put the caret where they
   * landed; this half is storage, which the canvas knows nothing about.
   *
   * Images only, and said out loud when it is not one — a PDF dropped on a
   * template has no meaning here, and silence would read as a broken editor
   * rather than as a refusal.
   */
  const dropFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      setNotice('Only images can be dropped on the page.')
      return
    }
    if (!assets) {
      setNotice('This instance keeps no assets, so there is nowhere to put a dropped file.')
      return
    }
    setBusy(true)
    try {
      for (const file of images) {
        const asset = await api.uploadAsset(file)
        insertText(`<img src="${asset.url}" alt="${asset.filename}">`)
      }
      // The Assets tab lists what it found when it opened; a file that arrived
      // by another door has to be worth finding there too.
      setAssetsVersion((v) => v + 1)
      setNotice(images.length === 1 ? `Placed ${images[0].name}` : `Placed ${images.length} images`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Do what the assistant asked for, through the editor's own operations.
   *
   * Every branch here is the function a panel calls: the page control's writer,
   * the header switch, the palette's insert, the preset dialog's generator. So
   * the result is not "markup a model wrote that resembles a footer" but the
   * footer this editor makes — selectable, movable, and understood by the
   * panels afterwards. It is also one step in the same undo history as any
   * hand edit.
   */
  const applyOps = (ops: Op[]): boolean => {
    // Edits first, and on their own. Each is text work over the document,
    // applied one after another so a second edit sees the result of the
    // first, and the whole lot lands as one replacement.
    const edits = ops.filter((op): op is Extract<Op, { op: 'edit' }> => op.op === 'edit')
    const rest = ops.filter((op) => op.op !== 'edit')
    if (edits.length > 0) {
      let source = currentHtml()
      const refused: string[] = []
      for (const edit of edits) {
        const result = applyEdit(source, edit.find, edit.replace)
        if ('error' in result) refused.push(result.error)
        else source = result.html
      }
      const changed = source !== currentHtml()
      if (changed) replaceDocument(source)
      // Said, never swallowed: an edit that matched nothing and a document
      // that did not change look identical from the outside.
      if (refused.length > 0) setError(`Not changed:\n- ${refused.join('\n- ')}`)
      if (rest.length > 0) {
        // The document has just been rebuilt underneath them, so the caret
        // they would insert at no longer exists.
        setNotice(`${rest.length} further operation(s) were not run — ask again`)
        return changed
      }
      if (refused.length === 0) {
        setNotice(edits.length === 1 ? describeOp(edits[0]) : `Applied ${edits.length} changes`)
      }
      return changed
    }
    for (const op of ops) {
      if (op.op === 'page') {
        // Merged onto what the document already says: an operation names the
        // one thing it changes, and everything else about the page stays.
        const current = readPageSetup(currentHtml())
        applyPageSetup({
          ...current,
          ...(op.size !== undefined ? { size: op.size } : {}),
          ...(op.landscape !== undefined ? { landscape: op.landscape } : {}),
          ...(op.background !== undefined ? { background: op.background } : {}),
          margin: { ...current.margin, ...(op.margin ?? {}) },
        })
      } else if (op.op === 'furniture') {
        if (mode === 'visual') canvasApiRef.current?.setFurniture(op.edge, op.on)
        else {
          // No canvas to hold the element half, so both halves are written to
          // the source here.
          const next = setFurniture(currentHtml(), op.edge, op.on)
          htmlRef.current = next
          setHtml(next)
          setDirty(true)
        }
      } else if (op.op === 'block') {
        insertBlock(op.id)
      } else if (op.op === 'preset') {
        const preset = PRESETS.find((p) => p.id === op.id)
        if (preset) insertPresetSource(preset.generate(op.params ?? {}))
      } else if (op.op === 'field') {
        insertPlaceholder(op.expression)
      }
    }
    setNotice(ops.length === 1 ? describeOp(ops[0]) : `Applied ${ops.length} changes`)
    return ops.length > 0
  }

  const insertBlock = (id: string) => {
    if (mode === 'visual') {
      canvasApiRef.current?.insertBlock(id)
      setDirty(true)
      return
    }
    const block = BLOCKS.find((b) => b.id === id)
    if (block) insertText(block.content)
  }

  /** Prepare the canvas for a document and show it, or say why it cannot be
   * shown. Separate from the Visual button because the same steps run when a
   * document is REPLACED under an open canvas, and that path has to rebuild
   * the canvas rather than leave it holding the document before. */
  const openInVisual = (source: string, complain = true): boolean => {
    const detected = detect(source)
    if (!detected.supported) {
      if (complain) {
        setError(
          `Visual mode is unavailable for this template:\n- ${detected.reasons.join('\n- ')}`,
        )
      }
      return false
    }
    const split = splitForVisual(source)
    if (!split.ok) {
      if (complain) setError(`Visual mode is unavailable for this template:\n- ${split.reason}`)
      return false
    }
    try {
      visualInitialRef.current = toCanvasAssets(protect(split.body))
    } catch (e) {
      if (complain) setError((e as Error).message)
      return false
    }
    splitRef.current = { prefix: split.prefix, suffix: split.suffix, styles: split.styles }
    setMode('visual')
    // A new document needs a new canvas: the body is written at mount and
    // never again, so without this the previous page stays on screen.
    setCanvasNonce((n) => n + 1)
    return true
  }

  const enterVisual = () => {
    setError(null)
    openInVisual(html)
  }

  const handleVisualChange = (bodyHtml: string) => {
    // A report from a canvas whose document has just been replaced is a report
    // about the document that WAS open. Writing it back would undo the
    // replacement, silently and completely.
    if (replacingRef.current) return
    const split = splitRef.current
    if (!split) return
    try {
      const restored = joinFromVisual(split.prefix, restore(fromCanvasAssets(bodyHtml)), split.suffix)
      if (restored !== htmlRef.current) {
        htmlRef.current = restored
        setHtml(restored)
        setDirty(true)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const exitVisual = () => {
    canvasApiRef.current = null
    setScopes([])
    setMode('code')
  }

  /** The document as it is on screen *right now*.
   *
   * In visual mode the canvas reports its changes on a debounce, so `html` can
   * be a fraction of a second behind what the user is looking at — and a save
   * inside that window writes the document as it was a moment ago, silently
   * dropping the last edit. Nobody noticed because every path that saved went
   * through Code mode first, and leaving the canvas flushes it.
   *
   * In code mode the state is the document, so there is nothing to ask. */
  const currentHtml = (): string => {
    const body = mode === 'visual' ? canvasApiRef.current?.getBody() : null
    const split = splitRef.current
    if (!body || !split) return html
    return joinFromVisual(split.prefix, restore(fromCanvasAssets(body)), split.suffix)
  }

  useEffect(() => {
    htmlRef.current = html
  }, [html])

  // The canvas has unmounted by the time this runs — its cleanup belongs to the
  // same commit and runs first — so no further report from it can arrive.
  // Keyed on the nonce too: replacing the document while staying in Visual
  // swaps one canvas for another without the mode changing at all.
  useEffect(() => {
    replacingRef.current = false
  }, [mode, canvasNonce])

  // Ctrl+S saves the draft from wherever the focus is — including inside the
  // canvas, which re-dispatches the shortcuts it does not use itself. Bound
  // once and reading the current save through a ref: rebinding the listener on
  // every keystroke is churn nobody can see and everybody pays for.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (e.key === '\\') {
        // The preview is half the window; being able to put it away in one
        // press is what makes giving it that much space reasonable.
        e.preventDefault()
        setPreviewOpen((on) => !on)
        return
      }
      if (e.key.toLowerCase() !== 's') return
      // Whatever else happens, not the browser's "save this page as".
      e.preventDefault()
      void saveRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Assistant status decides whether the feature is shown at all.
  useEffect(() => {
    api.assistantStatus().then(setAssistant).catch(() => setAssistant({ enabled: false, model: null, sends_test_data: false }))
  }, [])

  /**
   * Put a whole document in place of the one that is open.
   *
   * Used both ways: an assistant's template lands here, and so does an undo of
   * it. Where the canvas is open the document is reopened IN the canvas rather
   * than dropping the user into Code: a change you have to go and look for in
   * another mode is a change you cannot judge.
   *
   * The guard is not optional. Rebuilding or leaving the canvas unmounts it,
   * and the canvas flushes its body on the way out. That flush carries the
   * document that WAS open, lands after this has written the new one, and puts
   * the old one straight back without a word.
   */
  const replaceDocument = (nextHtml: string) => {
    replacingRef.current = true
    // Warn, but do not rewrite: putting a whole document through the DOM would
    // normalize the author's bytes, and preserving them exactly is a promise
    // this project keeps. The canvas is where such markup could actually run,
    // and it strips on entry.
    setSanitizeWarning(describeRemoved(scanForExecutableMarkup(nextHtml), false))
    setHtml(nextHtml)
    htmlRef.current = nextHtml
    setDirty(true)
    setFixError(null)
    // Only try the canvas if that is where the user already was. Quietly:
    // the caveats beside the message already say what a code-only template
    // costs, and a red box on top of that is the same thing said twice.
    if (mode === 'visual' && !openInVisual(nextHtml, false)) exitVisual()
  }

  const placeholderNames = useMemo(() => {
    const names = new Set<string>()
    for (const m of html.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)) names.add(m[1])
    return [...names]
  }, [html])

  // Recomputed as either side is edited — it is string work over a template
  // and a payload, and both are already in hand.
  const dataCheck = useMemo(() => checkData(html, testData), [html, testData])

  const parsedData = useMemo<{ data: Record<string, unknown> | null; error: string | null }>(() => {
    try {
      const value = JSON.parse(testData)
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return { data: null, error: 'Test data must be a JSON object' }
      return { data: value, error: null }
    } catch (e) {
      return { data: null, error: `Invalid JSON: ${(e as Error).message}` }
    }
  }, [testData])

  return (
    <div className="editor">
      <header className="toolbar">
        <div className="template-title">
          <strong>{isScratch ? scratch!.title : (detail?.name ?? code)}</strong>
          {isScratch ? (
            <span className="template-code example-badge">example · not saved</span>
          ) : (
            <span className="template-code">{code}</span>
          )}
        </div>

        <div className="mode-toggle">
          <button
            className={mode === 'code' ? 'btn mode active' : 'btn mode'}
            onClick={exitVisual}
          >
            Code
          </button>
          <button
            className={mode === 'visual' ? 'btn mode active' : 'btn mode'}
            onClick={enterVisual}
            title="Visual editing (templates with macros or complex Jinja stay code-only)"
          >
            Visual
          </button>
        </div>

        {isScratch ? (
          <button className="btn" onClick={onExitScratch}>
            ← Back to examples
          </button>
        ) : (
          <>
            {/* Drafts and versions are listed apart: one is work in progress,
                the other is what consuming applications can render. */}
            <select
              aria-label="Open draft or published version"
              value={open ? (open.kind === 'draft' ? `d${open.id}` : `v${open.version}`) : ''}
              onChange={(e) => openFromSelector(e.target.value)}
            >
              {!open && <option value="">nothing open</option>}
              {detail && detail.drafts.length > 0 && (
                <optgroup label="Drafts (not published)">
                  {detail.drafts.map((d) => (
                    <option key={`d${d.id}`} value={`d${d.id}`}>
                      draft{d.comment ? ` · ${d.comment.slice(0, 40)}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {detail && detail.versions.length > 0 && (
                <optgroup label="Published versions">
                  {detail.versions.map((v) => (
                    <option key={`v${v.version}`} value={`v${v.version}`}>
                      v{v.version}
                      {v.version === currentVersion ? ' · current' : ''}
                      {v.comment ? ` · ${v.comment.slice(0, 40)}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <input
              className="comment-input"
              placeholder="What changed? (like a commit message)"
              aria-label="Draft comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button
              className="btn primary"
              onClick={save}
              disabled={busy || !html.trim()}
              title="Save the working copy as a draft (Ctrl+S)"
            >
              {openDraftId != null ? 'Save draft' : 'Save as draft'}
            </button>
            <button
              className="btn publish"
              onClick={publish}
              disabled={busy || openDraftId == null || dirty}
              title={
                openDraftId == null
                  ? 'Only a draft can be published — save your changes first'
                  : dirty
                    ? 'Save the draft before publishing it'
                    : 'Publish this draft: it gets a version number and becomes what consumers render'
              }
            >
              Publish
            </button>
            <button className="btn" onClick={() => setShowHistory(!showHistory)}>
              History
            </button>
          </>
        )}
        {assistant?.enabled && (
          <button
            className={showAssistant ? 'btn mode active' : 'btn'}
            onClick={() => setShowAssistant(!showAssistant)}
            title={`AI assistant (${assistant.model})`}
          >
            ✨ Assistant
          </button>
        )}
        {!isScratch && dirty && <span className="dirty-badge">unsaved</span>}
        {/* Pushed to the end of the row: it is about the window rather than
            about the document, and the two should not read as one list. */}
        <button
          className={previewOpen ? 'btn icon-btn active' : 'btn icon-btn'}
          aria-label="Show or hide the preview"
          aria-pressed={previewOpen}
          title="Show or hide the preview (Ctrl + \)"
          onClick={() => setPreviewOpen((on) => !on)}
        >
          <Icon name="panel-right" />
        </button>
      </header>

      {error && <div className="error-box">{error}</div>}
      {sanitizeWarning && (
        <div className="warn-box">
          {sanitizeWarning}
          <button className="btn small" onClick={() => setSanitizeWarning(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="workspace">
        <section className="pane code-pane">
          {mode === 'code' ? (
            <CodeMirror
              value={html}
              height="100%"
              theme="dark"
              extensions={[
                htmlLang(),
                // CodeMirror renders a contenteditable div, which is an ARIA
                // textbox: without this it reaches a screen reader unnamed.
                EditorView.contentAttributes.of({ 'aria-label': 'Template HTML source' }),
              ]}
              onChange={(value) => {
                setHtml(value)
                setDirty(true)
              }}
              onCreateEditor={(view) => {
                viewRef.current = view
              }}
            />
          ) : (
            <CanvasEditor
              key={`${open ? (open.kind === 'draft' ? `d${open.id}` : `v${open.version}`) : 'new'}:${canvasNonce}`}
              initialBody={visualInitialRef.current}
              canvasStyles={splitRef.current?.styles ?? ''}
              arrayHints={parseHints(testData).arrays.map((a) => a.name)}
              onSanitized={setSanitizeWarning}
              compact={overlayPanels}
              fields={fields}
              onPageSetup={applyPageSetup}
              onFurniture={applyFurniture}
              onDropFiles={dropFiles}
              onScopes={setScopes}
              onChange={handleVisualChange}
              onReady={(api) => {
                canvasApiRef.current = api
              }}
            />
          )}
          <div className="bottom-panels" style={{ maxHeight: panelHeight, height: panelHeight }}>
            <div
              className="panel-resize"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the bottom panel"
              aria-valuenow={panelHeight}
              aria-valuemin={80}
              aria-valuemax={700}
              tabIndex={0}
              onMouseDown={startPanelResize}
              onKeyDown={(e) => {
                // Keyboard equivalent of the drag, so the panel is not
                // mouse-only. 24px a step, the same feel as dragging.
                if (e.key === 'ArrowUp') setPanelHeight((h) => Math.min(700, h + 24))
                else if (e.key === 'ArrowDown') setPanelHeight((h) => Math.max(80, h - 24))
                else return
                e.preventDefault()
              }}
              title="Drag to resize"
            />
            <div className="panel-tabs">
              {panelTabs.map((t) => (
                <button
                  key={t}
                  className={panelTab === t ? 'panel-tab active' : 'panel-tab'}
                  onClick={() => setPanelTab(t)}
                >
                  {t === 'insert'
                    ? 'Insert'
                    : t === 'fields'
                      ? 'Fields'
                    : t === 'presets'
                      ? 'Presets'
                      : t === 'assets'
                        ? 'Assets'
                        : 'Test data'}
                </button>
              ))}
            </div>
            <div className="panel-body">
              {panelTab === 'insert' && <InsertPanel onInsert={insertBlock} />}
              {panelTab === 'fields' && (
                <FieldsPanel rows={fields} onInsert={insertPlaceholder} />
              )}
              {panelTab === 'presets' && <PresetPanel onInsert={setPresetFor} />}
              {panelTab === 'assets' && <AssetsPanel key={assetsVersion} onInsert={insertText} />}
              {panelTab === 'data' && (
                <div className="test-data">
                  <div className="test-data-head">
                    <label htmlFor="test-data-json">
                      Test data (JSON) — preview renders with it
                    </label>
                    {/* Made from the template, not the other way round: the
                        fields go on the page first and the payload follows. Two
                        buttons because they answer different questions — start
                        again, or keep what has been adjusted and catch up. */}
                    <span className="test-data-actions">
                      <button
                        className="btn small"
                        title="Replace this with a fresh sample built from every value the template names"
                        onClick={() => applySample(generateSample(currentHtml()))}
                      >
                        Generate
                      </button>
                      <button
                        className="btn small"
                        title="Keep what is here and add the values the template names that are missing"
                        onClick={() => applySample(fillMissing(currentHtml(), testData))}
                      >
                        Fill in missing
                      </button>
                    </span>
                  </div>
                  <textarea
                    id="test-data-json"
                    spellCheck={false}
                    value={testData}
                    onChange={(e) => setTestData(e.target.value)}
                  />
                  {sampleNote && <p className="muted small">{sampleNote}</p>}
                  {parsedData.error && <div className="error-box small">{parsedData.error}</div>}
                  {/* Both directions, because both fail quietly: a value the
                      data does not carry renders as a blank that reads as a
                      layout problem, and a spare one is usually a field renamed
                      on one side only. Neither shows up in a preview as
                      anything but "hmm". */}
                  {dataCheck && (
                    <div className="data-check">
                      {dataCheck.missing.length > 0 && (
                        <p className="warn">
                          <strong>{dataCheck.missing.length}</strong> named by the template, not in
                          the data: <code>{dataCheck.missing.slice(0, 8).join(', ')}</code>
                          {dataCheck.missing.length > 8 && ' …'}
                        </p>
                      )}
                      {dataCheck.unused.length > 0 && (
                        <p className="muted small">
                          <strong>{dataCheck.unused.length}</strong> in the data the template never
                          reads: <code>{dataCheck.unused.slice(0, 8).join(', ')}</code>
                          {dataCheck.unused.length > 8 && ' …'}
                        </p>
                      )}
                      {dataCheck.missing.length === 0 && dataCheck.unused.length === 0 && (
                        <p className="muted small">
                          The data covers everything the template names, and nothing else.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {previewOpen ? (
          <>
            <Splitter
              value={previewWidth}
              min={PREVIEW_MIN}
              max={maxPreview}
              defaultValue={PREVIEW_DEFAULT}
              label="Resize the preview"
              grows="after"
              onChange={setPreviewWidth}
            />
            <section
              className="pane preview-pane"
              style={{ width: Math.min(previewWidth, maxPreview) }}
            >
              <PreviewPane
                html={html}
                data={parsedData.data}
                onError={setPreviewError}
                fixWithAi={
                  assistant?.enabled
                    ? () => {
                        setFixError(previewError)
                        setShowAssistant(true)
                      }
                    : undefined
                }
              />
            </section>
          </>
        ) : (
          /* Put away, not gone: a strip that says what is behind it and
             brings it back. A panel that vanishes without trace is a
             feature the next person does not know exists. */
          <button
            className="pane-strip"
            aria-label="Show the preview"
            title="Show the preview (Ctrl + \)"
            onClick={() => setPreviewOpen(true)}
          >
            <span>PREVIEW</span>
          </button>
        )}

        {showAssistant && assistant?.enabled && (
          <AssistantPanel
            overlay={overlayPanels}
            status={assistant}
            currentHtml={html}
            placeholders={placeholderNames}
            fixError={fixError}
            currentDocument={currentHtml}
            onReplaceDocument={replaceDocument}
            onApplyOps={applyOps}
            onClose={() => setShowAssistant(false)}
          />
        )}

        {showHistory && detail && (
          <VersionHistory
            overlay={overlayPanels}
            code={code}
            versions={detail.versions}
            drafts={detail.drafts}
            currentVersion={currentVersion}
            openDraftId={openDraftId}
            openVersion={open?.kind === 'version' ? open.version : null}
            editorHtml={html}
            onOpenVersion={(v) => switchVersion(v)}
            onOpenDraft={(id) => openFromSelector(`d${id}`)}
            onMakeCurrent={(v) => makeCurrent(v)}
            onDeleteDraft={(id) => discardDraft(id)}
            onClose={() => setShowHistory(false)}
          />
        )}

        {/* role=status, not alert: this is confirmation of something the user
            just did, and an alert would interrupt a screen reader mid-word. */}
        {notice && (
          <div className="toast" role="status">
            {notice}
          </div>
        )}

        {presetFor && (
          <PresetDialog
            preset={presetFor}
            placeholders={placeholderNames}
            testData={testData}
            onInsert={insertPresetSource}
            onClose={() => setPresetFor(null)}
          />
        )}
      </div>
    </div>
  )
}
