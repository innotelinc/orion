import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Copy,
  Download,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { BUILTIN_APPS } from '../data/apps'
import { useApp } from '../context/AppContext'
import { classNames } from '../lib/format'
import { AppIcon } from '../components/ui/AppIcon'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusBadge } from '../components/ui/StatusBadge'
import type { AppEntry, ServiceAction, SystemService } from '../types'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'

interface AppStoreProps {
  navigate: (name: RouteName, options?: NavigateOptions) => void
}

const APP_ICONS: Record<string, string> = {
  smb: 'Server',
  nfs: 'HardDrive',
  discovery: 'Radio',
}

const CATALOGUE_ACCENT = '#0a63ff'

/** Units that make this box a NAS rather than a web page. */
const NAS_UNITS = ['nginx', 'orion-api', 'smbd', 'nfs-server']

export function AppStore({ navigate }: AppStoreProps) {
  const {
    services,
    serviceAction,
    apps,
    installApp,
    removeApp,
    refresh,
    pushToast,
  } = useApp()
  const [query, setQuery] = useState('')
  const [runningOnly, setRunningOnly] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState<SystemService | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<AppEntry | null>(null)

  const needle = query.trim().toLowerCase()
  const matches = (text: string) => (needle ? text.toLowerCase().includes(needle) : true)

  const installed = useMemo(
    () => apps.filter((app) => app.installed && matches(`${app.name} ${app.tagline}`)),
    [apps, needle],
  )
  // NFS is not waiting to be installed: the host exports it. Keeping it in the
  // Available list meant a card with no Install button under a heading that
  // promises apt packages.
  const hosted = useMemo(
    () => apps.filter((app) => app.external && matches(`${app.name} ${app.tagline}`)),
    [apps, needle],
  )
  const available = useMemo(
    () =>
      apps.filter(
        (app) => !app.installed && !app.external && matches(`${app.name} ${app.tagline}`),
      ),
    [apps, needle],
  )
  const units = useMemo(
    () =>
      services
        .filter((service) => (runningOnly ? service.running : true))
        .filter((service) => matches(`${service.name} ${service.description}`))
        .sort((a, b) => {
          if (a.running !== b.running) return a.running ? -1 : 1
          return a.name.localeCompare(b.name)
        }),
    [services, runningOnly, needle],
  )

  const running = services.filter((service) => service.running).length
  const stack = services.filter((service) => NAS_UNITS.includes(service.name))
  const smb = apps.find((app) => app.id === 'smb')

  const critical = (service: SystemService) =>
    service.name === 'nginx' || service.name === 'orion-api'

  const act = async (unit: string, action: ServiceAction, label: string) => {
    setBusy(unit)
    const result = await serviceAction(unit, action)
    setBusy(null)
    if (!result.ok) {
      pushToast({
        title: `${action} failed for ${label}`,
        description: result.error,
        tone: 'error',
      })
    }
  }

  const install = async (app: AppEntry) => {
    setBusy(app.id)
    const result = await installApp(app.id)
    setBusy(null)
    if (!result.ok) {
      pushToast({ title: `Could not install ${app.name}`, description: result.error, tone: 'error' })
    }
  }

  const remove = async (app: AppEntry) => {
    setBusy(app.id)
    const result = await removeApp(app.id)
    setBusy(null)
    setConfirmRemove(null)
    if (!result.ok) {
      pushToast({ title: `Could not remove ${app.name}`, description: result.error, tone: 'error' })
    }
  }

  // A mount command is only useful if it can be pasted, so the card copies it
  // whole rather than asking anyone to retype a dataset path.
  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      pushToast({
        title: 'Mount command copied',
        description: 'Paste it into a terminal on the client.',
        tone: 'success',
      })
    } catch {
      pushToast({ title: 'Clipboard unavailable', description: command, tone: 'error' })
    }
  }

  const appCard = (app: AppEntry) => (
    <article key={app.id} className="store-card card">
      <header className="store-card__head">
        <AppIcon
          icon={APP_ICONS[app.id] ?? 'Activity'}
          accent={app.installed ? CATALOGUE_ACCENT : '#64748b'}
          size="md"
        />
        <div className="store-card__title">
          <h3>{app.name}</h3>
          <span>{app.tagline}</span>
        </div>
        {app.available === false ? (
          // NFS is not down: it is exported by the host, which is where the
          // storage is. Calling that "unavailable" was the misleading part.
          app.external ? (
            <StatusBadge tone="success">on the host</StatusBadge>
          ) : (
            <StatusBadge tone="warning">unavailable</StatusBadge>
          )
        ) : app.installed ? (
          <StatusBadge tone={app.active ? 'success' : 'warning'}>{app.state}</StatusBadge>
        ) : (
          <span className="store-category">available</span>
        )}
      </header>
      <p className="store-card__description">{app.description}</p>
      {app.available === false && app.unavailable ? (
        <p className={app.external ? 'store-card__note' : 'store-card__unavailable'}>
          {app.unavailable}
        </p>
      ) : null}
      {app.command ? (
        <div className="store-card__command">
          <code>{app.command}</code>
          <button
            type="button"
            className="button button--sm button--ghost"
            onClick={() => void copyCommand(app.command as string)}
          >
            <Copy size={12} aria-hidden="true" />
            Copy
          </button>
        </div>
      ) : null}
      {app.packages.length || app.unit ? (
        <div className="store-card__meta">
          <code>{app.packages.join(' ') || '—'}</code> · <code>{app.unit || '—'}</code>
        </div>
      ) : app.hint ? (
        // An entry that cannot run here names no package and no unit, because
        // both would be a promise this container cannot keep.
        <div className="store-card__meta">
          <code>{app.hint}</code>
        </div>
      ) : null}
      <footer className="store-card__footer">
        <span className="store-category">{app.category}</span>
        <div className="store-card__actions">
          {app.installed ? (
            <>
              {app.id === 'smb' ? (
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => navigate('settings', { tab: 'users' })}
                >
                  Spaces
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className="button button--sm"
                disabled={busy !== null || app.available === false}
                title={app.available === false ? app.unavailable : undefined}
                onClick={() => void act(app.unit, 'restart', app.name)}
              >
                {busy === app.unit ? (
                  <Loader2 size={13} className="spin" aria-hidden="true" />
                ) : (
                  <RotateCcw size={13} aria-hidden="true" />
                )}
                Restart
              </button>
              <button
                type="button"
                className="button button--sm button--ghost"
                disabled={busy !== null}
                onClick={() => setConfirmRemove(app)}
              >
                <Trash2 size={13} aria-hidden="true" />
                Remove
              </button>
            </>
          ) : app.available === false ? (
            <span className="store-category" title={app.unavailable}>
              {app.external ? 'served by the host' : 'cannot run here'}
            </span>
          ) : (
            <button
              type="button"
              className="button button--sm button--primary"
              disabled={busy !== null}
              onClick={() => void install(app)}
            >
              {busy === app.id ? (
                <Loader2 size={13} className="spin" aria-hidden="true" />
              ) : (
                <Download size={13} aria-hidden="true" />
              )}
              Install
            </button>
          )}
        </div>
      </footer>
    </article>
  )

  return (
    <section className="view store-view">
      <PageHeader
        eyebrow="App Store"
        title="Apps"
        description="Each card is something this container really installs: dpkg decides whether it is present and systemd decides whether it answers. The NAS stack at the top is the desktop itself."
        actions={
          <>
            <span className="store-sync">
              <span className="live-dot" aria-hidden="true" />
              {running} of {services.length} units running
            </span>
            <button type="button" className="button" onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden="true" />
              Refresh
            </button>
          </>
        }
      />

      <section className="store-nas card">
        <header className="store-card__head">
          <AppIcon icon="House" accent="var(--accent-strong)" size="md" />
          <div className="store-card__title">
            <h3>NAS services</h3>
            <span>File sharing, the desktop and its API</span>
          </div>
          <StatusBadge tone={stack.every((service) => service.running) ? 'success' : 'warning'}>
            {stack.filter((service) => service.running).length} of {stack.length} up
          </StatusBadge>
        </header>
        <ul className="nas-stack">
          {stack.map((service) => (
            <li key={service.id}>
              <span
                className={classNames('live-dot', !service.running && 'live-dot--off')}
                aria-hidden="true"
              />
              <strong>{service.name}</strong>
              <span className="dim">{service.description || service.id}</span>
              <StatusBadge tone={service.running ? 'success' : 'danger'}>
                {service.active}
              </StatusBadge>
              <div className="store-card__actions">
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  disabled={busy !== null}
                  onClick={() => void act(service.id, 'restart', service.name)}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  Restart
                </button>
              </div>
            </li>
          ))}
          {smb && !smb.installed ? (
            <li>
              <span className="live-dot live-dot--off" aria-hidden="true" />
              <strong>SMB</strong>
              <span className="dim">Not installed — network shares for every space</span>
              <StatusBadge tone="warning">off</StatusBadge>
              <div className="store-card__actions">
                <button
                  type="button"
                  className="button button--sm button--primary"
                  disabled={busy !== null}
                  onClick={() => void install(smb)}
                >
                  {busy === smb.id ? (
                    <Loader2 size={12} className="spin" aria-hidden="true" />
                  ) : (
                    <Download size={12} aria-hidden="true" />
                  )}
                  Install
                </button>
              </div>
            </li>
          ) : null}
        </ul>
      </section>

      <div className="store-controls">
        <label className="store-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps and units"
            aria-label="Search apps and units"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </label>
      </div>

      <div className="store-results-head">
        <div>
          <h2>Installed</h2>
          <span>
            {installed.length} {installed.length === 1 ? 'app' : 'apps'} on this host
          </span>
        </div>
      </div>

      {installed.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Download}
            title={needle ? 'Nothing installed matches' : 'No apps installed yet'}
            description={
              needle
                ? `No installed app matches “${query}”.`
                : 'SMB sharing is the one that turns the spaces into network shares.'
            }
            action={
              needle ? (
                <button type="button" className="button" onClick={() => setQuery('')}>
                  Clear search
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="store-grid">{installed.map(appCard)}</div>
      )}

      {hosted.length ? (
        <>
          <div className="store-results-head">
            <div>
              <h2>On the host</h2>
              <span>Exported by the machine that owns the storage, not by this container</span>
            </div>
          </div>
          <div className="store-grid">{hosted.map(appCard)}</div>
        </>
      ) : null}

      <div className="store-results-head">
        <div>
          <h2>Available</h2>
          <span>Packages this container can install with apt</span>
        </div>
      </div>

      {available.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Download}
            title="Everything is installed"
            description="The catalogue is fully installed on this host."
          />
        </div>
      ) : (
        <div className="store-grid">{available.map(appCard)}</div>
      )}

      <div className="store-results-head">
        <div>
          <h2>Pages</h2>
          <span>The desktop’s own views</span>
        </div>
      </div>

      <div className="store-grid">
        {BUILTIN_APPS.map((app) => (
          <article key={app.id} className="store-card card">
            <header className="store-card__head">
              <AppIcon icon={app.icon} accent={app.accent} size="md" />
              <div className="store-card__title">
                <h3>{app.name}</h3>
                <span>{app.tagline}</span>
              </div>
            </header>
            <p className="store-card__tagline">{app.description}</p>
            <footer className="store-card__footer">
              <span className="store-category">Built in</span>
              <div className="store-card__actions">
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => navigate(app.internalRoute, { path: app.internalPath })}
                >
                  Open
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
            </footer>
          </article>
        ))}
      </div>

      <div className="store-results-head">
        <div>
          <h2>System units</h2>
          <span>
            {units.length} {units.length === 1 ? 'unit' : 'units'}
            {query ? ` matching “${query}”` : ''}
          </span>
        </div>
        <div className="store-categories" role="group" aria-label="Filter units">
          <button
            type="button"
            className={classNames('store-chip', !runningOnly && 'is-selected')}
            aria-pressed={!runningOnly}
            onClick={() => setRunningOnly(false)}
          >
            All
            <span>{services.length}</span>
          </button>
          <button
            type="button"
            className={classNames('store-chip', runningOnly && 'is-selected')}
            aria-pressed={runningOnly}
            onClick={() => setRunningOnly(true)}
          >
            Running
            <span>{running}</span>
          </button>
        </div>
      </div>

      {units.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Search}
            title="No units match"
            description={`Nothing matches “${query}”. Clear the search to see every unit.`}
            action={
              <button type="button" className="button" onClick={() => setQuery('')}>
                Clear search
              </button>
            }
          />
        </div>
      ) : (
        <div className="store-grid">
          {units.map((service) => (
            <article key={service.id} className="store-card card">
              <header className="store-card__head">
                <AppIcon
                  icon="Activity"
                  accent={service.running ? '#10b981' : '#64748b'}
                  size="md"
                />
                <div className="store-card__title">
                  <h3>{service.name}</h3>
                  <span>{service.id}</span>
                </div>
                <StatusBadge tone={service.running ? 'success' : 'warning'}>
                  {service.active}
                </StatusBadge>
              </header>
              <p className="store-card__description">
                {service.description || 'No description in the unit file.'}
              </p>
              <div className="store-card__meta">
                <span>{service.sub}</span>
              </div>
              <footer className="store-card__footer">
                <span className="store-category">{service.running ? 'running' : 'stopped'}</span>
                <div className="store-card__actions">
                  <button
                    type="button"
                    className="button button--sm"
                    disabled={busy !== null}
                    onClick={() => void act(service.id, 'restart', service.name)}
                  >
                    {busy === service.id ? (
                      <Loader2 size={13} className="spin" aria-hidden="true" />
                    ) : (
                      <RotateCcw size={13} aria-hidden="true" />
                    )}
                    Restart
                  </button>
                  {service.running ? (
                    <button
                      type="button"
                      className="button button--sm button--ghost"
                      disabled={busy !== null || critical(service)}
                      title={
                        critical(service)
                          ? 'Serving this page — stop it over incus instead'
                          : undefined
                      }
                      onClick={() => setConfirmStop(service)}
                    >
                      <Square size={12} aria-hidden="true" />
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button button--sm button--primary"
                      disabled={busy !== null}
                      onClick={() => void act(service.id, 'start', service.name)}
                    >
                      <Play size={12} aria-hidden="true" />
                      Start
                    </button>
                  )}
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}

      <div className="store-footnote">
        <AppIcon icon="Activity" accent="var(--accent-strong)" size="sm" />
        <span>
          Installs run apt inside this container only. The edge proxy, TLS and sign-in live on the
          host and are not visible from here.
        </span>
      </div>

      <Modal
        open={Boolean(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
        title={`Remove ${confirmRemove?.name ?? 'app'}?`}
        description="The package is purged. Data on the storage volume is left alone."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setConfirmRemove(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={busy !== null}
              onClick={() => {
                if (confirmRemove) void remove(confirmRemove)
              }}
            >
              <Trash2 size={13} aria-hidden="true" />
              Remove app
            </button>
          </>
        }
      >
        <div className="danger-note">
          <Trash2 size={16} aria-hidden="true" />
          <span>
            {confirmRemove?.packages.join(' ')} will be purged
            {confirmRemove?.id === 'smb'
              ? ', and the Samba accounts created for spaces go with it. Folders and files stay.'
              : '.'}
          </span>
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmStop)}
        onClose={() => setConfirmStop(null)}
        title={`Stop ${confirmStop?.name ?? 'unit'}?`}
        description="Anything depending on this unit stops answering until it is started again."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setConfirmStop(null)}>
              Keep running
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                if (!confirmStop) return
                void act(confirmStop.id, 'stop', confirmStop.name)
                setConfirmStop(null)
              }}
            >
              <Square size={13} aria-hidden="true" />
              Stop unit
            </button>
          </>
        }
      >
        <div className="danger-note">
          <Square size={16} aria-hidden="true" />
          <span>
            {confirmStop?.id} is currently {confirmStop?.active}. Recovery is{' '}
            <code>systemctl start {confirmStop?.id}</code> over incus or the Start button here.
          </span>
        </div>
      </Modal>
    </section>
  )
}
