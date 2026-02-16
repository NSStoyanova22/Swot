const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error('Missing VITE_API_URL. Set it in apps/web/.env.local or your environment.')
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers?: HeadersInit
  signal?: AbortSignal
}

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

function buildUrl(path: string, query?: ApiRequestOptions['query']) {
  const base = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL
  const normalized = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${base}${normalized}`)

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined) return
      url.searchParams.set(key, String(value))
    })
  }

  return url.toString()
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, headers, signal } = options

  const response = await fetch(buildUrl(path, query), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

  const contentType = response.headers.get('content-type')
  const isJson = contentType?.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, response.status, payload)
  }

  return payload as T
}
