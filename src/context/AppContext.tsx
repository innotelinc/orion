import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { APP_BY_ID, DEFAULT_INSTALLED_IDS } from '../data/apps'
import { INITIAL_FILES, joinPath } from '../data/files'
import {
  DEFAULT_SETTINGS,
  INITIAL_NOTIFICATIONS,
  INITIAL_STORAGE,
  INITIAL_USERS,
} from '../data/system'
import { formatBytes } from '../lib/format'
import { usePersistentState } from '../hooks/usePersistentState'
import type {
  AppDefinition,
  FileNode,
  FileTone,
  InstalledApp,
  NotificationItem,
  Settings,
  StorageState,
  Toast,
  ToastTone,
  UserAccount,
} from '../types'

const KEYS = {
  settings: 'orion.settings.v1',
  installed: 'orion.installed.v1',
  files: 'orion.files.v1',
  users: 'orion.users.v1',
  storage: 'orion.storage.v1',
  notifications: 'orion.notifications.v1',
} as const

interface ActionResult {
  ok: boolean
  error?: string
}

interface AddUserInput {
  name: string
  email: string
  role: UserAccount['role']
}

interface AppContextValue {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  installed: Record<string, InstalledApp>
  installApp: (app: AppDefinition) => void
  uninstallApp: (id: string) => void
  toggleAppRunning: (id: string) => void
  files: FileNode[]
  addFolder: (parent: string, name: string) => ActionResult
  addUploads: (parent: string, uploads: Array<{ name: string; size: number }>) => number
  renameFile: (id: string, name: string) => ActionResult
  deleteFiles: (ids: string[]) => number
  toggleStar: (id: string) => void
  storage: StorageState
  assignDisks: (diskIds: string[], poolName: string) => ActionResult
  createPool: (name: string, diskIds: string[]) => ActionResult
  users: UserAccount[]
  addUser: (input: AddUserInput) => ActionResult
  removeUser: (id: string) => ActionResult
  notifications: NotificationItem[]
  dismissNotification: (id: string) => void
  markAllRead: () => void
  markRead: (id: string) => void
  toasts: Toast[]
  pushToast: (input: { title: string; description?: string; tone?: ToastTone }) => void
  dismissToast: (id: string) => void
  resetDemo: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

function newId(prefix: string) {
  const unique =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${unique}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function reviveSettings(value: unknown): Settings {
  const record = asRecord(value)
  if (!record) return DEFAULT_SETTINGS
  const network = asRecord(record.network)
  const security = asRecord(record.security)
  return {
    ...DEFAULT_SETTINGS,
    ...(record as Partial<Settings>),
    network: { ...DEFAULT_SETTINGS.network, ...(network ?? {}) },
    security: { ...DEFAULT_SETTINGS.security, ...(security ?? {}) },
  }
}

function seedInstalled(): Record<string, InstalledApp> {
  const now = Date.now()
  return Object.fromEntries(
    DEFAULT_INSTALLED_IDS.map((id, index) => [
      id,
      {
        id,
        installedAt: new Date(now - index * 86_400_000).toISOString(),
        running: APP_BY_ID.get(id)?.runningByDefault ?? true,
      },
    ]),
  )
}

function reviveInstalled(value: unknown): Record<string, InstalledApp> {
  const record = asRecord(value)
  if (!record) return seedInstalled()
  const next: Record<string, InstalledApp> = {}
  for (const [id, entry] of Object.entries(record)) {
    const item = asRecord(entry)
    if (!APP_BY_ID.has(id) || !item) continue
    next[id] = {
      id,
      installedAt: typeof item.installedAt === 'string' ? item.installedAt : new Date().toISOString(),
      running: item.running !== false,
    }
  }
  return next
}

function reviveFiles(value: unknown): FileNode[] {
  if (!Array.isArray(value)) return INITIAL_FILES
  const valid = value.every((item) => {
    const node = asRecord(item)
    return (
      node &&
      typeof node.id === 'string' &&
      typeof node.name === 'string' &&
      typeof node.parent === 'string' &&
      (node.type === 'file' || node.type === 'folder')
    )
  })
  if (!valid) return INITIAL_FILES
  return (value as FileNode[]).map((node) => ({
    ...node,
    owner:
      node.owner === 'alex'
        ? 'u-alex'
        : node.owner === 'sam'
          ? 'u-sam'
          : node.owner === 'priya'
            ? 'u-priya'
            : node.owner,
  }))
}

function reviveUsers(value: unknown): UserAccount[] {
  if (!Array.isArray(value)) return INITIAL_USERS
  const valid = value.every((item) => {
    const user = asRecord(item)
    return user && typeof user.id === 'string' && typeof user.name === 'string' && typeof user.email === 'string'
  })
  return valid ? (value as UserAccount[]) : INITIAL_USERS
}

function reviveStorage(value: unknown): StorageState {
  const record = asRecord(value)
  if (!record || !Array.isArray(record.pools) || !Array.isArray(record.disks)) {
    return INITIAL_STORAGE
  }
  return value as StorageState
}

function reviveNotifications(value: unknown): NotificationItem[] {
  return Array.isArray(value) ? (value as NotificationItem[]) : INITIAL_NOTIFICATIONS
}

function toneForName(name: string): FileTone {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif', 'svg', 'raw'].includes(extension)) return 'image'
  if (['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(extension)) return 'video'
  if (['mp3', 'flac', 'wav', 'm4a', 'm4b', 'ogg'].includes(extension)) return 'audio'
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(extension)) return 'document'
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(extension)) return 'sheet'
  if (['zip', 'tar', 'gz', 'zst', '7z', 'rar', 'iso', 'snap', 'pkg'].includes(extension)) return 'archive'
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'css', 'html', 'py', 'sh', 'yml', 'yaml'].includes(extension)) return 'code'
  return 'file'
}

function uniqueName(existing: Set<string>, rawName: string) {
  if (!existing.has(rawName.toLowerCase())) return rawName
  const dot = rawName.lastIndexOf('.')
  const base = dot > 0 ? rawName.slice(0, dot) : rawName
  const extension = dot > 0 ? rawName.slice(dot) : ''
  let counter = 2
  let candidate = `${base} (${counter})${extension}`
  while (existing.has(candidate.toLowerCase())) {
    counter += 1
    candidate = `${base} (${counter})${extension}`
  }
  return candidate
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = usePersistentState<Settings>(
    KEYS.settings,
    DEFAULT_SETTINGS,
    reviveSettings,
  )
  const [installed, setInstalled] = usePersistentState<Record<string, InstalledApp>>(
    KEYS.installed,
    seedInstalled(),
    reviveInstalled,
  )
  const [files, setFiles] = usePersistentState<FileNode[]>(KEYS.files, INITIAL_FILES, reviveFiles)
  const [users, setUsers] = usePersistentState<UserAccount[]>(KEYS.users, INITIAL_USERS, reviveUsers)
  const [storage, setStorage] = usePersistentState<StorageState>(
    KEYS.storage,
    INITIAL_STORAGE,
    reviveStorage,
  )
  const [notifications, setNotifications] = usePersistentState<NotificationItem[]>(
    KEYS.notifications,
    INITIAL_NOTIFICATIONS,
    reviveNotifications,
  )
  const [toasts, setToasts] = useState<Toast[]>([])

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((previous) => ({ ...previous, ...patch }))
    },
    [setSettings],
  )

  const pushToast = useCallback(
    (input: { title: string; description?: string; tone?: ToastTone }) => {
      const toast: Toast = {
        id: newId('toast'),
        title: input.title,
        description: input.description,
        tone: input.tone ?? 'success',
      }
      setToasts((previous) => [...previous.slice(-3), toast])
    },
    [],
  )

  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const installApp = useCallback(
    (app: AppDefinition) => {
      setInstalled((previous) => ({
        ...previous,
        [app.id]: {
          id: app.id,
          installedAt: new Date().toISOString(),
          running: true,
        },
      }))
      pushToast({
        title: `${app.name} is ready`,
        description: 'Installed and running — no configuration required.',
        tone: 'success',
      })
    },
    [pushToast, setInstalled],
  )

  const uninstallApp = useCallback(
    (id: string) => {
      const app = APP_BY_ID.get(id)
      setInstalled((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      if (app) {
        pushToast({
          title: `${app.name} uninstalled`,
          description: 'Its data volume was kept in /AppData.',
          tone: 'info',
        })
      }
    },
    [pushToast, setInstalled],
  )

  const toggleAppRunning = useCallback(
    (id: string) => {
      const current = installed[id]
      if (!current) return
      const running = !current.running
      const app = APP_BY_ID.get(id)
      setInstalled((previous) => ({
        ...previous,
        [id]: { ...previous[id], running },
      }))
      pushToast({
        title: `${app?.name ?? 'App'} ${running ? 'started' : 'stopped'}`,
        description: running ? 'Container is healthy.' : 'Container is paused, data preserved.',
        tone: 'info',
      })
    },
    [installed, pushToast, setInstalled],
  )

  const addFolder = useCallback(
    (parent: string, rawName: string): ActionResult => {
      const name = rawName.trim()
      if (!name) return { ok: false, error: 'Give the folder a name.' }
      if (name.length > 80) return { ok: false, error: 'Keep names under 80 characters.' }
      if (/[\\/]/.test(name)) return { ok: false, error: 'Names cannot contain slashes.' }
      if (name === '.' || name === '..') return { ok: false, error: 'That name is reserved.' }
      const duplicate = files.some(
        (node) => node.parent === parent && node.name.toLowerCase() === name.toLowerCase(),
      )
      if (duplicate) return { ok: false, error: 'A file or folder with that name already exists.' }
      const node: FileNode = {
        id: newId('folder'),
        name,
        parent,
        type: 'folder',
        size: null,
        modifiedAt: new Date().toISOString(),
        owner: 'u-alex',
        tone: 'folder',
      }
      setFiles((previous) => [...previous, node])
      pushToast({ title: 'Folder created', description: joinPath(parent, name), tone: 'success' })
      return { ok: true }
    },
    [files, pushToast, setFiles],
  )

  const addUploads = useCallback(
    (parent: string, uploads: Array<{ name: string; size: number }>) => {
      if (!uploads.length) return 0
      const existing = new Set(
        files.filter((node) => node.parent === parent).map((node) => node.name.toLowerCase()),
      )
      const now = new Date().toISOString()
      const nodes = uploads.map((upload) => {
        const safeName = uniqueName(existing, upload.name || 'Untitled file')
        existing.add(safeName.toLowerCase())
        return {
          id: newId('file'),
          name: safeName,
          parent,
          type: 'file' as const,
          size: Number.isFinite(upload.size) ? Math.max(0, upload.size) : 0,
          modifiedAt: now,
          owner: 'u-alex',
          tone: toneForName(safeName),
        }
      })
      setFiles((previous) => [...previous, ...nodes])
      pushToast({
        title: `${nodes.length} ${nodes.length === 1 ? 'file' : 'files'} uploaded`,
        description: `${formatBytes(nodes.reduce((total, node) => total + (node.size ?? 0), 0))} added to ${parent}`,
        tone: 'success',
      })
      return nodes.length
    },
    [files, pushToast, setFiles],
  )

  const renameFile = useCallback(
    (id: string, rawName: string): ActionResult => {
      const name = rawName.trim()
      if (!name) return { ok: false, error: 'Name cannot be empty.' }
      if (/[\\/]/.test(name)) return { ok: false, error: 'Names cannot contain slashes.' }
      const target = files.find((node) => node.id === id)
      if (!target) return { ok: false, error: 'That item no longer exists.' }
      const duplicate = files.some(
        (node) =>
          node.id !== id &&
          node.parent === target.parent &&
          node.name.toLowerCase() === name.toLowerCase(),
      )
      if (duplicate) return { ok: false, error: 'An item with that name already exists.' }
      setFiles((previous) =>
        previous.map((node) =>
          node.id === id
            ? {
                ...node,
                name,
                tone: node.type === 'file' ? toneForName(name) : 'folder',
                modifiedAt: new Date().toISOString(),
              }
            : node,
        ),
      )
      pushToast({ title: 'Renamed', description: name, tone: 'success' })
      return { ok: true }
    },
    [files, pushToast, setFiles],
  )

  const deleteFiles = useCallback(
    (ids: string[]) => {
      if (!ids.length) return 0
      const idSet = new Set(ids)
      const selected = files.filter((node) => idSet.has(node.id))
      const folderPaths = selected
        .filter((node) => node.type === 'folder')
        .map((node) => joinPath(node.parent, node.name))
      const remaining = files.filter((node) => {
        if (idSet.has(node.id)) return false
        return !folderPaths.some(
          (path) => node.parent === path || node.parent.startsWith(`${path}/`),
        )
      })
      const removed = files.length - remaining.length
      setFiles(remaining)
      pushToast({
        title: `${removed} ${removed === 1 ? 'item' : 'items'} moved to trash`,
        description: 'You can restore them from Backups → Trash.',
        tone: 'info',
      })
      return removed
    },
    [files, pushToast, setFiles],
  )

  const toggleStar = useCallback(
    (id: string) => {
      setFiles((previous) =>
        previous.map((node) => (node.id === id ? { ...node, starred: !node.starred } : node)),
      )
    },
    [setFiles],
  )

  const assignDisks = useCallback(
    (diskIds: string[], poolName: string): ActionResult => {
      if (!diskIds.length) return { ok: false, error: 'Select at least one disk.' }
      const pool = storage.pools.find((item) => item.name === poolName)
      if (!pool) return { ok: false, error: 'Choose a pool for these disks.' }
      const disks = storage.disks.filter(
        (disk) => diskIds.includes(disk.id) && disk.pool === null,
      )
      if (!disks.length) return { ok: false, error: 'Those disks are already assigned.' }
      const added = disks.reduce((total, disk) => total + disk.capacityTb, 0)
      setStorage((previous) => ({
        pools: previous.pools.map((item) =>
          item.name === poolName ? { ...item, totalTb: item.totalTb + added } : item,
        ),
        disks: previous.disks.map((disk) =>
          diskIds.includes(disk.id) && disk.pool === null
            ? { ...disk, pool: poolName }
            : disk,
        ),
      }))
      pushToast({
        title: 'Pool expanded',
        description: `${disks.length} ${disks.length === 1 ? 'disk' : 'disks'} added to ${poolName}.`,
        tone: 'success',
      })
      return { ok: true }
    },
    [pushToast, setStorage, storage.disks, storage.pools],
  )

  const createPool = useCallback(
    (rawName: string, diskIds: string[]): ActionResult => {
      const name = rawName.trim()
      if (!name) return { ok: false, error: 'Give the pool a name.' }
      if (storage.pools.some((pool) => pool.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, error: 'A pool with that name already exists.' }
      }
      if (!diskIds.length) return { ok: false, error: 'Select at least one disk.' }
      const disks = storage.disks.filter(
        (disk) => diskIds.includes(disk.id) && disk.pool === null,
      )
      if (!disks.length) return { ok: false, error: 'Those disks are already assigned.' }
      const rawCapacity = disks.reduce((total, disk) => total + disk.capacityTb, 0)
      const usable =
        disks.length === 1
          ? rawCapacity
          : disks.length === 2
            ? rawCapacity / 2
            : rawCapacity - Math.max(...disks.map((disk) => disk.capacityTb))
      const id = newId('pool')
      setStorage((previous) => ({
        pools: [
          ...previous.pools,
          {
            id,
            name,
            usedTb: 0,
            totalTb: Math.round(usable * 10) / 10,
            raid: disks.length >= 3 ? 'RAID 5' : disks.length === 2 ? 'RAID 1' : 'Single',
            health: 'Healthy',
            mount: `/mnt/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          },
        ],
        disks: previous.disks.map((disk) =>
          diskIds.includes(disk.id) && disk.pool === null ? { ...disk, pool: name } : disk,
        ),
      }))
      pushToast({
        title: `${name} created`,
        description: `${usable.toFixed(1)} TB usable across ${disks.length} ${disks.length === 1 ? 'disk' : 'disks'}.`,
        tone: 'success',
      })
      return { ok: true }
    },
    [pushToast, setStorage, storage.disks, storage.pools],
  )

  const addUser = useCallback(
    (input: AddUserInput): ActionResult => {
      const name = input.name.trim()
      const email = input.email.trim().toLowerCase()
      if (name.length < 2) return { ok: false, error: 'Enter a name with at least 2 characters.' }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: 'Enter a valid email address.' }
      }
      if (users.some((user) => user.email.toLowerCase() === email)) {
        return { ok: false, error: 'A user with that email already exists.' }
      }
      const palette = ['#0a63ff', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4']
      setUsers((previous) => [
        ...previous,
        {
          id: newId('user'),
          name,
          email,
          role: input.role,
          lastActive: 'Invited',
          color: palette[previous.length % palette.length],
        },
      ])
      pushToast({ title: `${name} invited`, description: `${email} · ${input.role}`, tone: 'success' })
      return { ok: true }
    },
    [pushToast, setUsers, users],
  )

  const removeUser = useCallback(
    (id: string): ActionResult => {
      const user = users.find((item) => item.id === id)
      if (!user) return { ok: false, error: 'User not found.' }
      if (user.isCurrent) return { ok: false, error: 'You cannot remove your own account.' }
      if (user.role === 'Owner') return { ok: false, error: 'The owner account is protected.' }
      setUsers((previous) => previous.filter((item) => item.id !== id))
      pushToast({ title: `${user.name} removed`, description: 'Their share permissions were revoked.', tone: 'info' })
      return { ok: true }
    },
    [pushToast, setUsers, users],
  )

  const dismissNotification = useCallback(
    (id: string) => setNotifications((previous) => previous.filter((item) => item.id !== id)),
    [setNotifications],
  )

  const markRead = useCallback(
    (id: string) =>
      setNotifications((previous) =>
        previous.map((item) => (item.id === id ? { ...item, read: true } : item)),
      ),
    [setNotifications],
  )

  const markAllRead = useCallback(
    () => setNotifications((previous) => previous.map((item) => ({ ...item, read: true }))),
    [setNotifications],
  )

  const resetDemo = useCallback(() => {
    for (const key of Object.values(KEYS)) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Ignore storage failures.
      }
    }
    window.location.reload()
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      updateSettings,
      installed,
      installApp,
      uninstallApp,
      toggleAppRunning,
      files,
      addFolder,
      addUploads,
      renameFile,
      deleteFiles,
      toggleStar,
      storage,
      assignDisks,
      createPool,
      users,
      addUser,
      removeUser,
      notifications,
      dismissNotification,
      markAllRead,
      markRead,
      toasts,
      pushToast,
      dismissToast,
      resetDemo,
    }),
    [
      settings,
      updateSettings,
      installed,
      installApp,
      uninstallApp,
      toggleAppRunning,
      files,
      addFolder,
      addUploads,
      renameFile,
      deleteFiles,
      toggleStar,
      storage,
      assignDisks,
      createPool,
      users,
      addUser,
      removeUser,
      notifications,
      dismissNotification,
      markAllRead,
      markRead,
      toasts,
      pushToast,
      dismissToast,
      resetDemo,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
