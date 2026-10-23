import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowRight,
  Check,
  Package,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { APP_CATALOG, categoryCount } from '../data/apps'
import { useApp } from '../context/AppContext'
import { classNames } from '../lib/format'
import { AppIcon } from '../components/ui/AppIcon'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { ProgressBar } from '../components/ui/ProgressBar'
import { StatusBadge } from '../components/ui/StatusBadge'
import type { AppCategory, AppDefinition } from '../types'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'

interface AppStoreProps {
  navigate: (name: RouteName, options?: NavigateOptions) => void
  onLaunchApp: (app: AppDefinition) => void
}

export function AppStore({ navigate, onLaunchApp }: AppStoreProps) {
  const { installed, installApp, uninstallApp, pushToast } = useApp()
  const [category, setCategory] = useState<'All' | AppCategory>('All')
  const [query, setQuery] = useState('')
  const [installedOnly, setInstalledOnly] = useState(false)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [uninstallTarget, setUninstallTarget] = useState<AppDefinition | null>(null)
  const timers = useRef<Record<string, number>>({})
  const featured = APP_CATALOG.find((app) => app.featured) ?? APP_CATALOG[0]

  useEffect(() => {
    const activeTimers = timers.current
    return () => {
      Object.values(activeTimers).forEach((timer) => window.clearInterval(timer))
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return APP_CATALOG.filter((app) => {
      if (category !== 'All' && app.category !== category) return false
      if (installedOnly && !installed[app.id]) return false
      if (!needle) return true
      return `${app.name} ${app.tagline} ${app.developer} ${app.category}`
        .toLowerCase()
        .includes(needle)
    })
  }, [category, installed, installedOnly, query])

  const installedCount = Object.keys(installed).length

  const startInstall = (app: AppDefinition) => {
    if (installed[app.id] || progress[app.id] !== undefined) return
    const started = Date.now()
    setProgress((previous) => ({ ...previous, [app.id]: 2 }))
    const timer = window.setInterval(() => {
      const value = Math.min(100, Math.round(((Date.now() - started) / 1500) * 100))
      setProgress((previous) => ({ ...previous, [app.id]: value }))
      if (value >= 100) {
        window.clearInterval(timer)
        delete timers.current[app.id]
        setProgress((previous) => {
          const next = { ...previous }
          delete next[app.id]
          return next
        })
        installApp(app)
      }
    }, 90)
    timers.current[app.id] = timer
  }

  const refresh = () => {
    pushToast({
      title: 'Catalog is up to date',
      description: `${APP_CATALOG.length} apps · synced just now.`,
      tone: 'success',
    })
  }

  const renderInstallControl = (app: AppDefinition, featuredCard = false) => {
    const isInstalled = Boolean(installed[app.id])
    const installing = progress[app.id] !== undefined
    if (installing) {
      return (
        <span className={classNames('store-installing', featuredCard && 'store-installing--featured')}>
          <span className="store-installing__label">
            Installing…
            <strong>{progress[app.id]}%</strong>
          </span>
          <ProgressBar
            value={progress[app.id]}
            label={`Installing ${app.name}`}
            tone="accent"
          />
        </span>
      )
    }
    if (isInstalled) {
      return (
        <button
          type="button"
          className={classNames('button', featuredCard && 'button--primary')}
          onClick={() => onLaunchApp(app)}
        >
          Open
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      )
    }
    return (
      <button
        type="button"
        className={classNames('button button--primary', featuredCard && 'button--lg')}
        onClick={() => startInstall(app)}
      >
        <Plus size={15} aria-hidden="true" />
        Install
      </button>
    )
  }

  return (
    <section className="view store-view">
      <PageHeader
        eyebrow="Plug & play"
        title="App Store"
        description="Install a complete self-hosted service in one click. Orion wires up the container, network, storage and updates automatically."
        actions={
          <>
            <span className="store-sync">
              <span className="live-dot" aria-hidden="true" />
              Catalog synced
            </span>
            <button type="button" className="button" onClick={refresh}>
              <RefreshCw size={14} aria-hidden="true" />
              Refresh
            </button>
          </>
        }
      />

      <section
        className="featured-card"
        style={{ '--feature-accent': featured.accent } as CSSProperties}
      >
        <div className="featured-card__glow" aria-hidden="true" />
        <div className="featured-card__copy">
          <span className="featured-card__label">
            <Star size={11} fill="currentColor" aria-hidden="true" />
            Featured this week
          </span>
          <h2>{featured.name}</h2>
          <p>{featured.description}</p>
          <div className="featured-card__meta">
            <span>{featured.category}</span>
            <span>·</span>
            <span>{featured.size}</span>
            <span>·</span>
            <span>
              <Star size={11} fill="currentColor" aria-hidden="true" /> {featured.rating.toFixed(1)}
            </span>
            {installed[featured.id] ? (
              <StatusBadge tone="success">Installed</StatusBadge>
            ) : null}
          </div>
          <div className="featured-card__actions">
            {renderInstallControl(featured, true)}
            <button
              type="button"
              className="button button--ghost featured-card__learn"
              onClick={() =>
                pushToast({
                  title: `${featured.name} by ${featured.developer}`,
                  description: `${featured.tagline} · ${featured.downloads} installs.`,
                  tone: 'info',
                })
              }
            >
              Learn more
            </button>
          </div>
        </div>
        <div className="featured-card__art" aria-hidden="true">
          <span className="featured-card__ring featured-card__ring--one" />
          <span className="featured-card__ring featured-card__ring--two" />
          <AppIcon icon={featured.icon} accent={featured.accent} size="xl" />
        </div>
      </section>

      <div className="store-controls">
        <div className="store-categories" role="tablist" aria-label="App categories">
          {(['All', 'Media', 'Productivity', 'Monitoring', 'Security', 'Utilities', 'System'] as const).map(
            (item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={category === item}
                className={classNames('store-chip', category === item && 'is-selected')}
                onClick={() => {
                  setCategory(item)
                  setInstalledOnly(false)
                }}
              >
                {item}
                <span>{categoryCount(item)}</span>
              </button>
            ),
          )}
        </div>

        <div className="store-controls__right">
          <button
            type="button"
            className={classNames('store-installed-filter', installedOnly && 'is-selected')}
            aria-pressed={installedOnly}
            onClick={() => setInstalledOnly((value) => !value)}
          >
            <Check size={12} aria-hidden="true" />
            Installed
            <span>{installedCount}</span>
          </button>
          <label className="store-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the catalog"
              aria-label="Search app catalog"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={12} aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>
      </div>

      <div className="store-results-head">
        <div>
          <h2>{installedOnly ? 'Installed apps' : category === 'All' ? 'All apps' : category}</h2>
          <span>
            {filtered.length} {filtered.length === 1 ? 'app' : 'apps'}
            {query ? ` matching “${query}”` : ''}
          </span>
        </div>
        <span className="dim store-results-head__hint">One-click installs include updates & backups</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Package}
            title="No apps found"
            description={
              installedOnly
                ? 'Install something from the catalog and it will appear here.'
                : `Nothing matches “${query}”. Try a different name or category.`
            }
            action={
              <button
                type="button"
                className="button"
                onClick={() => {
                  setQuery('')
                  setCategory('All')
                  setInstalledOnly(false)
                }}
              >
                Reset filters
              </button>
            }
          />
        </div>
      ) : (
        <div className="store-grid">
          {filtered.map((app) => {
            const isInstalled = Boolean(installed[app.id])
            const installing = progress[app.id] !== undefined
            return (
              <article key={app.id} className="store-card card">
                <header className="store-card__head">
                  <AppIcon icon={app.icon} accent={app.accent} size="md" />
                  <div className="store-card__title">
                    <h3>{app.name}</h3>
                    <span>{app.developer}</span>
                  </div>
                  {isInstalled ? (
                    <span className="store-card__installed" title="Installed">
                      <Check size={12} aria-hidden="true" />
                    </span>
                  ) : null}
                </header>
                <p className="store-card__tagline">{app.tagline}</p>
                <p className="store-card__description">{app.description}</p>
                <div className="store-card__meta">
                  <span>
                    <Star size={11} fill="currentColor" aria-hidden="true" />
                    {app.rating.toFixed(1)}
                  </span>
                  <span>{app.downloads}</span>
                  <span>{app.size}</span>
                </div>
                {installing ? (
                  <div className="store-card__progress">
                    <span>
                      Installing {app.name}
                      <strong>{progress[app.id]}%</strong>
                    </span>
                    <ProgressBar value={progress[app.id]} label={`Installing ${app.name}`} />
                  </div>
                ) : null}
                <footer className="store-card__footer">
                  <span className={`store-category store-category--${app.category.toLowerCase()}`}>
                    {app.category}
                  </span>
                  <div className="store-card__actions">
                    {isInstalled ? (
                      <button
                        type="button"
                        className="icon-button icon-button--sm store-card__uninstall"
                        aria-label={`Uninstall ${app.name}`}
                        title={`Uninstall ${app.name}`}
                        onClick={() => setUninstallTarget(app)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                    {renderInstallControl(app)}
                  </div>
                </footer>
              </article>
            )
          })}
        </div>
      )}

      <div className="store-footnote">
        <AppIcon icon="Sparkles" accent="var(--accent-strong)" size="sm" />
        <span>
          Every install is isolated, auto-updated and backed up. Need something custom? Drop a
          Compose file into <code>/AppData/Compose</code> and Orion will pick it up.
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => navigate('files', { path: '/Projects' })}
        >
          Browse app data
        </button>
      </div>

      <Modal
        open={Boolean(uninstallTarget)}
        onClose={() => setUninstallTarget(null)}
        title={`Uninstall ${uninstallTarget?.name ?? 'app'}?`}
        description="The container is removed but its data volume stays safe."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setUninstallTarget(null)}>
              Keep app
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                if (!uninstallTarget) return
                uninstallApp(uninstallTarget.id)
                setUninstallTarget(null)
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Uninstall
            </button>
          </>
        }
      >
        <div className="danger-note">
          <Trash2 size={17} aria-hidden="true" />
          <span>
            {uninstallTarget?.name} will stop immediately. Your data stays in{' '}
            <code>/AppData/{uninstallTarget?.id}</code> and can be restored by reinstalling.
          </span>
        </div>
      </Modal>
    </section>
  )
}
