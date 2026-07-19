import { useEffect, useRef, useState } from 'react'
import { diffLines, type Change } from 'diff'
import { assistantChat, AssistantStatus } from '../api'
import { extractHtmlBlock, replyProse } from '../assistant/extract'
import { toDownscaledDataUrl } from '../assistant/image'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** template proposed by this assistant message, if any */
  proposedHtml?: string
}

/** Assistant chat. The whole panel is hidden when the feature is off, so the
 * parent only mounts it after a positive /status. A reply with an html block
 * offers a diff-and-apply; a reply without one is a plain question. */
export default function AssistantPanel({
  status,
  currentHtml,
  placeholders,
  fixError,
  overlay = false,
  onApply,
  onClose,
}: {
  status: AssistantStatus
  /** float over the workspace rather than take a column of its own */
  overlay?: boolean
  currentHtml: string
  placeholders: string[]
  /** a render error to seed a "fix this" turn, or null */
  fixError: string | null
  onApply: (html: string) => void
  onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  // A vision request waits seconds before the first token. Without a ticking
  // counter that silence is indistinguishable from a hung page.
  const [elapsed, setElapsed] = useState(0)
  const [diffFor, setDiffFor] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  useEffect(() => {
    if (!streaming) return
    setElapsed(0)
    const started = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [streaming])

  // "Fix with AI" from the preview seeds the input with the render error.
  useEffect(() => {
    if (fixError) {
      setInput(`The template fails to render with this error, please fix it:\n${fixError}`)
    }
  }, [fixError])

  const send = async () => {
    const message = input.trim()
    if (!message || streaming) return
    const attached = images
    setMessages((m) => [...m, { role: 'user', text: message }, { role: 'assistant', text: '' }])
    setInput('')
    setImages([])
    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let acc = ''
    try {
      for await (const ev of assistantChat(
        { message, html: currentHtml, placeholders, images: attached },
        ctrl.signal,
      )) {
        if (ev.event === 'delta') {
          acc += ev.data.text ?? ''
          setMessages((m) => {
            const next = [...m]
            next[next.length - 1] = { role: 'assistant', text: acc }
            return next
          })
        } else if (ev.event === 'error') {
          acc += `\n\n⚠️ ${ev.data.detail ?? 'assistant error'}`
          setMessages((m) => {
            const next = [...m]
            next[next.length - 1] = { role: 'assistant', text: acc }
            return next
          })
        }
      }
    } catch (e) {
      setMessages((m) => {
        const next = [...m]
        next[next.length - 1] = { role: 'assistant', text: acc + `\n\n⚠️ ${(e as Error).message}` }
        return next
      })
    } finally {
      const proposed = extractHtmlBlock(acc)
      setMessages((m) => {
        const next = [...m]
        const last = next[next.length - 1]
        next[next.length - 1] = {
          ...last,
          text: proposed ? replyProse(acc) : acc,
          proposedHtml: proposed ?? undefined,
        }
        return next
      })
      setStreaming(false)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  const attachImage = async (file: File) => {
    const url = await toDownscaledDataUrl(file)
    setImages((imgs) => [...imgs, url].slice(0, 4))
  }

  return (
    <div className={overlay ? 'assistant-panel overlay' : 'assistant-panel'}>
      <div className="assistant-header">
        <strong>Assistant</strong>
        <span className="muted">{status.model}</span>
        <button className="btn small" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="assistant-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="muted assistant-hint">
            Describe a template to build, paste or attach a document to turn into one, or point at
            what is wrong. Attach a screenshot for visual fixes.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-text">
              {m.text ||
                (streaming && i === messages.length - 1
                  ? `Thinking… ${elapsed}s`
                  : '')}
            </div>
            {m.proposedHtml && (
              <div className="chat-proposal">
                <button className="btn small" onClick={() => setDiffFor(diffFor === i ? null : i)}>
                  {diffFor === i ? 'Hide diff' : 'Show diff'}
                </button>
                <button className="btn small primary" onClick={() => onApply(m.proposedHtml!)}>
                  Apply
                </button>
                {diffFor === i && <DiffView from={currentHtml} to={m.proposedHtml} />}
              </div>
            )}
          </div>
        ))}
      </div>

      {images.length > 0 && (
        <div className="assistant-attachments">
          {images.map((src, i) => (
            <span key={i} className="attach-chip">
              <img src={src} alt="attachment" />
              <button onClick={() => setImages((im) => im.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="assistant-input">
        <textarea
          value={input}
          placeholder="Ask the assistant…  (Enter to send, Shift+Enter for a newline)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="assistant-actions">
          <button className="btn small" onClick={() => fileRef.current?.click()} title="Attach a scan or screenshot">
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) attachImage(f)
              if (fileRef.current) fileRef.current.value = ''
            }}
          />
          {streaming ? (
            <button className="btn small" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn small primary" onClick={send} disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DiffView({ from, to }: { from: string; to: string }) {
  const changes: Change[] = diffLines(from, to)
  return (
    <div className="diff-view">
      <pre>
        {changes.map((part, i) => (
          <span
            key={i}
            className={part.added ? 'diff-add' : part.removed ? 'diff-del' : 'diff-same'}
          >
            {part.value}
          </span>
        ))}
      </pre>
    </div>
  )
}
