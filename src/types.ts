export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'
export type Accent = 'blue' | 'violet' | 'emerald' | 'amber'
export type Wallpaper = 'aurora' | 'nebula' | 'dawn'
export type Density = 'comfortable' | 'compact'

export type RouteName = 'dashboard' | 'files' | 'apps' | 'storage' | 'settings'
export type SettingsTab = 'general' | 'appearance' | 'network' | 'users' | 'security' | 'about'

export type AppCategory =
  | 'Media'
  | 'Productivity'
  | 'Monitoring'
  | 'Security'
  | 'Utilities'
  | 'System'

export interface AppDefinition {
  id: string
  name: string
  tagline: string
  description: string
  category: AppCategory
  icon: string
  accent: string
  developer: string
  rating: number
  downloads: string
  size: string
  version: string
  internalRoute?: RouteName
  internalPath?: string
  defaultInstalled?: boolean
  featured?: boolean
  runningByDefault?: boolean
}

export interface InstalledApp {
  id: string
  installedAt: string
  running: boolean
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

export interface UserAccount {
  id: string
  name: string
  email: string
  role: 'Owner' | 'Admin' | 'Member' | 'Guest'
  lastActive: string
  color: string
  isCurrent?: boolean
}

export interface Disk {
  id: string
  name: string
  model: string
  capacityTb: number
  pool: string | null
  temperature: number
  health: 'Healthy' | 'Warning'
  kind: 'SSD' | 'HDD' | 'NVMe'
}

export interface Pool {
  id: string
  name: string
  usedTb: number
  totalTb: number
  raid: string
  health: 'Healthy' | 'Degraded'
  mount: string
}

export interface StorageState {
  pools: Pool[]
  disks: Disk[]
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

export interface Settings {
  theme: ThemeMode
  accent: Accent
  wallpaper: Wallpaper
  density: Density
  reduceMotion: boolean
  hostname: string
  language: string
  timezone: string
  updateChannel: 'stable' | 'beta'
  autoUpdate: boolean
  network: {
    method: 'dhcp' | 'static'
    ip: string
    gateway: string
    dns: string
  }
  security: {
    remoteAccess: boolean
    twoFactor: boolean
    firewall: boolean
    autoLock: '5' | '10' | '30' | 'never'
  }
}

export type ToastTone = 'success' | 'error' | 'info'
export interface Toast {
  id: string
  title: string
  description?: string
  tone: ToastTone
}
