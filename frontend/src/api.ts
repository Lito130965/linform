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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!resp.ok) throw await parseError(resp)
  return resp.json() as Promise<T>
}

export const api = {
  listTemplates: () => request<TemplateInfo[]>('/api/templates'),

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
    signal: AbortSignal,
  ): Promise<Blob> {
    const resp = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, data }),
      signal,
    })
    if (!resp.ok) throw await parseError(resp)
    return resp.blob()
  },
}
