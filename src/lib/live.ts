import type { Disk, FileNode, Pool, UserAccount } from '../types'

/**
 * What the installed server reports about the machine it runs on.
 * `null` anywhere means "this host cannot tell us" — the UI shows a dash rather
 * than a number we made up.
 */
export interface LiveSystem {
  hostname: string
  platform: string
  arch: string
  cpu: { model: string; cores: number; usage: number; clockGhz: number; load: number }
  memory: { totalGb: number; usedGb: number; percent: number }
  temperature: number | null
  network: { down: number; up: number }
  uptimeSeconds: number
  uptimeDays: number
}

export interface LiveListing {
  path: string
  entries: FileNode[]
}

export interface LiveStorage {
  pools: Pool[]
  disks: Disk[]
}

export interface LiveSnapshot {
  system: LiveSystem
  storage: LiveStorage
  users: UserAccount[]
  files: FileNode[]
}

/**
 * Fetch JSON from the live API.
 *
 * Returns null on anything that is not a real answer. That matters for GitHub
 * Pages: every path there resolves to the SPA shell, so `/api/system` comes back
 * 200 with `text/html` and must not be mistaken for data. Null means "no live
 * backend", and the app keeps running on its demo dataset.
 */
export async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { headers: { accept: 'application/json' } })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** One round trip at startup: everything the shell needs to be a real NAS panel. */
export async function loadLiveSnapshot(): Promise<LiveSnapshot | null> {
  const system = await getJson<LiveSystem>('/api/system')
  if (!system) return null

  const [storage, users, root] = await Promise.all([
    getJson<LiveStorage>('/api/storage'),
    getJson<UserAccount[]>('/api/users'),
    getJson<LiveListing>(`/api/files?path=${encodeURIComponent('/')}`),
  ])

  const roots = root?.entries ?? []
  // Prime one level so the sidebar can show what each mount holds before the
  // user clicks into it. Deeper levels are fetched on navigation.
  const children = await Promise.all(
    roots
      .filter((entry) => entry.type === 'folder')
      .map((entry) =>
        getJson<LiveListing>(`/api/files?path=${encodeURIComponent(`/${entry.name}`)}`),
      ),
  )

  return {
    system,
    storage: storage ?? { pools: [], disks: [] },
    users: users ?? [],
    files: [...roots, ...children.flatMap((listing) => listing?.entries ?? [])],
  }
}

/** Directory contents for one path, fetched when the user navigates there. */
export async function loadListing(path: string): Promise<LiveListing | null> {
  return getJson<LiveListing>(`/api/files?path=${encodeURIComponent(path)}`)
}

/** A fresh system sample; the dashboard polls this to keep its charts alive. */
export async function loadSystem(): Promise<LiveSystem | null> {
  return getJson<LiveSystem>('/api/system')
}
