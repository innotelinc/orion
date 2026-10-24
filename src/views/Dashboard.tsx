import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  CircleCheckBig,
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  HardDrive,
  Image as ImageIcon,
  Info,
  Music,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { BUILTIN_APPS } from '../data/apps'
import { useApp } from '../context/AppContext'
import { formatBytes, formatClock, formatDay, formatPercent, greeting, relativeTime } from '../lib/format'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'
import type { FileTone, NotificationTone } from '../types'
import { AppIcon } from '../components/ui/AppIcon'
import { ProgressBar } from '../components/ui/ProgressBar'
import { Sparkline } from '../components/ui/Sparkline'
import { StatusBadge } from '../components/ui/StatusBadge'

const NOTICE_ICONS: Record<NotificationTone, typeof Info> = {
  info: Info,
  success: CircleCheckBig,
  warning: TriangleAlert,
  danger: ShieldAlert,
}

const FILE_ICONS: Record<FileTone, typeof File> = {
  folder: Folder,
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
  sheet: FileSpreadsheet,
  archive: FileArchive,
  code: FileCode,
  file: File,
}

function MetricRing({
  value,
  label,
  detail,
  tone,
}: {
  value: number
  label: string
  detail: string
  tone: 'accent' | 'success'
}) {
  const circumference = 2 * Math.PI * 41
  const fill = (Math.min(100, Math.max(0, value)) / 100) * circumference
  return (
    <div className="metric-ring">
      <div className="metric-ring__visual">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="metric-ring__track" cx="50" cy="50" r="41" />
          <circle
            className={`metric-ring__value metric-ring__value--${tone}`}
            cx="50"
            cy="50"
            r="41"
            strokeDasharray={`${fill} ${circumference}`}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div className="metric-ring__center">
          <strong className="tabular">
            {value}
            <span>%</span>
          </strong>
          <small>{label}</small>
        </div>
      </div>
      <span className="metric-ring__detail">{detail}</span>
    </div>
  )
}

function uptimeLabel(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

function ClockCard() {
  const { settings, system, metrics } = useApp()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const name = system?.identity?.name || system?.identity?.email?.split('@')[0] || 'there'

  return (
    <section className="clock-card card" aria-label="Date and time">
      <div className="clock-card__top">
        <span className="clock-card__greeting">
          {greeting(now)}, {name}
        </span>
        <StatusBadge tone="success">Online</StatusBadge>
      </div>
      <time className="clock-card__time tabular" dateTime={now.toISOString()}>
        {formatClock(now, settings.timeFormat)}
      </time>
      <p className="clock-card__date">{formatDay(now)}</p>
      <div className="clock-card__meta">
        <span className="live-dot" aria-hidden="true" />
        Up {uptimeLabel(metrics.uptimeSeconds || system?.uptimeSeconds || 0)} ·{' '}
        {system ? `${system.hostname} · ${system.version.version}` : 'connecting…'}
      </div>
    </section>
  )
}

function SystemCard({ onDetails }: { onDetails?: () => void }) {
  const { metrics, system } = useApp()
  const memory = system?.memory

  return (
    <section className="system-card card" aria-labelledby="system-title">
      <header className="widget-head">
        <h2 id="system-title">System</h2>
        {onDetails ? (
          <button type="button" className="widget-link" onClick={onDetails}>
            Details
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <div className="system-card__gauges">
        <MetricRing
          value={metrics.cpu}
          label="CPU"
          detail={`${(metrics.cpuMhz / 1000).toFixed(2)} GHz${
            metrics.temp === null ? '' : ` · ${metrics.temp}°C`
          }`}
          tone="accent"
        />
        <MetricRing
          value={metrics.ram}
          label="RAM"
          detail={
            memory
              ? `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`
              : '—'
          }
          tone="success"
        />
      </div>
      <div className="system-card__spark">
        <Sparkline
          values={metrics.cpuHistory.length ? metrics.cpuHistory : [0, 0]}
          height={28}
          color="var(--accent)"
          showGrid={false}
          label="CPU utilisation trend"
        />
      </div>
    </section>
  )
}

function StorageCard({ onOpen }: { onOpen: () => void }) {
  const { storage } = useApp()
  const used = storage.pools.reduce((total, pool) => total + pool.usedBytes, 0)
  const total = storage.pools.reduce((sum, pool) => sum + pool.totalBytes, 0)
  const percent = formatPercent(used, total)
  const warning = storage.pools.some((pool) => pool.health === 'Warning')

  return (
    <section className="storage-widget card" aria-labelledby="storage-widget-title">
      <header className="widget-head">
        <h2 id="storage-widget-title">Storage</h2>
        <button
          type="button"
          className="icon-button icon-button--sm"
          aria-label="Open storage settings"
          onClick={onOpen}
        >
          <Settings2 size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="storage-widget__body">
        <span className="storage-widget__orb" aria-hidden="true">
          <HardDrive size={26} />
        </span>
        <div className="storage-widget__copy">
          <div className="storage-widget__line">
            <StatusBadge tone={warning ? 'warning' : 'success'}>
              {warning ? 'Attention' : 'Healthy'}
            </StatusBadge>
            <span className="storage-widget__percent tabular">{percent}%</span>
          </div>
          <p>
            <strong className="tabular">{formatBytes(used)}</strong> of {formatBytes(total)} used
          </p>
        </div>
      </div>
      <ProgressBar value={percent} label="Storage used" />
      <button type="button" className="storage-widget__footer" onClick={onOpen}>
        {storage.pools.length} volumes · {storage.disks.length} devices
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </section>
  )
}

function NetworkCard() {
  const { metrics, system } = useApp()
  const link = system?.network.linkMbps
  return (
    <section className="network-card card" aria-labelledby="network-title">
      <header className="widget-head">
        <h2 id="network-title">Network</h2>
        <span className="iface-chip">
          <span className="live-dot" aria-hidden="true" />
          {system?.network.interface ?? 'eth0'}
        </span>
      </header>
      <div className="network-card__chart">
        <Sparkline
          values={metrics.netDownHistory.length ? metrics.netDownHistory : [0, 0]}
          color="var(--info)"
          height={78}
          label="Download throughput"
        />
        <Sparkline
          values={metrics.netUpHistory.length ? metrics.netUpHistory : [0, 0]}
          color="var(--success)"
          height={78}
          showGrid={false}
          className="network-card__overlay"
          label="Upload throughput"
        />
      </div>
      <div className="network-card__legend">
        <span>
          <span className="legend-icon legend-icon--down" aria-hidden="true">
            <ArrowDown size={11} />
          </span>
          <strong className="tabular">{formatBytes(metrics.netDown)}</strong>/s
        </span>
        <span>
          <span className="legend-icon legend-icon--up" aria-hidden="true">
            <ArrowUp size={11} />
          </span>
          <strong className="tabular">{formatBytes(metrics.netUp)}</strong>/s
        </span>
        <span className="network-card__link">
          {link ? `${(link / 1000).toFixed(0)} GbE` : system?.network.ip || 'offline'}
        </span>
      </div>
    </section>
  )
}

interface Tile {
  id: string
  name: string
  icon: string
  accent: string
  running: boolean
  onLaunch: () => void
}

function AppTile({ tile }: { tile: Tile }) {
  return (
    <button
      type="button"
      className="app-tile"
      onClick={tile.onLaunch}
      aria-label={`Open ${tile.name}${tile.running ? ', running' : ''}`}
    >
      <AppIcon icon={tile.icon} accent={tile.accent} size="lg" />
      <span className="app-tile__name">{tile.name}</span>
      <span className="app-tile__status">
        <span className={`app-tile__dot ${tile.running ? 'is-running' : ''}`} aria-hidden="true" />
        {tile.running ? 'Running' : 'Stopped'}
      </span>
    </button>
  )
}

interface DashboardProps {
  navigate: (name: RouteName, options?: NavigateOptions) => void
  onLaunchApp?: (app: unknown) => void
  onOpenPalette: () => void
}

export function Dashboard({ navigate, onOpenPalette }: DashboardProps) {
  const {
    notifications,
    dismissNotification,
    markRead,
    files,
    users,
    roots,
    storage,
    services,
    system,
    addUploads,
    refresh,
    pushToast,
  } = useApp()
  const [target, setTarget] = useState('/')
  const [dragging, setDragging] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (roots.length && !roots.some((root) => root.path === target)) {
      setTarget(roots[0].path)
    }
  }, [roots, target])

  const runningServices = services.filter((service) => service.running)
  const notices = notifications.slice(0, 3)
  const recentFiles = [...files]
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
    .slice(0, 5)

  const userFor = (owner: string) =>
    users.find((user) => user.account === owner) ?? users.find((user) => user.email === owner)

  const tiles: Tile[] = [
    ...BUILTIN_APPS.map((app) => ({
      id: app.id,
      name: app.name,
      icon: app.icon,
      accent: app.accent,
      running: true,
      onLaunch: () => navigate(app.internalRoute, { path: app.internalPath }),
    })),
    ...runningServices.slice(0, 2).map((service) => ({
      id: service.id,
      name: service.name,
      icon: 'Activity',
      accent: '#38bdf8',
      running: service.running,
      onLaunch: () => navigate('apps'),
    })),
  ]

  const handleUploads = (list: FileList | null) => {
    if (!list || list.length === 0) return
    void addUploads(target, Array.from(list))
    if (uploadRef.current) uploadRef.current.value = ''
  }

  const runHealthCheck = async () => {
    await refresh()
    pushToast({
      title: 'State refreshed',
      description: `${storage.pools.length} volumes and ${services.length} units read from the host.`,
      tone: 'success',
    })
  }

  return (
    <div className="dashboard">
      <aside className="dash-left" aria-label="System widgets">
        <ClockCard />
        <SystemCard onDetails={() => navigate('settings', { tab: 'about' })} />
        <StorageCard onOpen={() => navigate('storage')} />
        <NetworkCard />
        <button
          type="button"
          className="widget-settings card"
          onClick={() => navigate('settings', { tab: 'appearance' })}
        >
          <span>
            <SlidersHorizontal size={16} aria-hidden="true" />
            Widget settings
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </aside>

      <section className="dash-main" aria-label="Workspace">
        <button type="button" className="dash-search card" onClick={onOpenPalette}>
          <span className="dash-search__icon" aria-hidden="true">
            <Search size={17} />
          </span>
          <span className="dash-search__placeholder">Search files, services, and commands…</span>
          <span className="dash-search__hint" aria-hidden="true">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </button>

        <div className="notices">
          {notices.map((notification) => {
            const Icon = NOTICE_ICONS[notification.tone]
            return (
              <article
                key={notification.id}
                className={`notice-card card notice-card--${notification.tone}`}
              >
                <div className="notice-card__top">
                  <span className="notice-card__icon" aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <button
                    type="button"
                    className="notice-card__dismiss"
                    aria-label={`Dismiss ${notification.title}`}
                    onClick={() => dismissNotification(notification.id)}
                  >
                    ×
                  </button>
                </div>
                <h3>{notification.title}</h3>
                <p>{notification.body}</p>
                <div className="notice-card__footer">
                  <time>{notification.time}</time>
                  {notification.action ? (
                    <button
                      type="button"
                      className="notice-card__action"
                      onClick={() => {
                        markRead(notification.id)
                        if (notification.action) {
                          navigate(notification.action.route, {
                            path: notification.action.path,
                            tab: notification.action.tab,
                          })
                        }
                      }}
                    >
                      {notification.action.label}
                      <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
          {notices.length === 0 ? (
            <article className="notice-card notice-card--empty card">
              <span className="notice-card__icon" aria-hidden="true">
                <CircleCheckBig size={17} />
              </span>
              <h3>Nothing needs attention</h3>
              <p>Volumes are below 90% and every Orion unit is running.</p>
              <div className="notice-card__footer">
                <span className="dim">Read from the host</span>
                <button type="button" className="notice-card__action" onClick={runHealthCheck}>
                  Refresh
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
            </article>
          ) : null}
        </div>

        <div className="apps-section">
          <header className="section-head">
            <div>
              <h2>Apps</h2>
              <span>
                {BUILTIN_APPS.length} pages · {runningServices.length} services running
              </span>
            </div>
            <div className="section-head__actions">
              <button type="button" className="text-button" onClick={() => navigate('apps')}>
                Manage
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Add apps"
                onClick={() => navigate('apps')}
              >
                <Plus size={17} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="apps-grid">
            {tiles.map((tile) => (
              <AppTile key={tile.id} tile={tile} />
            ))}
            <button
              type="button"
              className="app-tile app-tile--add"
              onClick={() => navigate('apps')}
            >
              <span className="app-tile__add-icon" aria-hidden="true">
                <Plus size={22} />
              </span>
              <span className="app-tile__name">Services</span>
              <span className="app-tile__status">{services.length} units</span>
            </button>
          </div>
        </div>

        <div className="dash-bottom">
          <section className="activity-card card" aria-labelledby="activity-title">
            <header className="section-head">
              <div>
                <h2 id="activity-title">Recent activity</h2>
                <span>Most recently modified on the volume</span>
              </div>
              <button type="button" className="text-button" onClick={() => navigate('files')}>
                Open Files
              </button>
            </header>
            <ul className="activity-list">
              {recentFiles.map((file) => {
                const Icon = FILE_ICONS[file.tone]
                const owner = userFor(file.owner)
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      className="activity-row"
                      onClick={() => navigate('files', { path: file.parent, highlight: file.id })}
                    >
                      <span className={`file-glyph file-glyph--${file.tone}`} aria-hidden="true">
                        <Icon size={15} />
                      </span>
                      <span className="activity-row__copy">
                        <strong>{file.name}</strong>
                        <span>
                          {file.parent === '/' ? 'Root' : file.parent} ·{' '}
                          {relativeTime(file.modifiedAt)}
                        </span>
                      </span>
                      <span className="activity-row__actor">{owner?.name ?? file.owner}</span>
                    </button>
                  </li>
                )
              })}
              {recentFiles.length === 0 ? (
                <li className="dim">The volume is empty. Upload something to see it here.</li>
              ) : null}
            </ul>
          </section>

          <section className="transfer-card card" aria-labelledby="transfer-title">
            <header className="section-head">
              <div>
                <h2 id="transfer-title">Quick transfer</h2>
                <span>Drop files straight onto the volume</span>
              </div>
              <Upload size={16} aria-hidden="true" className="dim" />
            </header>
            <div
              className={`transfer-drop ${dragging ? 'is-dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                handleUploads(event.dataTransfer.files)
              }}
            >
              <span className="transfer-drop__icon" aria-hidden="true">
                <Upload size={19} />
              </span>
              <strong>{dragging ? 'Release to upload' : 'Drag files here'}</strong>
              <span>or choose a folder below</span>
              <label className="transfer-drop__target">
                <span>Upload to</span>
                <select
                  className="select"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  aria-label="Upload destination"
                >
                  {roots.map((root) => (
                    <option key={root.path} value={root.path}>
                      {root.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button--sm button--primary"
                onClick={() => uploadRef.current?.click()}
              >
                Choose files
              </button>
              <input
                ref={uploadRef}
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => handleUploads(event.target.files)}
              />
            </div>
            <div className="transfer-foot">
              <HardDrive size={13} aria-hidden="true" />
              <span>Written to {storage.pools.find((pool) => pool.name === 'Files')?.mount ?? '/srv/storage'}</span>
              <span className="transfer-foot__limit">Max 2 GB / file</span>
            </div>
          </section>
        </div>

        <div className="dashboard-footer-note">
          <span>
            <span className="live-dot" aria-hidden="true" />
            {system?.identity ? `Signed in as ${system.identity.email}` : 'Signed in at the edge'}
          </span>
          <span className="dim">·</span>
          <span>{system?.hostname ?? '…'}</span>
          <span className="dim">·</span>
          <span>{formatBytes(storage.files.bytes)} in {storage.files.count} files</span>
        </div>
      </section>
    </div>
  )
}
