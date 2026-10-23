import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Camera,
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
import { APP_BY_ID, APP_CATALOG } from '../data/apps'
import { useApp } from '../context/AppContext'
import { useTelemetry, type Telemetry } from '../hooks/useTelemetry'
import { formatClock, formatDay, formatPercent, formatTb, greeting, relativeTime } from '../lib/format'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'
import type { AppDefinition, FileTone, NotificationTone } from '../types'
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

function ClockCard() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="clock-card card" aria-label="Date and time">
      <div className="clock-card__top">
        <span className="clock-card__greeting">{greeting(now)}, Alex</span>
        <StatusBadge tone="success">Online</StatusBadge>
      </div>
      <time className="clock-card__time tabular" dateTime={now.toISOString()}>
        {formatClock(now)}
      </time>
      <p className="clock-card__date">{formatDay(now)}</p>
      <div className="clock-card__meta">
        <span className="live-dot" aria-hidden="true" />
        Up 47 days · Orion 1.4
      </div>
    </section>
  )
}

function SystemCard({ onDetails, telemetry }: { onDetails: () => void; telemetry: Telemetry }) {
  const ramUsed = ((telemetry.ram / 100) * 16).toFixed(1)

  return (
    <section className="system-card card" aria-labelledby="system-title">
      <header className="widget-head">
        <h2 id="system-title">System</h2>
        <button type="button" className="widget-link" onClick={onDetails}>
          Details
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="system-card__gauges">
        <MetricRing
          value={telemetry.cpu}
          label="CPU"
          detail={`${telemetry.cpuClock} GHz · ${telemetry.temp}°C`}
          tone="accent"
        />
        <MetricRing
          value={telemetry.ram}
          label="RAM"
          detail={`${ramUsed} / 16 GB`}
          tone="success"
        />
      </div>
      <div className="system-card__spark">
        <Sparkline
          values={telemetry.cpuHistory}
          height={28}
          color="var(--accent)"
          showGrid={false}
          label="CPU utilisation trend"
        />
      </div>
    </section>
  )
}

function StorageCard({
  onOpen,
}: {
  onOpen: () => void
}) {
  const { storage } = useApp()
  const used = storage.pools.reduce((total, pool) => total + pool.usedTb, 0)
  const total = storage.pools.reduce((sum, pool) => sum + pool.totalTb, 0)
  const percent = formatPercent(used, total)

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
            <StatusBadge tone="success">Healthy</StatusBadge>
            <span className="storage-widget__percent tabular">{percent}%</span>
          </div>
          <p>
            <strong className="tabular">{used.toFixed(2)} TB</strong> of {formatTb(total, 0)} used
          </p>
        </div>
      </div>
      <ProgressBar value={percent} label="Storage used" />
      <button type="button" className="storage-widget__footer" onClick={onOpen}>
        {storage.pools.length} pools · {storage.disks.length} disks
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </section>
  )
}

function NetworkCard({ onDetails, telemetry }: { onDetails: () => void; telemetry: Telemetry }) {
  return (
    <section className="network-card card" aria-labelledby="network-title">
      <header className="widget-head">
        <h2 id="network-title">Network</h2>
        <button type="button" className="iface-chip" onClick={onDetails}>
          <span className="live-dot" aria-hidden="true" />
          eth0
          <ChevronRight size={12} aria-hidden="true" />
        </button>
      </header>
      <div className="network-card__chart">
        <Sparkline
          values={telemetry.netDownHistory}
          color="var(--info)"
          height={78}
          max={100}
          label="Download throughput"
        />
        <Sparkline
          values={telemetry.netUpHistory}
          color="var(--success)"
          height={78}
          max={100}
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
          <strong className="tabular">{telemetry.netDown.toFixed(1)}</strong> MB/s
        </span>
        <span>
          <span className="legend-icon legend-icon--up" aria-hidden="true">
            <ArrowUp size={11} />
          </span>
          <strong className="tabular">{telemetry.netUp.toFixed(1)}</strong> MB/s
        </span>
        <span className="network-card__link">10 GbE</span>
      </div>
    </section>
  )
}

function AppTile({ app, onLaunch }: { app: AppDefinition; onLaunch: () => void }) {
  const { installed } = useApp()
  const running = installed[app.id]?.running
  return (
    <button
      type="button"
      className="app-tile"
      onClick={onLaunch}
      aria-label={`Open ${app.name}${running ? ', running' : ''}`}
    >
      <AppIcon icon={app.icon} accent={app.accent} size="lg" />
      <span className="app-tile__name">{app.name}</span>
      <span className="app-tile__status">
        <span className={`app-tile__dot ${running ? 'is-running' : ''}`} aria-hidden="true" />
        {running ? 'Running' : 'Stopped'}
      </span>
    </button>
  )
}

interface DashboardProps {
  navigate: (name: RouteName, options?: NavigateOptions) => void
  onLaunchApp: (app: AppDefinition) => void
  onOpenPalette: () => void
}

export function Dashboard({ navigate, onLaunchApp, onOpenPalette }: DashboardProps) {
  const {
    installed,
    notifications,
    dismissNotification,
    markRead,
    files,
    users,
    addUploads,
    settings,
    storage,
    pushToast,
  } = useApp()
  const [target, setTarget] = useState('/Downloads')
  const [dragging, setDragging] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const monitorApp = APP_BY_ID.get('monitor')
  const telemetry = useTelemetry()

  const apps = APP_CATALOG.filter((app) => installed[app.id])
  const notices = notifications.slice(0, 3)
  const recentFiles = [...files]
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
    .slice(0, 5)

  const handleUploads = (list: FileList | null) => {
    if (!list || list.length === 0) return
    addUploads(
      target,
      Array.from(list).map((file) => ({ name: file.name, size: file.size })),
    )
    if (uploadRef.current) uploadRef.current.value = ''
  }

  const runHealthCheck = () => {
    pushToast({
      title: 'No issues found',
      description: 'Pools, disks and services all report healthy.',
      tone: 'success',
    })
  }

  return (
    <div className="dashboard">
      <aside className="dash-left" aria-label="System widgets">
        <ClockCard />
        <SystemCard
          onDetails={() => monitorApp && onLaunchApp(monitorApp)}
          telemetry={telemetry}
        />
        <StorageCard onOpen={() => navigate('storage')} />
        <NetworkCard
          onDetails={() => monitorApp && onLaunchApp(monitorApp)}
          telemetry={telemetry}
        />
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
          <span className="dash-search__placeholder">Search files, apps, and commands…</span>
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
              <h3>All caught up</h3>
              <p>No alerts need your attention. Orion keeps watching in the background.</p>
              <div className="notice-card__footer">
                <span className="dim">System healthy</span>
                <button type="button" className="notice-card__action" onClick={runHealthCheck}>
                  Run check
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
              <span>{apps.length} installed</span>
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
            {apps.map((app) => (
              <AppTile key={app.id} app={app} onLaunch={() => onLaunchApp(app)} />
            ))}
            <button
              type="button"
              className="app-tile app-tile--add"
              onClick={() => navigate('apps')}
            >
              <span className="app-tile__add-icon" aria-hidden="true">
                <Plus size={22} />
              </span>
              <span className="app-tile__name">Add apps</span>
              <span className="app-tile__status">One-click install</span>
            </button>
          </div>
        </div>

        <div className="dash-bottom">
          <section className="activity-card card" aria-labelledby="activity-title">
            <header className="section-head">
              <div>
                <h2 id="activity-title">Recent activity</h2>
                <span>Across all shares</span>
              </div>
              <button type="button" className="text-button" onClick={() => navigate('files')}>
                Open Files
              </button>
            </header>
            <ul className="activity-list">
              {recentFiles.map((file) => {
                const Icon = FILE_ICONS[file.tone]
                const owner = users.find((user) => user.id === file.owner)?.name.split(' ')[0]
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      className="activity-row"
                      onClick={() =>
                        navigate('files', { path: file.parent, highlight: file.id })
                      }
                    >
                      <span className={`file-glyph file-glyph--${file.tone}`} aria-hidden="true">
                        <Icon size={15} />
                      </span>
                      <span className="activity-row__copy">
                        <strong>{file.name}</strong>
                        <span>
                          {file.parent === '/' ? 'Home' : file.parent} · {relativeTime(file.modifiedAt)}
                        </span>
                      </span>
                      <span className="activity-row__actor">{owner ?? 'System'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="transfer-card card" aria-labelledby="transfer-title">
            <header className="section-head">
              <div>
                <h2 id="transfer-title">Quick transfer</h2>
                <span>Drop files straight into Orion</span>
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
                  <option value="/Downloads">Downloads</option>
                  <option value="/Photos/Camera Roll">Photos</option>
                  <option value="/Documents">Documents</option>
                  <option value="/Shared/Public">Shared / Public</option>
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
              <Camera size={13} aria-hidden="true" />
              <span>Media is indexed automatically</span>
              <span className="transfer-foot__limit">Max 2 GB / file</span>
            </div>
          </section>
        </div>

        <div className="dashboard-footer-note">
          <span>
            <span className={settings.security.remoteAccess ? 'live-dot' : 'dim-dot'} aria-hidden="true" />
            {settings.security.remoteAccess ? 'Remote access enabled' : 'Local network only'}
          </span>
          <span className="dim">·</span>
          <span>{settings.hostname}</span>
          <span className="dim">·</span>
          <span>
            {formatTb(
              storage.pools.reduce((sum, pool) => sum + pool.usedTb, 0),
              1,
            )}{' '}
            managed
          </span>
        </div>
      </section>
    </div>
  )
}
