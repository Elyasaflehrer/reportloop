// Thin HTTP client used by every test. Wraps fetch() with:
//   - BACKEND_URL prefix from env
//   - Bearer token injection
//   - JSON body serialization
//   - JSON response parsing (graceful on non-JSON)
//
// Tests should NEVER import backend code directly — only call this.

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8082'

export type ApiResponse<T = unknown> = {
  status: number
  body:   T
}

async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path:   string,
  opts:   { token?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  return { status: res.status, body: body as T }
}

export const get    = <T = unknown>(path: string, token?: string)               => api<T>('GET',    path, { token })
export const post   = <T = unknown>(path: string, token: string, body?: unknown) => api<T>('POST',   path, { token, body: body ?? {} })
export const patch  = <T = unknown>(path: string, token: string, body: unknown)  => api<T>('PATCH',  path, { token, body })
export const del    = <T = unknown>(path: string, token: string)                => api<T>('DELETE', path, { token })
