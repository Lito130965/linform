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
import PlaceholderPanel from './PlaceholderPanel'
import PresetPanel from './PresetPanel'
import PresetDialog from './PresetDialog'
import AssetsPanel from './AssetsPanel'
import type { Preset } from '../presets/registry'
import { parseHints } from '../presets/hints'
import VersionHistory from './VersionHistory'
import CanvasEditor, { type CanvasEditorApi } from '../editor/CanvasEditor'
import { describeRemoved, scanForExecutableMarkup } from '../editor/sanitize'
import AssistantPanel from './AssistantPanel'

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
  scratch = null,
  onExitScratch,
}: {
  code: string
  /** float the assistant and history over the preview instead of giving them a
   * column of their own — below ~1600px a fixed column starves the canvas */
  overlayPanels?: boolean
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
  const [panelTab, setPanelTab] = useState<'placeholders' | 'presets' | 'assets' | 'data'>(
    'placeholders',
  )
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
  const viewRef = useRef<EditorView | null>(null)
  const canvasApiRef = useRef<CanvasEditorApi | null>(null)
  const htmlRef = useRef('')
  // Set on entering Visual: the document scaffolding and <style> the canvas
  // shows read-only but must not let the user edit into the body.
  const splitRef = useRef<{ prefix: string; suffix: string; styles: string } | null>(null)
  const visualInitialRef = useRef('')

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
    setBusy(true)
    setError(null)
    try {
      const draft =
        openDraftId != null
          ? await api.updateDraft(code, openDraftId, html, comment)
          : await api.createDraft(code, html, comment)
      setOpen({ kind: 'draft', id: draft.id })
      await refreshDetail()
      setDirty(false)
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
  const insertPresetSource = (source: string) => {
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

  const enterVisual = () => {
    setError(null)
    const detected = detect(html)
    if (!detected.supported) {
      setError(`Visual mode is unavailable for this template:\n- ${detected.reasons.join('\n- ')}`)
      return
    }
    const split = splitForVisual(html)
    if (!split.ok) {
      setError(`Visual mode is unavailable for this template:\n- ${split.reason}`)
      return
    }
    try {
      visualInitialRef.current = toCanvasAssets(protect(split.body))
    } catch (e) {
      setError((e as Error).message)
      return
    }
    splitRef.current = { prefix: split.prefix, suffix: split.suffix, styles: split.styles }
    setMode('visual')
  }

  const handleVisualChange = (bodyHtml: string) => {
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
    setMode('code')
  }

  useEffect(() => {
    htmlRef.current = html
  }, [html])

  // Assistant status decides whether the feature is shown at all.
  useEffect(() => {
    api.assistantStatus().then(setAssistant).catch(() => setAssistant({ enabled: false, model: null, sends_test_data: false }))
  }, [])

  const applyFromAssistant = (newHtml: string) => {
    if (mode === 'visual') exitVisual()
    // Warn, but do not rewrite: putting a whole document through the DOM would
    // normalize the author's bytes, and preserving them exactly is a promise
    // this project keeps. The canvas is where such markup could actually run,
    // and it strips on entry.
    setSanitizeWarning(describeRemoved(scanForExecutableMarkup(newHtml), false))
    setHtml(newHtml)
    htmlRef.current = newHtml
    setDirty(true)
    setFixError(null)
  }

  const placeholderNames = useMemo(() => {
    const names = new Set<string>()
    for (const m of html.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)) names.add(m[1])
    return [...names]
  }, [html])

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
            <button className="btn primary" onClick={save} disabled={busy || !html.trim()}>
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
              key={open ? (open.kind === 'draft' ? `d${open.id}` : `v${open.version}`) : 'new'}
              initialBody={visualInitialRef.current}
              canvasStyles={splitRef.current?.styles ?? ''}
              arrayHints={parseHints(testData).arrays.map((a) => a.name)}
              onSanitized={setSanitizeWarning}
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
              {(['placeholders', 'presets', 'assets', 'data'] as const).map((t) => (
                <button
                  key={t}
                  className={panelTab === t ? 'panel-tab active' : 'panel-tab'}
                  onClick={() => setPanelTab(t)}
                >
                  {t === 'placeholders'
                    ? 'Placeholders'
                    : t === 'presets'
                      ? 'Presets'
                      : t === 'assets'
                        ? 'Assets'
                        : 'Test data'}
                </button>
              ))}
            </div>
            <div className="panel-body">
              {panelTab === 'placeholders' && (
                <PlaceholderPanel html={html} onInsert={insertPlaceholder} />
              )}
              {panelTab === 'presets' && <PresetPanel onInsert={setPresetFor} />}
              {panelTab === 'assets' && <AssetsPanel onInsert={insertText} />}
              {panelTab === 'data' && (
                <div className="test-data">
                  <label htmlFor="test-data-json">Test data (JSON) — preview renders with it</label>
                  <textarea
                    id="test-data-json"
                    spellCheck={false}
                    value={testData}
                    onChange={(e) => setTestData(e.target.value)}
                  />
                  {parsedData.error && <div className="error-box small">{parsedData.error}</div>}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="pane preview-pane">
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

        {showAssistant && assistant?.enabled && (
          <AssistantPanel
            overlay={overlayPanels}
            status={assistant}
            currentHtml={html}
            placeholders={placeholderNames}
            fixError={fixError}
            onApply={applyFromAssistant}
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
