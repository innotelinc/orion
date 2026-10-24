import type {
  AppEntry,
  FileNode,
  Metrics,
  NotificationItem,
  RootEntry,
  Space,
  StorageState,
  SystemInfo,
  SystemService,
  UserAccount,
  UserRole,
} from '../types'

export interface StatePayload {
  files: FileNode[]
  storage: StorageState
  users: UserAccount[]
  spaces: Space[]
  apps: AppEntry[]
  services: SystemService[]
  notifications: NotificationItem[]
  roots: RootEntry[]
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    })
  } catch {
    throw new ApiError('The API is unreachable. Check orion-api on the host.', 0)
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) message = payload.error
    } catch {
      // Keep the status message.
    }
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export const api = {
  system: () => request<SystemInfo>('/api/system'),
  metrics: () => request<Metrics>('/api/metrics'),
  // A bundle can outlive the API it was deployed with; an older one has no
  // `spaces` or `apps`, and the UI must not crash on that.
  state: async (): Promise<StatePayload> => {
    const payload = await request<StatePayload>('/api/state')
    return { ...payload, spaces: payload.spaces ?? [], apps: payload.apps ?? [] }
  },

  mkdir: (parent: string, name: string) =>
    post<{ ok: true; path: string }>('/api/files/mkdir', { parent, name }),
  rename: (path: string, name: string) =>
    post<{ ok: true; path: string }>('/api/files/rename', { path, name }),
  remove: (paths: string[]) => post<{ ok: true; moved: number }>('/api/files/delete', { paths }),
  star: (path: string, starred: boolean) =>
    post<{ ok: true; starred: boolean }>('/api/files/star', { path, starred }),

  async upload(parent: string, file: File): Promise<FileNode> {
    const query = new URLSearchParams({ path: parent, name: file.name })
    const response = await fetch(`/api/files/content?${query}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    })
    if (!response.ok) {
      let message = `Upload failed (${response.status})`
      try {
        const payload = (await response.json()) as { error?: string }
        if (payload.error) message = payload.error
      } catch {
        // Keep the status message.
      }
      throw new ApiError(message, response.status)
    }
    const payload = (await response.json()) as { file: FileNode }
    return payload.file
  },

  service: (unit: string, action: 'start' | 'stop' | 'restart') =>
    post<{ ok: true; unit: string; action: string }>('/api/services', { unit, action }),

  createSpace: (input: { name: string; email: string; role: UserRole; password?: string }) =>
    post<{ ok: true; space: Space }>('/api/users', input),
  setSpacePassword: (id: string, password: string) =>
    post<{ ok: true; space: Space }>(
      `/api/users/${encodeURIComponent(id)}/password`,
      { password },
    ),
  deleteSpace: (id: string) =>
    request<{ ok: true; slug: string; name: string }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  installApp: (id: string) =>
    post<{ ok: true; app: AppEntry }>('/api/apps', { id, action: 'install' }),
  removeApp: (id: string) =>
    post<{ ok: true; app: AppEntry }>('/api/apps', { id, action: 'remove' }),
}

export function downloadUrl(path: string, inline = false) {
  const query = new URLSearchParams({ path })
  if (inline) query.set('inline', '1')
  return `/api/files/content?${query}`
}
