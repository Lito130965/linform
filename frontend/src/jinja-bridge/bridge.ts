/**
 * jinja-bridge: two-way preprocessor between Jinja2 template source and
 * DOM-parser-safe HTML for the visual editor.
 *
 * The problem: inline `{{ expr }}` survives DOM parsing, but block tags
 * whose position is invalid HTML (`{% for %}` between <tbody> and <tr>)
 * get moved or eaten by any HTML parser. So before the template enters a
 * DOM-based editor, block tags that align with element boundaries are
 * folded into attributes of the real element, and text-level expressions
 * are wrapped in marker <span>s; after editing everything is unfolded.
 *
 * Everything here is string/token level — no DOM. That is what makes
 * `restore(protect(html)) === html` achievable byte-for-byte: the DOM
 * normalizes quotes and attribute order, strings do not.
 *
 * detect() is the safety valve: templates using constructs this module
 * cannot represent (macros, set, loops that cross element boundaries…)
 * are reported with human-readable reasons, and the UI keeps them
 * code-only. Never a silent loss.
 */

export interface DetectResult {
  supported: boolean
  reasons: string[]
}

const EXPR_ATTR = 'data-jinja-expr'
const FOR_ATTR = 'data-jinja-for'
const IF_ATTR = 'data-jinja-if'
const WS_ATTR = 'data-jinja-ws'

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const SUPPORTED_BLOCKS = new Set(['for', 'if'])
const BLOCK_CLOSERS: Record<string, string> = { endfor: 'for', endif: 'if' }

// ---------------------------------------------------------------- tokens

type TokenKind = 'stmt' | 'expr' | 'comment'

interface JinjaToken {
  kind: TokenKind
  start: number
  end: number
  raw: string
  /** contents without delimiters and whitespace-control dashes, trimmed */
  inner: string
  /** first word of inner (statements only), e.g. "for", "endif" */
  keyword: string
  /** whitespace-control dashes: {%- ... -%} */
  wsLeft: boolean
  wsRight: boolean
  /** HTML context, filled by the scanner */
  ctx: 'text' | 'tag' | 'style' | 'script' | 'comment'
}

const TOKEN_RE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g

function findTokens(html: string): JinjaToken[] {
  const tokens: JinjaToken[] = []
  for (const m of html.matchAll(TOKEN_RE)) {
    const raw = m[0]
    const kind: TokenKind = raw.startsWith('{{') ? 'expr' : raw.startsWith('{%') ? 'stmt' : 'comment'
    let body = raw.slice(2, -2)
    let wsLeft = false
    let wsRight = false
    if (kind === 'stmt') {
      if (body.startsWith('-')) {
        wsLeft = true
        body = body.slice(1)
      }
      if (body.endsWith('-')) {
        wsRight = true
        body = body.slice(0, -1)
      }
    }
    const inner = body.trim()
    tokens.push({
      kind,
      start: m.index!,
      end: m.index! + raw.length,
      raw,
      inner,
      keyword: kind === 'stmt' ? (inner.split(/\s+/)[0] ?? '') : '',
      wsLeft,
      wsRight,
      ctx: 'text',
    })
  }
  return tokens
}

// ------------------------------------------------------------ html scan

interface TagInfo {
  name: string
  start: number
  /** index just past the closing '>' */
  end: number
  closing: boolean
  selfClosing: boolean
}

interface Analysis {
  tags: TagInfo[]
  /** open tag lookup by exact start offset */
  openAt: Map<number, TagInfo>
}

/**
 * Single-pass HTML structure scan that treats Jinja token ranges as opaque
 * (a `>` inside `{% if a > b %}` must not close a tag) and assigns each
 * token its context: text, inside a tag, inside <style>/<script>, comment.
 */
function scanHtml(html: string, tokens: JinjaToken[]): Analysis {
  const tags: TagInfo[] = []
  const openAt = new Map<number, TagInfo>()
  let tokenIdx = 0
  let i = 0
  let rawTextUntil: string | null = null // 'style' | 'script'

  const consumeTokensAt = (pos: number, ctx: JinjaToken['ctx']): number => {
    let moved = pos
    while (tokenIdx < tokens.length && tokens[tokenIdx].start === moved) {
      tokens[tokenIdx].ctx = ctx
      moved = tokens[tokenIdx].end
      tokenIdx++
    }
    return moved
  }

  while (i < html.length) {
    // Jinja tokens are opaque to the HTML scan.
    const afterToken = consumeTokensAt(i, rawTextUntil ? (rawTextUntil as 'style' | 'script') : 'text')
    if (afterToken !== i) {
      i = afterToken
      continue
    }

    if (rawTextUntil) {
      const close = `</${rawTextUntil}`
      if (html.startsWith(close, i)) {
        const gt = html.indexOf('>', i)
        const end = gt === -1 ? html.length : gt + 1
        tags.push({ name: rawTextUntil, start: i, end, closing: true, selfClosing: false })
        rawTextUntil = null
        i = end
      } else {
        i++
      }
      continue
    }

    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4)
      const end = close === -1 ? html.length : close + 3
      while (tokenIdx < tokens.length && tokens[tokenIdx].start < end) {
        tokens[tokenIdx].ctx = 'comment'
        tokenIdx++
      }
      i = end
      continue
    }

    if (html[i] === '<' && (html.startsWith('<!', i) || html.startsWith('<?', i))) {
      const gt = html.indexOf('>', i)
      i = gt === -1 ? html.length : gt + 1
      continue
    }

    if (html[i] === '<' && /[a-zA-Z/]/.test(html[i + 1] ?? '')) {
      const closing = html[i + 1] === '/'
      const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(html.slice(i + (closing ? 2 : 1)))
      if (!nameMatch) {
        i++
        continue
      }
      const name = nameMatch[0].toLowerCase()
      const start = i
      i += (closing ? 2 : 1) + nameMatch[0].length
      // scan to '>' honoring quotes; jinja tokens inside are 'tag' context
      let quote: string | null = null
      while (i < html.length) {
        const moved = consumeTokensAt(i, 'tag')
        if (moved !== i) {
          i = moved
          continue
        }
        const ch = html[i]
        if (quote) {
          if (ch === quote) quote = null
          i++
        } else if (ch === '"' || ch === "'") {
          quote = ch
          i++
        } else if (ch === '>') {
          i++
          break
        } else {
          i++
        }
      }
      const selfClosing = /\/\s*>$/.test(html.slice(start, i))
      const tag: TagInfo = { name, start, end: i, closing, selfClosing }
      tags.push(tag)
      if (!closing) {
        openAt.set(start, tag)
        if (name === 'style' || name === 'script') rawTextUntil = name
      }
      continue
    }

    i++
  }
  return { tags, openAt }
}

/** Find the TagInfo that closes the element opened by `open`. */
function findMatchingClose(analysis: Analysis, open: TagInfo): TagInfo | null {
  if (open.selfClosing || VOID_ELEMENTS.has(open.name)) return null
  let depth = 0
  for (const tag of analysis.tags) {
    if (tag.start < open.start) continue
    if (tag.name !== open.name) continue
    if (VOID_ELEMENTS.has(tag.name) || tag.selfClosing) continue
    if (!tag.closing) depth++
    else {
      depth--
      if (depth === 0) return tag
    }
  }
  return null
}

// ------------------------------------------------------------ detection

interface BlockPair {
  open: JinjaToken
  close: JinjaToken
  element: TagInfo
  /** element close tag, null for void elements */
  elementClose: TagInfo | null
}

interface DetectInternal {
  result: DetectResult
  pairs: BlockPair[]
  tokens: JinjaToken[]
}

function detectInternal(html: string): DetectInternal {
  const tokens = findTokens(html)
  const analysis = scanHtml(html, tokens)
  const reasons: string[] = []
  const pairs: BlockPair[] = []

  const stack: JinjaToken[] = []
  for (const token of tokens) {
    if (token.kind === 'comment') {
      reasons.push('Jinja comments ({# … #}) are not representable in the visual editor')
      continue
    }
    if (token.kind !== 'stmt') continue

    if (SUPPORTED_BLOCKS.has(token.keyword)) {
      if (token.ctx !== 'text') {
        reasons.push(`{% ${token.keyword} %} inside ${token.ctx === 'tag' ? 'a tag attribute' : `<${token.ctx}>`} is code-only`)
      }
      stack.push(token)
    } else if (token.keyword in BLOCK_CLOSERS) {
      const open = stack.pop()
      if (!open || open.keyword !== BLOCK_CLOSERS[token.keyword]) {
        reasons.push(`Unbalanced {% ${token.keyword} %}`)
        continue
      }
      const pair = matchPairToElement(html, analysis, open, token)
      if (typeof pair === 'string') reasons.push(pair)
      else pairs.push(pair)
    } else {
      reasons.push(`{% ${token.keyword} %} is not supported in the visual editor`)
    }
  }
  for (const left of stack) reasons.push(`{% ${left.keyword} %} without a closing tag`)

  return {
    result: { supported: reasons.length === 0, reasons: [...new Set(reasons)] },
    pairs,
    tokens,
  }
}

/** A block is representable iff its body is exactly one element. */
function matchPairToElement(
  html: string,
  analysis: Analysis,
  open: JinjaToken,
  close: JinjaToken,
): BlockPair | string {
  const label = `{% ${open.inner} %}`
  let innerStart = open.end
  let innerEnd = close.start
  while (innerStart < innerEnd && /\s/.test(html[innerStart])) innerStart++
  while (innerEnd > innerStart && /\s/.test(html[innerEnd - 1])) innerEnd--

  const element = analysis.openAt.get(innerStart)
  if (!element) {
    return `${label} does not start at an element boundary — code-only`
  }
  const elementClose = findMatchingClose(analysis, element)
  const elementEnd = elementClose ? elementClose.end : element.end
  if (elementEnd !== innerEnd) {
    return `${label} spans more than one element (or crosses element boundaries) — code-only`
  }
  return { open, close, element, elementClose }
}

export function detect(html: string): DetectResult {
  return detectInternal(html).result
}

// -------------------------------------------------------------- protect

interface Edit {
  start: number
  end: number
  text: string
}

function applyEdits(html: string, edits: Edit[]): string {
  const sorted = edits.slice().sort((a, b) => b.start - a.start || b.end - a.end)
  let out = html
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return out
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?34;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function wsFlags(open: JinjaToken, close: JinjaToken): string {
  const flags: string[] = []
  if (open.wsLeft) flags.push('ol')
  if (open.wsRight) flags.push('or')
  if (close.wsLeft) flags.push('cl')
  if (close.wsRight) flags.push('cr')
  return flags.join(',')
}

/** Insertion point for new attributes: right before '>' or '/>'. */
function attrInsertPos(html: string, tag: TagInfo): number {
  let p = tag.end - 1 // at '>'
  if (html[p - 1] === '/') p--
  while (p > tag.start && /\s/.test(html[p - 1])) p--
  return p
}

/**
 * Fold Jinja constructs into DOM-safe markup. Throws if detect() fails —
 * callers must check detect() first and keep such templates code-only.
 */
export function protect(html: string): string {
  const { result, pairs, tokens } = detectInternal(html)
  if (!result.supported) {
    throw new Error(`Template is not representable in the visual editor:\n- ${result.reasons.join('\n- ')}`)
  }

  const edits: Edit[] = []
  for (const pair of pairs) {
    const attr = pair.open.keyword === 'for' ? FOR_ATTR : IF_ATTR
    const expr = pair.open.inner.slice(pair.open.keyword.length).trim()
    const ws = wsFlags(pair.open, pair.close)
    let attrText = ` ${attr}="${escapeAttr(expr)}"`
    if (ws) attrText += ` ${WS_ATTR}="${ws}"`
    edits.push({ start: pair.open.start, end: pair.open.end, text: '' })
    edits.push({ start: pair.close.start, end: pair.close.end, text: '' })
    const insertAt = attrInsertPos(html, pair.element)
    edits.push({ start: insertAt, end: insertAt, text: attrText })
  }

  for (const token of tokens) {
    if (token.kind !== 'expr' || token.ctx !== 'text') continue
    edits.push({
      start: token.start,
      end: token.end,
      text: `<span ${EXPR_ATTR}="${escapeAttr(token.inner)}">${token.raw}</span>`,
    })
  }

  return applyEdits(html, edits)
}

// -------------------------------------------------------------- restore

const SPAN_MARKER_RE = new RegExp(
  `<span\\b[^>]*?${EXPR_ATTR}\\s*=\\s*(?:"([^"]*)"|'([^']*)')[^>]*>[\\s\\S]*?</span>`,
  'g',
)

function readMarkedAttrs(tagText: string): { kind: 'for' | 'if'; expr: string; ws: Set<string> } | null {
  const forMatch = new RegExp(`${FOR_ATTR}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tagText)
  const ifMatch = new RegExp(`${IF_ATTR}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tagText)
  if (!forMatch && !ifMatch) return null
  const wsMatch = new RegExp(`${WS_ATTR}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tagText)
  const ws = new Set((wsMatch?.[1] ?? wsMatch?.[2] ?? '').split(',').filter(Boolean))
  if (forMatch) return { kind: 'for', expr: unescapeAttr(forMatch[1] ?? forMatch[2] ?? ''), ws }
  return { kind: 'if', expr: unescapeAttr(ifMatch![1] ?? ifMatch![2] ?? ''), ws }
}

function stripMarkedAttrs(tagText: string): string {
  return tagText.replace(
    new RegExp(`\\s*(?:${FOR_ATTR}|${IF_ATTR}|${WS_ATTR})\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'),
    '',
  )
}

/** Unfold bridge markup back into the original Jinja source. */
export function restore(html: string): string {
  // 1. Expression markers back to {{ … }} (the attribute is the truth —
  //    the visible chip text may have been touched by the rich editor).
  let out = html.replace(SPAN_MARKER_RE, (_m, dq, sq) => `{{ ${unescapeAttr(dq ?? sq ?? '')} }}`)

  // 2. Elements carrying block attributes back to wrapping tags.
  const analysis = scanHtml(out, [])
  const edits: Edit[] = []
  for (const tag of analysis.tags) {
    if (tag.closing) continue
    const tagText = out.slice(tag.start, tag.end)
    const marked = readMarkedAttrs(tagText)
    if (!marked) continue
    const close = findMatchingClose(analysis, tag)
    const blockEnd = close ? close.end : tag.end
    const openTag = `{%${marked.ws.has('ol') ? '-' : ''} ${marked.kind} ${marked.expr} ${marked.ws.has('or') ? '-' : ''}%}`
    const closeTag = `{%${marked.ws.has('cl') ? '-' : ''} end${marked.kind} ${marked.ws.has('cr') ? '-' : ''}%}`
    edits.push({ start: tag.start, end: tag.end, text: openTag + stripMarkedAttrs(tagText) })
    edits.push({ start: blockEnd, end: blockEnd, text: closeTag })
  }
  return applyEdits(out, edits)
}

// ---------------------------------------------------------------- assets

const ASSET_URL_RE = /asset:\/\/([0-9a-f]{64})/g
const CANVAS_ASSET_RE = /\/api\/assets\/([0-9a-f]{64})/g

/** Browsers cannot fetch asset:// — rewrite to the serving endpoint so
 * images are visible inside the editor canvas. */
export function toCanvasAssets(html: string): string {
  return html.replace(ASSET_URL_RE, '/api/assets/$1')
}

/** Inverse of toCanvasAssets, applied on export. */
export function fromCanvasAssets(html: string): string {
  return html.replace(CANVAS_ASSET_RE, 'asset://$1')
}
