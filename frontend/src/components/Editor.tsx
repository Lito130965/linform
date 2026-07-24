import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html as htmlLang } from '@codemirror/lang-html'
import type { EditorView } from '@codemirror/view'
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
import AssetsPanel from './AssetsPanel'
import type { Preset } from '../presets/registry'
import VersionHistory from './VersionHistory'
import CanvasEditor, { type CanvasEditorApi } from '../editor/CanvasEditor'
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

export default function Editor({
  code,
  overlayPanels = false,
}: {
  code: string
  /** float the assistant and history over the preview instead of giving them a
   * column of their own — below ~1600px a fixed column starves the canvas */
  overlayPanels?: boolean
}) {
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)
  const [html, setHtml] = useState('')
  const [testData, setTestData] = useState('{}')
  const [comment, setComment] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)
  const [assistant, setAssistant] = useState<AssistantStatus | null>(null)
  const [fixError, setFixError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [mode, setMode] = useState<'code' | 'visual'>('code')
  const viewRef = useRef<EditorView | null>(null)
  const canvasApiRef = useRef<CanvasEditorApi | null>(null)
  const htmlRef = useRef('')
  // Set on entering Visual: the document scaffolding and <style> the canvas
  // shows read-only but must not let the user edit into the body.
  const splitRef = useRef<{ prefix: string; suffix: string; styles: string } | null>(null)
  const visualInitialRef = useRef('')

  const publishedVersion = detail?.versions.find((v) => v.status === 'published')?.version ?? null

  const loadVersion = useCallback(
    async (version: number) => {
      const full = await api.getVersion(code, version)
      setHtml(full.html_content)
      setLoadedVersion(version)
      setDirty(false)
    },
    [code],
  )

  // Initial load: prefer the published version, else the newest, else a starter.
  useEffect(() => {
    api
      .getTemplate(code)
      .then(async (d) => {
        setDetail(d)
        const initial =
          d.versions.find((v) => v.status === 'published')?.version ??
          d.versions.at(-1)?.version
        if (initial != null) await loadVersion(initial)
        else {
          setHtml(STARTER_TEMPLATE)
          setTestData('{\n  "title": "Demo",\n  "name": "world"\n}')
          setLoadedVersion(null)
          setDirty(true)
        }
      })
      .catch((e) => setError(e.message))
  }, [code, loadVersion])

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

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await api.saveVersion(code, html, comment)
      setComment('')
      await refreshDetail()
      setLoadedVersion(created.version)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const publishVersion = async (version: number | null) => {
    if (version == null) return
    setBusy(true)
    setError(null)
    try {
      await api.publish(code, version)
      await refreshDetail()
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

  // A preset generates Jinja source. Code inserts it raw; Visual inserts its
  // protected form, so the two modes stay provably identical (protect/restore
  // inverse). If a generator ever produced something unrepresentable, detect
  // catches it here rather than corrupting the canvas silently.
  const insertPreset = (preset: Preset) => {
    const source = preset.generate({})
    if (mode !== 'visual') {
      insertText(source)
      return
    }
    if (!detect(source).supported) {
      setError(`This preset cannot be inserted visually:\n- ${detect(source).reasons.join('\n- ')}`)
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
          <strong>{detail?.name ?? code}</strong>
          <span className="template-code">{code}</span>
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

        <select
          value={loadedVersion ?? ''}
          onChange={(e) => switchVersion(Number(e.target.value))}
          disabled={!detail?.versions.length}
        >
          {!detail?.versions.length && <option value="">no versions yet</option>}
          {detail?.versions
            .slice()
            .reverse()
            .map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} · {v.status}
                {v.comment ? ` · ${v.comment.slice(0, 40)}` : ''}
              </option>
            ))}
        </select>

        <input
          className="comment-input"
          placeholder="What changed? (like a commit message)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <button className="btn primary" onClick={save} disabled={busy || !html.trim()}>
          Save as new version
        </button>
        <button
          className="btn publish"
          onClick={() => publishVersion(loadedVersion)}
          disabled={busy || loadedVersion == null || dirty || loadedVersion === publishedVersion}
          title={
            dirty
              ? 'Save your changes as a version first'
              : loadedVersion === publishedVersion
                ? 'This version is already published'
                : 'Make this version the one consumers render'
          }
        >
          {loadedVersion != null && loadedVersion === publishedVersion ? 'Published' : 'Publish'}
        </button>
        <button className="btn" onClick={() => setShowHistory(!showHistory)}>
          History
        </button>
        {assistant?.enabled && (
          <button
            className={showAssistant ? 'btn mode active' : 'btn'}
            onClick={() => setShowAssistant(!showAssistant)}
            title={`AI assistant (${assistant.model})`}
          >
            ✨ Assistant
          </button>
        )}
        {dirty && <span className="dirty-badge">unsaved</span>}
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="workspace">
        <section className="pane code-pane">
          {mode === 'code' ? (
            <CodeMirror
              value={html}
              height="100%"
              theme="dark"
              extensions={[htmlLang()]}
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
              key={loadedVersion ?? 'new'}
              initialBody={visualInitialRef.current}
              canvasStyles={splitRef.current?.styles ?? ''}
              onChange={handleVisualChange}
              onReady={(api) => {
                canvasApiRef.current = api
              }}
            />
          )}
          <div className="bottom-panels">
            <PlaceholderPanel html={html} onInsert={insertPlaceholder} />
            <PresetPanel onInsert={insertPreset} />
            <AssetsPanel onInsert={insertText} />
            <div className="test-data">
              <label>Test data (JSON) — preview renders with it</label>
              <textarea
                spellCheck={false}
                value={testData}
                onChange={(e) => setTestData(e.target.value)}
              />
              {parsedData.error && <div className="error-box small">{parsedData.error}</div>}
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
            loadedVersion={loadedVersion}
            editorHtml={html}
            onLoad={(v) => switchVersion(v)}
            onPublish={(v) => publishVersion(v)}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>
    </div>
  )
}
