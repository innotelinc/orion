export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'
export type Accent = 'blue' | 'violet' | 'emerald' | 'amber'
export type Wallpaper = 'aurora' | 'nebula' | 'dawn'
export type Density = 'comfortable' | 'compact'
export type TimeFormat = '12' | '24'

export type RouteName = 'dashboard' | 'files' | 'apps' | 'storage' | 'settings'
export type SettingsTab = 'general' | 'appearance' | 'network' | 'users' | 'security' | 'about'

/** A page the desktop already has — the only "apps" it can open by itself. */
export interface AppDefinition {
  id: string
  name: string
  tagline: string
  description: string
  icon: string
  accent: string
  internalRoute: RouteName
  internalPath?: string
}

export type FileKind = 'folder' | 'file'
export type FileTone =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sheet'
  | 'archive'
  | 'code'
  | 'file'

export interface FileNode {
  /** Absolute desktop path, e.g. `/media/film.mkv`. */
  id: string
  name: string
  parent: string
  type: FileKind
  size: number | null
  modifiedAt: string
  owner: string
  starred?: boolean
  tone: FileTone
}

export type UserRole = 'Platform admin' | 'Agency admin' | 'Member' | 'Guest'

export interface UserAccount {
  id: string
  name: string
  email: string
  role: UserRole
  lastActive: string
  color: string
  isCurrent?: boolean
  account?: string
  home?: string
  /** Slug of the agency this account is filed under, if any. */
  agency?: string
  /** The API's answer to "may the person signed in now change this account?" */
  manageable?: boolean
}

/**
 * What the signed-in person may administer. `all` is a platform admin,
 * `agency` is an agency admin limited to their own people, `none` is a member.
 */
export interface Session {
  role: 'Platform admin' | 'Agency admin' | 'Member' | 'Anonymous'
  email: string
  agency: string
  permissions: {
    manageUsers: boolean
    scope: 'all' | 'agency' | 'none'
    agency: string
  }
}

/**
 * A person's own folder on the storage volume. There is no session attached:
 * adding one creates the directory, removing one moves it to Trash.
 */
export interface Space {
  id: string
  slug: string
  name: string
  email: string
  role: UserRole
  /** Desktop path of the folder, e.g. `/Users/ada`. */
  path: string
  usedBytes: number
  createdAt: string
  color: string
  /** True when the space also has a Samba account and an exported share. */
  smb: boolean
  /** Provider username when this space can also sign in, else ''. */
  signin?: string
  /** Slug of the agency admin this person is filed under, if any. */
  agency?: string
  /** Whether the session may remove or re-key this person. */
  manageable?: boolean
}

/** Something the host can install. `installed` and `state` come from dpkg and systemd. */
export interface AppEntry {
  id: string
  name: string
  tagline: string
  description: string
  category: string
  packages: string[]
  unit: string
  installed: boolean
  active: boolean
  state: string
}

export interface Disk {
  id: string
  name: string
  model: string
  capacityBytes: number
  temperature: number | null
  health: 'Healthy' | 'Warning'
  kind: 'SSD' | 'HDD' | 'NVMe'
  note: string
}

export interface Pool {
  id: string
  name: string
  mount: string
  source: string
  usedBytes: number
  totalBytes: number
  freeBytes: number
  health: 'Healthy' | 'Warning'
  kind: string
}

export interface StorageState {
  pools: Pool[]
  disks: Disk[]
  files: { count: number; folders: number; bytes: number }
}

export type ServiceAction = 'start' | 'stop' | 'restart'

export interface SystemService {
  id: string
  name: string
  description: string
  active: string
  sub: string
  running: boolean
}

export interface NetworkFacts {
  interface: string
  method: 'dhcp' | 'static'
  ip: string
  prefix: string
  gateway: string
  dns: string[]
  mac: string
  linkMbps: number | null
}

export interface Identity {
  email: string
  name: string
  username: string
  groups: string[]
}

export interface SystemInfo {
  hostname: string
  kernel: string
  arch: string
  cpu: { model: string; cores: number }
  memory: { totalBytes: number; usedBytes: number; availableBytes: number; percent: number }
  uptimeSeconds: number
  runtime: string
  network: NetworkFacts
  storageRoot: string
  version: { version: string; build: string; builtAt: string | null }
  identity: Identity | null
  generatedAt: string
}

export interface Metrics {
  cpu: number
  ram: number
  temp: number | null
  cpuMhz: number
  uptimeSeconds: number
  netDown: number
  netUp: number
  cpuHistory: number[]
  ramHistory: number[]
  netDownHistory: number[]
  netUpHistory: number[]
}

export interface RootEntry {
  label: string
  path: string
}

export type NotificationTone = 'info' | 'success' | 'warning' | 'danger'

export interface NotificationAction {
  label: string
  route: RouteName
  path?: string
  tab?: SettingsTab
}

export interface NotificationItem {
  id: string
  title: string
  body: string
  tone: NotificationTone
  time: string
  read: boolean
  action?: NotificationAction
}

/** Preferences only. Anything about the machine comes from the API. */
export interface Settings {
  theme: ThemeMode
  accent: Accent
  wallpaper: Wallpaper
  density: Density
  reduceMotion: boolean
  timeFormat: TimeFormat
  language: string
  timezone: string
}

export type ToastTone = 'success' | 'error' | 'info'
export interface Toast {
  id: string
  title: string
  description?: string
  tone: ToastTone
}
