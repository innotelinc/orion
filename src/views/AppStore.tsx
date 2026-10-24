import { useMemo, useState } from 'react'
import { ArrowRight, Loader2, Play, RefreshCw, RotateCcw, Search, Square, X } from 'lucide-react'
import { BUILTIN_APPS } from '../data/apps'
import { useApp } from '../context/AppContext'
import { classNames } from '../lib/format'
import { AppIcon } from '../components/ui/AppIcon'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusBadge } from '../components/ui/StatusBadge'
import type { ServiceAction, SystemService } from '../types'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'

interface AppStoreProps {
  navigate: (name: RouteName, options?: NavigateOptions) => void
}

export function AppStore({ navigate }: AppStoreProps) {
  const { services, serviceAction, refresh, system, pushToast } = useApp()
  const [query, setQuery] = useState('')
  const [runningOnly, setRunningOnly] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState<SystemService | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return services
      .filter((service) => (runningOnly ? service.running : true))
      .filter((service) =>
        needle
          ? `${service.name} ${service.description}`.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => {
        if (a.running !== b.running) return a.running ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [query, runningOnly, services])

  const running = services.filter((service) => service.running).length

  const critical = (service: SystemService) =>
    service.name === 'nginx' || service.name === 'orion-api'

  const act = async (service: SystemService, action: ServiceAction) => {
    setBusy(service.id)
    const result = await serviceAction(service.id, action)
    setBusy(null)
    if (!result.ok) {
      pushToast({
        title: `${action} failed for ${service.name}`,
        description: result.error,
        tone: 'error',
      })
    }
  }

  return (
    <section className="view store-view">
      <PageHeader
        eyebrow="systemd"
        title="Services"
        description="Every unit this container runs, read live. Restarting nginx or the API takes the desktop down for a moment — that is the real behaviour, not a simulation."
        actions={
          <>
            <span className="store-sync">
              <span className="live-dot" aria-hidden="true" />
              {running} of {services.length} running
            </span>
            <button type="button" className="button" onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden="true" />
              Refresh
            </button>
          </>
        }
      />

      <div className="store-controls">
        <div className="store-categories" role="group" aria-label="View">
          <button
            type="button"
            className={classNames('store-chip', !runningOnly && 'is-selected')}
            aria-pressed={!runningOnly}
            onClick={() => setRunningOnly(false)}
          >
            All units
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
        <div className="store-controls__right">
          <label className="store-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search units"
              aria-label="Search services"
            />
            {query ? (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={12} aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>
      </div>

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
          <h2>Units</h2>
          <span>
            {filtered.length} {filtered.length === 1 ? 'unit' : 'units'}
            {query ? ` matching “${query}”` : ''}
          </span>
        </div>
        <span className="dim store-results-head__hint">
          systemd on {system?.runtime ?? 'this host'}
        </span>
      </div>

      {filtered.length === 0 ? (
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
          {filtered.map((service) => (
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
                    onClick={() => void act(service, 'restart')}
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
                      onClick={() => void act(service, 'start')}
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
          Units are container-local. The edge proxy and TLS live on the host and are not visible
          from here.
        </span>
      </div>

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
                void act(confirmStop, 'stop')
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
