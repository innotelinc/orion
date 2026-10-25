import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_SETTINGS } from '../data/system'
import { joinPath } from '../data/files'
import { api, ApiError, type StatePayload } from '../lib/api'
import { usePersistentState } from '../hooks/usePersistentState'
import type {
  AppEntry,
  FileNode,
  Metrics,
  NotificationItem,
  RootEntry,
  ServiceAction,
  Session,
  Settings,
  Space,
  StorageState,
  SystemInfo,
  SystemService,
  Toast,
  ToastTone,
  TrashItem,
  UserAccount,
  UserRole,
} from '../types'

const SETTINGS_KEY = 'orion.preferences.v2'

const EMPTY_METRICS: Metrics = {
  cpu: 0,
  ram: 0,
  temp: null,
  cpuMhz: 0,
  uptimeSeconds: 0,
  netDown: 0,
  netUp: 0,
  cpuHistory: [],
  ramHistory: [],
  netDownHistory: [],
  netUpHistory: [],
}

const EMPTY_STORAGE: StorageState = {
  pools: [],
  disks: [],
  files: { count: 0, folders: 0, bytes: 0 },
}

interface ActionResult {
  ok: boolean
  error?: string
}

interface AppContextValue {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  system: SystemInfo | null
  metrics: Metrics
  files: FileNode[]
  roots: RootEntry[]
  storage: StorageState
  session: Session
  /** Whether this host can create directory accounts, and the group it uses. */
  signin: { available: boolean; group: string }
  users: UserAccount[]
  spaces: Space[]
  apps: AppEntry[]
  services: SystemService[]
  notifications: NotificationItem[]
  loading: boolean
  error: string | null
  /** No edge session: the desktop is shown blurred until the person signs in. */
  locked: boolean
  refresh: () => Promise<void>
  addFolder: (parent: string, name: string) => Promise<ActionResult>
  addUploads: (parent: string, uploads: File[]) => Promise<number>
  renameFile: (id: string, name: string) => Promise<ActionResult>
  deleteFiles: (ids: string[]) => Promise<number>
  toggleStar: (id: string) => Promise<void>
  /** Items in Trash, loaded when Files opens that pane. */
  trashItems: TrashItem[]
  /** How many are in Trash, from the polled state. */
  trashCount: number
  loadTrash: () => Promise<void>
  restoreTrash: (name: string) => Promise<ActionResult>
  emptyTrash: () => Promise<ActionResult>
  serviceAction: (unit: string, action: ServiceAction) => Promise<ActionResult>
  addSpace: (input: {
    name: string
    email: string
    role: UserRole
    password?: string
    agency?: string
  }) => Promise<ActionResult>
  removeSpace: (id: string) => Promise<ActionResult>
  setSpacePassword: (id: string, password: string) => Promise<ActionResult>
  nameShareClient: (address: string, name: string) => Promise<ActionResult>
  setSpaceRole: (id: string, role: UserRole) => Promise<ActionResult>
  setSpaceShared: (id: string, shared: boolean) => Promise<ActionResult>
  setSpaceEmail: (id: string, email: string) => Promise<ActionResult>
  removeShare: (id: string) => Promise<ActionResult>
  createMySpace: (password: string) => Promise<ActionResult>
  changeMyPassword: (password: string) => Promise<ActionResult>
  installApp: (id: string) => Promise<ActionResult>
  removeApp: (id: string) => Promise<ActionResult>
  dismissNotification: (id: string) => void
  markAllRead: () => void
  markRead: (id: string) => void
  toasts: Toast[]
  pushToast: (input: { title: string; description?: string; tone?: ToastTone }) => void
  dismissToast: (id: string) => void
  resetPreferences: () => void
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
  return { ...DEFAULT_SETTINGS, ...(record as Partial<Settings>) }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = usePersistentState<Settings>(
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    reviveSettings,
  )
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS)
  const [state, setState] = useState<StatePayload>({
    files: [],
    storage: EMPTY_STORAGE,
    session: {
      role: 'Anonymous',
      email: '',
      agency: '',
      permissions: { manageUsers: false, scope: 'none', agency: '' },
    },
    signin: { available: false, group: 'orion-users' },
    users: [],
    spaces: [],
    apps: [],
    services: [],
    notifications: [],
    roots: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  // The polls read this ref so a locked desktop stops asking for data without
  // rebuilding the timers on every state change.
  const lockedRef = useRef(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [read, setRead] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<Toast[]>([])
  const [trashItems, setTrashItems] = useState<TrashItem[]>([])
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    // The old build seeded files, disks, users and notices into localStorage.
    // None of it is true now; drop it once so a returning browser cannot show
    // a stale inventory beside the live one.
    try {
      for (const key of [
        'orion.files.v1',
        'orion.storage.v1',
        'orion.users.v1',
        'orion.installed.v1',
        'orion.notifications.v1',
        'orion.settings.v1',
      ]) {
        window.localStorage.removeItem(key)
      }
    } catch {
      // Private mode or storage disabled: nothing to clean.
    }
    return () => {
      mounted.current = false
    }
  }, [])

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

  const loadState = useCallback(async () => {
    if (lockedRef.current) return
    const payload = await api.state()
    if (!mounted.current) return
    setState(payload)
    setError(null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [nextSystem, nextState] = await Promise.all([api.system(), api.state()])
      if (!mounted.current) return
      setSystem(nextSystem)
      setState(nextState)
      setError(null)
    } catch (failure) {
      if (!mounted.current) return
      // 401 is the edge saying "no session", not the host being broken: the
      // shell stays up behind a blur and the top bar offers Sign in.
      if (failure instanceof ApiError && failure.status === 401) {
        lockedRef.current = true
        setLocked(true)
        setError(null)
      } else {
        setError(failure instanceof Error ? failure.message : 'The API is unreachable.')
      }
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const stateTimer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      loadState().catch(() => undefined)
    }, 20_000)
    const metricsTimer = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || lockedRef.current) return
      api
        .metrics()
        .then((next) => {
          if (mounted.current) setMetrics(next)
        })
        .catch(() => undefined)
    }, 3000)
    const firstMetrics = window.setTimeout(() => {
      if (lockedRef.current) return
      api
        .metrics()
        .then((next) => {
          if (mounted.current) setMetrics(next)
        })
        .catch(() => undefined)
    }, 900)
    return () => {
      window.clearInterval(stateTimer)
      window.clearInterval(metricsTimer)
      window.clearTimeout(firstMetrics)
    }
  }, [loadState, refresh])

  const addFolder = useCallback(
    async (parent: string, rawName: string): Promise<ActionResult> => {
      const name = rawName.trim()
      if (!name) return { ok: false, error: 'Give the folder a name.' }
      if (name.length > 80) return { ok: false, error: 'Keep names under 80 characters.' }
      if (/[\\/]/.test(name)) return { ok: false, error: 'Names cannot contain slashes.' }
      if (name === '.' || name === '..') return { ok: false, error: 'That name is reserved.' }
      try {
        await api.mkdir(parent, name)
        await loadState()
        pushToast({ title: 'Folder created', description: joinPath(parent, name), tone: 'success' })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'Could not create that folder.',
        }
      }
    },
    [loadState, pushToast],
  )

  const addUploads = useCallback(
    async (parent: string, uploads: File[]): Promise<number> => {
      if (!uploads.length) return 0
      let uploaded = 0
      let bytes = 0
      for (const file of uploads) {
        try {
          const node = await api.upload(parent, file)
          bytes += node.size ?? file.size
          uploaded += 1
        } catch (failure) {
          pushToast({
            title: `Could not upload ${file.name}`,
            description: failure instanceof Error ? failure.message : 'The host refused it.',
            tone: 'error',
          })
        }
      }
      if (uploaded) {
        await loadState()
        pushToast({
          title: `${uploaded} ${uploaded === 1 ? 'file' : 'files'} uploaded`,
          description: `${bytes.toLocaleString()} bytes written to ${parent}`,
          tone: 'success',
        })
      }
      return uploaded
    },
    [loadState, pushToast],
  )

  const renameFile = useCallback(
    async (id: string, rawName: string): Promise<ActionResult> => {
      const name = rawName.trim()
      if (!name) return { ok: false, error: 'Name cannot be empty.' }
      if (/[\\/]/.test(name)) return { ok: false, error: 'Names cannot contain slashes.' }
      try {
        await api.rename(id, name)
        await loadState()
        pushToast({ title: 'Renamed', description: name, tone: 'success' })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'Could not rename that item.',
        }
      }
    },
    [loadState, pushToast],
  )

  const deleteFiles = useCallback(
    async (ids: string[]): Promise<number> => {
      if (!ids.length) return 0
      try {
        const result = await api.remove(ids)
        await loadState()
        pushToast({
          title: `${result.moved} ${result.moved === 1 ? 'item' : 'items'} moved to Trash`,
          description: 'They stay on disk until you empty Trash, so this can be undone.',
          tone: 'info',
        })
        return result.moved
      } catch (failure) {
        pushToast({
          title: 'Delete failed',
          description: failure instanceof Error ? failure.message : 'Nothing was moved.',
          tone: 'error',
        })
        return 0
      }
    },
    [loadState, pushToast],
  )

  const loadTrash = useCallback(async () => {
    try {
      const payload = await api.trash()
      setTrashItems(payload.items)
    } catch {
      // Trash is a convenience, not the page: an API that cannot answer leaves
      // the list empty rather than taking Files down with it.
      setTrashItems([])
    }
  }, [])

  const restoreTrash = useCallback(
    async (name: string): Promise<ActionResult> => {
      try {
        const result = await api.restoreTrash(name)
        await loadState()
        await loadTrash()
        pushToast({
          title: `Put back as ${result.name}`,
          description: result.path,
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error:
            failure instanceof Error ? failure.message : 'The host could not put that back.',
        }
      }
    },
    [loadState, loadTrash, pushToast],
  )

  const emptyTrash = useCallback(async (): Promise<ActionResult> => {
    try {
      const result = await api.emptyTrash()
      await loadState()
      await loadTrash()
      pushToast({
        title: result.removed
          ? `${result.removed} ${result.removed === 1 ? 'item' : 'items'} deleted for good`
          : 'Trash was already empty',
        description: result.removed ? 'What was in Trash is gone from the disk.' : undefined,
        tone: result.removed ? 'info' : 'success',
      })
      return { ok: true }
    } catch (failure) {
      return {
        ok: false,
        error: failure instanceof Error ? failure.message : 'The host refused to empty it.',
      }
    }
  }, [loadState, loadTrash, pushToast])

  const toggleStar = useCallback(
    async (id: string) => {
      const node = state.files.find((file) => file.id === id)
      try {
        await api.star(id, !node?.starred)
        setState((previous) => ({
          ...previous,
          files: previous.files.map((file) =>
            file.id === id ? { ...file, starred: !file.starred } : file,
          ),
        }))
      } catch (failure) {
        pushToast({
          title: 'Could not save the star',
          description: failure instanceof Error ? failure.message : 'The host refused it.',
          tone: 'error',
        })
      }
    },
    [pushToast, state.files],
  )

  const serviceAction = useCallback(
    async (unit: string, action: ServiceAction): Promise<ActionResult> => {
      try {
        await api.service(unit, action)
        await loadState()
        const done = action === 'restart' ? 'restarted' : action === 'stop' ? 'stopped' : 'started'
        pushToast({ title: `${unit} ${done}`, tone: 'success' })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'systemctl refused the change.',
        }
      }
    },
    [loadState, pushToast],
  )

  const addSpace = useCallback(
    async (input: {
      name: string
      email: string
      role: UserRole
      password?: string
      agency?: string
    }): Promise<ActionResult> => {
      try {
        const { space } = await api.createSpace(input)
        await loadState()
        pushToast({
          title: `${space.name} has a space`,
          description: space.signin
            ? `${space.path} is ready, shared over SMB, and can sign in as ${space.signin}.`
            : space.smb
              ? `${space.path} is ready, and shared over SMB.`
              : `${space.path} is ready for their files.`,
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'The host refused to create it.',
        }
      }
    },
    [loadState, pushToast],
  )

  const removeSpace = useCallback(
    async (id: string): Promise<ActionResult> => {
      try {
        const result = await api.deleteSpace(id)
        await loadState()
        pushToast({
          title: `${result.name} removed`,
          description: 'Their folder moved to Trash; nothing was unlinked.',
          tone: 'info',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'The host refused to delete it.',
        }
      }
    },
    [loadState, pushToast],
  )

  const setSpaceRole = useCallback(
    async (id: string, role: UserRole): Promise<ActionResult> => {
      try {
        const { space } = await api.setSpaceRole(id, role)
        await loadState()
        pushToast({
          title: `${space.name} is now ${space.role.toLowerCase()}`,
          description:
            space.role === 'Agency admin'
              ? 'They can add and remove the people filed under them.'
              : 'People filed under them are now unfiled; their folders are untouched.',
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error:
            failure instanceof Error
              ? failure.message
              : 'The host refused to change that role.',
        }
      }
    },
    [loadState, pushToast],
  )

  const setSpaceShared = useCallback(
    async (id: string, shared: boolean): Promise<ActionResult> => {
      try {
        const { space } = await api.setSpaceShared(id, shared)
        await loadState()
        pushToast({
          title: shared ? `${space.name} is open to everyone` : `${space.name} is private again`,
          description: shared
            ? 'Every account on this box can mount it, and files anyone writes stay writable for them all.'
            : `Only “${space.slug}” can mount it now. Every file stays where it is.`,
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error:
            failure instanceof Error ? failure.message : 'The host refused to change that share.',
        }
      }
    },
    [loadState, pushToast],
  )

  const setSpaceEmail = useCallback(
    async (id: string, email: string): Promise<ActionResult> => {
      try {
        const { space } = await api.setSpaceEmail(id, email)
        await loadState()
        pushToast({
          title: space.email ? `Address set to ${space.email}` : 'Address cleared',
          description: space.email
            ? `${space.name} is filed under it. This is a label, not a sign-in.`
            : `${space.name} no longer has an address recorded.`,
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error:
            failure instanceof Error ? failure.message : 'The host refused that address.',
        }
      }
    },
    [loadState, pushToast],
  )

  const createMySpace = useCallback(
    async (password: string): Promise<ActionResult> => {
      try {
        const { space } = await api.createMySpace(password)
        await loadState()
        pushToast({
          title: `Your space is ready: ${space.slug}`,
          description: space.smb
            ? `Mount \\\\ORION-NAS\\${space.slug} as “${space.slug}”.`
            : `${space.path} — set a password in Settings → Users to share it.`,
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'The host refused to create it.',
        }
      }
    },
    [loadState, pushToast],
  )

  const changeMyPassword = useCallback(
    async (password: string): Promise<ActionResult> => {
      try {
        const result = await api.changeMyPassword(password)
        await loadState()
        const parts = [
          result.share ? 'your share' : '',
          result.signin ? 'your sign-in' : '',
        ].filter(Boolean)
        pushToast({
          title: parts.length ? `Password changed for ${parts.join(' and ')}` : 'Password changed',
          description: result.share
            ? `Windows still asks for “${result.slug}” with this password.`
            : undefined,
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'The host refused that password.',
        }
      }
    },
    [loadState, pushToast],
  )

  const removeShare = useCallback(
    async (id: string): Promise<ActionResult> => {
      try {
        const { space } = await api.removeShare(id)
        await loadState()
        pushToast({
          title: `${space.name} is no longer shared`,
          description: 'The Samba account went with the share. The folder and its files stay.',
          tone: 'info',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error:
            failure instanceof Error ? failure.message : 'The host refused to remove the share.',
        }
      }
    },
    [loadState, pushToast],
  )

  const setSpacePassword = useCallback(
    async (id: string, password: string): Promise<ActionResult> => {
      try {
        await api.setSpacePassword(id, password)
        await loadState()
        pushToast({
          title: 'SMB password set',
          description: 'The share can be opened with that account now.',
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'The host refused that password.',
        }
      }
    },
    [loadState, pushToast],
  )

  const nameShareClient = useCallback(
    async (address: string, name: string): Promise<ActionResult> => {
      try {
        const result = await api.nameShareClient(address, name)
        await loadState()
        pushToast({
          title: name.trim() ? `Called “${result.name}” from now on` : `Back to ${result.name}`,
          description: 'Every share row, dialog and notice uses that name.',
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'The host refused that name.',
        }
      }
    },
    [loadState, pushToast],
  )

  const installApp = useCallback(
    async (id: string): Promise<ActionResult> => {
      try {
        const { app } = await api.installApp(id)
        await loadState()
        pushToast({
          title: `${app.name} installed`,
          description: `${app.unit} is ${app.state}.`,
          tone: 'success',
        })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'apt refused the install.',
        }
      }
    },
    [loadState, pushToast],
  )

  const removeApp = useCallback(
    async (id: string): Promise<ActionResult> => {
      try {
        const { app } = await api.removeApp(id)
        await loadState()
        pushToast({ title: `${app.name} removed`, tone: 'info' })
        return { ok: true }
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : 'apt refused the removal.',
        }
      }
    },
    [loadState, pushToast],
  )

  const dismissNotification = useCallback((id: string) => {
    setDismissed((previous) => new Set(previous).add(id))
  }, [])

  const markRead = useCallback((id: string) => {
    setRead((previous) => new Set(previous).add(id))
  }, [])

  const markAllRead = useCallback(() => {
    setRead(new Set(state.notifications.map((item) => item.id)))
  }, [state.notifications])

  const resetPreferences = useCallback(() => {
    try {
      window.localStorage.removeItem(SETTINGS_KEY)
    } catch {
      // Nothing to clear.
    }
    window.location.reload()
  }, [])

  const notifications = useMemo(
    () =>
      state.notifications
        .filter((item) => !dismissed.has(item.id))
        .map((item) => (read.has(item.id) ? { ...item, read: true } : item)),
    [dismissed, read, state.notifications],
  )

  // The polled state is the count's source of truth; the loaded list answers
  // before the next poll, so a delete shows up in the sidebar immediately.
  const trashCount = state.trash?.count ?? trashItems.length

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      updateSettings,
      system,
      metrics,
      files: state.files,
      roots: state.roots,
      storage: state.storage,
      session: state.session,
      signin: state.signin,
      users: state.users,
      spaces: state.spaces,
      apps: state.apps,
      services: state.services,
      notifications,
      loading,
      error,
      locked,
      refresh,
      addFolder,
      addUploads,
      renameFile,
      deleteFiles,
      toggleStar,
      trashItems,
      trashCount,
      loadTrash,
      restoreTrash,
      emptyTrash,
      serviceAction,
      addSpace,
      removeSpace,
      setSpacePassword,
      nameShareClient,
      setSpaceRole,
      setSpaceShared,
      setSpaceEmail,
      removeShare,
      createMySpace,
      changeMyPassword,
      installApp,
      removeApp,
      dismissNotification,
      markAllRead,
      markRead,
      toasts,
      pushToast,
      dismissToast,
      resetPreferences,
    }),
    [
      settings,
      updateSettings,
      system,
      metrics,
      state,
      notifications,
      loading,
      error,
      locked,
      refresh,
      addFolder,
      addUploads,
      renameFile,
      deleteFiles,
      toggleStar,
      trashItems,
      trashCount,
      loadTrash,
      restoreTrash,
      emptyTrash,
      serviceAction,
      addSpace,
      removeSpace,
      setSpacePassword,
      nameShareClient,
      setSpaceRole,
      setSpaceShared,
      setSpaceEmail,
      removeShare,
      createMySpace,
      changeMyPassword,
      installApp,
      removeApp,
      dismissNotification,
      markAllRead,
      markRead,
      toasts,
      pushToast,
      dismissToast,
      resetPreferences,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
