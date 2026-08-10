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
  directory_id: number | null
  archived_at: string | null
  created_at: string
}

export interface DirectoryInfo {
  id: number
  name: string
  created_by: string
  created_at: string
  template_count: number
}

export interface TemplateDetail extends TemplateInfo {
  /** Published history, newest first. */
  versions: VersionInfo[]
  /** Working copies. They have ids, not numbers — see DraftInfo. */
  drafts: DraftInfo[]
  /** Which published version consumers currently get, if any. */
  current_version: number | null
}

export interface VersionDetail extends VersionInfo {
  html_content: string
}

/** A working copy. Deliberately has no `version` field: a number is minted at
 * publication, so anything holding a number is something consumers can render. */
export interface DraftInfo {
  id: number
  comment: string
  created_by: string
  created_at: string
}

export interface DraftDetail extends DraftInfo {
  html_content: string
}

export type Role = 'superuser' | 'editor'

export interface Me {
  authenticated: boolean
  auth_enabled: boolean
  username: string
  role: '' | Role | 'render'
}

export interface UserOut {
  id: number
  username: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface ApiKeyOut {
  id: number
  name: string
  prefix: string
  created_by: string
  created_at: string
  last_used_at: string | null
}

export interface ApiKeyCreated extends ApiKeyOut {
  /** The clear key — shown once, never retrievable again. */
  key: string
}

export interface ExampleMeta {
  id: string
  title: string
  description: string
  tags: string[]
}

export interface ExampleDetail extends ExampleMeta {
  html: string
  data: Record<string, unknown>
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

const TOKEN_KEY = 'linform_session'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** The app registers a callback so a token that stops working anywhere drops
 * the whole UI back to the login screen — no per-call prompt, no half-authed
 * state. */
let onAuthLost: (() => void) | null = null
export function setAuthLostHandler(fn: (() => void) | null): void {
  onAuthLost = fn
}

/** fetch with the stored session token. A 401 while we *hold* a token means it
 * expired or was revoked: clear it and let the app show the login screen. */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const resp = await fetch(path, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  })
  if (resp.status === 401 && getToken()) {
    setToken(null)
    onAuthLost?.()
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

/** No response headers within this long means the request never got through. */
const ASSISTANT_CONNECT_TIMEOUT_MS = 30_000
/** Silence on an open stream. Generation itself may legitimately take a while,
 * so what is bounded is the gap between events, not the total. Without this a
 * stalled connection leaves the UI on "Thinking…" forever. */
const ASSISTANT_IDLE_TIMEOUT_MS = 60_000

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const bell = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(what)), ms)
  })
  return Promise.race([promise, bell]).finally(() => clearTimeout(timer)) as Promise<T>
}

/** Stream the assistant reply (SSE over fetch). */
export async function* assistantChat(
  body: AssistantRequestBody,
  signal?: AbortSignal,
): AsyncGenerator<AssistantEvent> {
  const resp = await withTimeout(
    authFetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
    ASSISTANT_CONNECT_TIMEOUT_MS,
    `The assistant did not respond within ${ASSISTANT_CONNECT_TIMEOUT_MS / 1000}s. ` +
      'The request never reached the server — check the connection and try again.',
  )
  if (!resp.ok || !resp.body) throw await parseError(resp)
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await withTimeout(
        reader.read(),
        ASSISTANT_IDLE_TIMEOUT_MS,
        `The assistant stopped sending for ${ASSISTANT_IDLE_TIMEOUT_MS / 1000}s and was cut off. ` +
          'Nothing was applied — try again.',
      )
    } catch (e) {
      // Release the socket, or a stalled stream keeps holding it.
      reader.cancel().catch(() => {})
      throw e
    }
    const { done, value } = chunk
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

/** What this instance offers. A demo node has no templates and no accounts,
 * and says so here rather than by failing the calls one at a time. */
export interface Capabilities {
  role: string
  tabs: string[]
  accounts: boolean
}

export const api = {
  capabilities: () => request<Capabilities>('/api/capabilities'),

  me: () => request<Me>('/api/auth/me'),

  async login(username: string, password: string): Promise<Me> {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!resp.ok) throw await parseError(resp)
    const body = (await resp.json()) as { token: string; username: string; role: Role }
    setToken(body.token)
    return { authenticated: true, auth_enabled: true, username: body.username, role: body.role }
  },

  async logout(): Promise<void> {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' })
    } finally {
      setToken(null)
    }
  },

  // --- superuser account management ---
  listUsers: () => request<UserOut[]>('/api/admin/users'),

  createUser: (username: string, password: string, role: Role) =>
    request<UserOut>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    }),

  setUserActive: (id: number, is_active: boolean) =>
    request<UserOut>(`/api/admin/users/${id}/active`, {
      method: 'PUT',
      body: JSON.stringify({ is_active }),
    }),

  async setUserPassword(id: number, password: string): Promise<void> {
    const resp = await authFetch(`/api/admin/users/${id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!resp.ok) throw await parseError(resp)
  },

  async deleteUser(id: number): Promise<void> {
    const resp = await authFetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    if (!resp.ok) throw await parseError(resp)
  },

  listKeys: () => request<ApiKeyOut[]>('/api/admin/keys'),

  createKey: (name: string) =>
    request<ApiKeyCreated>('/api/admin/keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  async deleteKey(id: number): Promise<void> {
    const resp = await authFetch(`/api/admin/keys/${id}`, { method: 'DELETE' })
    if (!resp.ok) throw await parseError(resp)
  },

  listTemplates: () => request<TemplateInfo[]>('/api/templates'),

  listExamples: () => request<ExampleMeta[]>('/api/examples'),

  getExample: (id: string) => request<ExampleDetail>(`/api/examples/${id}`),

  assistantStatus: () => request<AssistantStatus>('/api/assistant/status'),

  listAssets: () => request<AssetInfo[]>('/api/assets'),

  async uploadAsset(file: File): Promise<AssetInfo> {
    const form = new FormData()
    form.append('file', file)
    const resp = await authFetch('/api/assets', { method: 'POST', body: form })
    if (!resp.ok) throw await parseError(resp)
    return resp.json()
  },

  archiveTemplate: (code: string) =>
    request<TemplateInfo>(`/api/templates/${code}`, { method: 'DELETE' }),

  restoreTemplate: (code: string) =>
    request<TemplateInfo>(`/api/templates/${code}/restore`, { method: 'POST' }),

  createTemplate: (code: string, name: string, directory_id: number | null = null) =>
    request<TemplateInfo>('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ code, name, directory_id }),
    }),

  // --- directories (flat buckets) ---
  listDirectories: () => request<DirectoryInfo[]>('/api/directories'),

  createDirectory: (name: string) =>
    request<DirectoryInfo>('/api/directories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  renameDirectory: (id: number, name: string) =>
    request<DirectoryInfo>(`/api/directories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  async deleteDirectory(id: number): Promise<void> {
    const resp = await authFetch(`/api/directories/${id}`, { method: 'DELETE' })
    if (!resp.ok) throw await parseError(resp)
  },

  moveTemplate: (code: string, directory_id: number | null) =>
    request<TemplateInfo>(`/api/templates/${code}/directory`, {
      method: 'PUT',
      body: JSON.stringify({ directory_id }),
    }),

  getTemplate: (code: string) => request<TemplateDetail>(`/api/templates/${code}`),

  getVersion: (code: string, version: number) =>
    request<VersionDetail>(`/api/templates/${code}/versions/${version}`),

  // --- drafts: working copies, addressed by id ---
  listDrafts: (code: string) => request<DraftInfo[]>(`/api/templates/${code}/drafts`),

  getDraft: (code: string, draftId: number) =>
    request<DraftDetail>(`/api/templates/${code}/drafts/${draftId}`),

  createDraft: (code: string, html_content: string, comment = '') =>
    request<DraftDetail>(`/api/templates/${code}/drafts`, {
      method: 'POST',
      body: JSON.stringify({ html_content, comment }),
    }),

  updateDraft: (code: string, draftId: number, html_content: string, comment = '') =>
    request<DraftDetail>(`/api/templates/${code}/drafts/${draftId}`, {
      method: 'PUT',
      body: JSON.stringify({ html_content, comment }),
    }),

  async deleteDraft(code: string, draftId: number): Promise<void> {
    const resp = await authFetch(`/api/templates/${code}/drafts/${draftId}`, { method: 'DELETE' })
    if (!resp.ok) throw await parseError(resp)
  },

  /** Publish a draft: it is numbered, frozen, and becomes what consumers get. */
  publishDraft: (code: string, draftId: number) =>
    request<VersionInfo>(`/api/templates/${code}/drafts/${draftId}/publish`, { method: 'POST' }),

  /** Choose which published version consumers get — pointing it at an older
   * one is the rollback. */
  setCurrentVersion: (code: string, version: number) =>
    request<VersionInfo>(`/api/templates/${code}/versions/${version}/current`, { method: 'POST' }),

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
