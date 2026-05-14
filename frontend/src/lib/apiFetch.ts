const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string

export const apiFetch = async (
  path: string,
  token: string | null,
  { method = 'GET', body }: { method?: string; body?: unknown } = {}
): Promise<unknown> => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || data?.message || `Request failed ${res.status}`)
  return data
}
