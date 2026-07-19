export interface VersionInfo {
  version: number
  status: 'draft' | 'published' | 'archived'
  comment: string
  created_by: string
  created_at: string
}

export interface TemplateInfo {
  code: string
  name: string
  created_at: string
}

export interface TemplateDetail extends TemplateInfo {
  versions: VersionInfo[]
}

export interface VersionDetail extends VersionInfo {
  html_content: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    detail: string,
  ) {
    super(detail)
  }
}

async function parseError(resp: Response): Promise<ApiError> {
  let detail = resp.statusText
  try {
    const body = await resp.json()
    if (typeof body.detail === 'string') detail = body.detail
    else if (body.detail) detail = JSON.stringify(body.detail)
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(resp.status, detail)
}

const TOKEN_KEY = 'linform_admin_token'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** fetch with the stored admin token; on 401 asks for a token once and
 * retries, so a tokened deployment stays usable without a login screen. */
async function authFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const resp = await fetch(path, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  })
  if (resp.status === 401 && !retried) {
    const entered = window.prompt('Access token (LINFORM_ADMIN_TOKEN):')
    if (entered && entered.trim()) {
      localStorage.setItem(TOKEN_KEY, entered.trim())
      return authFetch(path, init, true)
    }
  }
  return resp
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await authFetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!resp.ok) throw await parseError(resp)
  return resp.json() as Promise<T>
}

export interface AssetInfo {
  url: string
  sha256: string
  filename: string
  mime_type: string
  size: number
}

export interface AssistantStatus {
  enabled: boolean
  model: string | null
  sends_test_data: boolean
}

export interface AssistantHistoryTurn {
  role: 'user' | 'assistant'
  /** prose only — html blocks are stripped before they leave the browser */
  text: string
}

export interface AssistantRequestBody {
  message: string
  html: string
  placeholders: string[]
  test_data?: Record<string, unknown>
  images?: string[]
  history?: AssistantHistoryTurn[]
}

export interface AssistantEvent {
  event: 'delta' | 'done' | 'error'
  data: { text?: string; detail?: string }
}

/** Stream the assistant reply (SSE over fetch). */
export async function* assistantChat(
  body: AssistantRequestBody,
  signal?: AbortSignal,
): AsyncGenerator<AssistantEvent> {
  const resp = await authFetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok || !resp.body) throw await parseError(resp)
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const ev = /^event: (.+)$/m.exec(raw)
      const data = /^data: (.+)$/m.exec(raw)
      if (ev && data) {
        yield { event: ev[1] as AssistantEvent['event'], data: JSON.parse(data[1]) }
      }
    }
  }
}

export const api = {
  listTemplates: () => request<TemplateInfo[]>('/api/templates'),

  assistantStatus: () => request<AssistantStatus>('/api/assistant/status'),

  listAssets: () => request<AssetInfo[]>('/api/assets'),

  async uploadAsset(file: File): Promise<AssetInfo> {
    const form = new FormData()
    form.append('file', file)
    const resp = await authFetch('/api/assets', { method: 'POST', body: form })
    if (!resp.ok) throw await parseError(resp)
    return resp.json()
  },

  createTemplate: (code: string, name: string) =>
    request<TemplateInfo>('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ code, name }),
    }),

  getTemplate: (code: string) => request<TemplateDetail>(`/api/templates/${code}`),

  getVersion: (code: string, version: number) =>
    request<VersionDetail>(`/api/templates/${code}/versions/${version}`),

  saveVersion: (code: string, html_content: string, comment: string) =>
    request<VersionInfo>(`/api/templates/${code}`, {
      method: 'PUT',
      body: JSON.stringify({ html_content, comment }),
    }),

  publish: (code: string, version: number) =>
    request<VersionInfo>(`/api/templates/${code}/publish/${version}`, { method: 'POST' }),

  placeholders: (html: string) =>
    request<{ placeholders: string[] }>('/api/placeholders', {
      method: 'POST',
      body: JSON.stringify({ html, data: {} }),
    }),

  async renderPreview(
    html: string,
    data: Record<string, unknown>,
    strict: boolean,
    signal: AbortSignal,
  ): Promise<Blob> {
    const resp = await authFetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, data, strict }),
      signal,
    })
    if (!resp.ok) throw await parseError(resp)
    return resp.blob()
  },
}
