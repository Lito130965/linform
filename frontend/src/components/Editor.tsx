import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { html as htmlLang } from '@codemirror/lang-html'
import type { EditorView } from '@codemirror/view'
import { api, TemplateDetail } from '../api'
import PreviewPane from './PreviewPane'
import PlaceholderPanel from './PlaceholderPanel'

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

export default function Editor({ code }: { code: string }) {
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)
  const [html, setHtml] = useState('')
  const [testData, setTestData] = useState('{\n  "title": "Demo",\n  "name": "world"\n}')
  const [comment, setComment] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewRef = useRef<EditorView | null>(null)

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

  const publish = async () => {
    if (loadedVersion == null) return
    setBusy(true)
    setError(null)
    try {
      await api.publish(code, loadedVersion)
      await refreshDetail()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const insertPlaceholder = (name: string) => {
    const view = viewRef.current
    if (!view) return
    view.dispatch(view.state.replaceSelection(`{{ ${name} }}`))
    view.focus()
  }

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
          onClick={publish}
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
        {dirty && <span className="dirty-badge">unsaved</span>}
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="workspace">
        <section className="pane code-pane">
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
          <div className="bottom-panels">
            <PlaceholderPanel html={html} onInsert={insertPlaceholder} />
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
          <PreviewPane html={html} data={parsedData.data} />
        </section>
      </div>
    </div>
  )
}
