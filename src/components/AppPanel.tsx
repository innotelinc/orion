import { ExternalLink, Play, Power, Square, Star } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AppIcon } from './ui/AppIcon'
import { Modal } from './ui/Modal'
import { StatusBadge } from './ui/StatusBadge'
import { formatFullDateTime, formatPercent } from '../lib/format'
import type { AppDefinition } from '../types'

interface AppPanelProps {
  app: AppDefinition | null
  onClose: () => void
}

function hash(value: string) {
  return value.split('').reduce((total, char) => total + char.charCodeAt(0), 0)
}

export function AppPanel({ app, onClose }: AppPanelProps) {
  const { installed, toggleAppRunning, uninstallApp, pushToast } = useApp()
  if (!app) return null

  const installedApp = installed[app.id]
  const seed = hash(app.id)
  const cpu = installedApp?.running ? 1.4 + (seed % 34) / 10 : 0
  const memory = installedApp?.running ? 180 + (seed % 620) : 0
  const memoryPercent = formatPercent(memory, 2048)

  return (
    <Modal
      open={Boolean(app)}
      onClose={onClose}
      title={app.name}
      description={`${app.developer} · ${app.category}`}
      size="md"
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
          {installedApp ? (
            <>
              <button
                type="button"
                className="button"
                onClick={() => toggleAppRunning(app.id)}
              >
                {installedApp.running ? (
                  <>
                    <Square size={14} aria-hidden="true" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play size={14} aria-hidden="true" />
                    Start
                  </>
                )}
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() =>
                  pushToast({
                    title: `Opening ${app.name}`,
                    description: 'The app web UI would open in a new tab (front-end demo).',
                    tone: 'info',
                  })
                }
              >
                <ExternalLink size={15} aria-hidden="true" />
                Open web UI
              </button>
            </>
          ) : (
            <button type="button" className="button button--primary" onClick={onClose}>
              Back to App Store
            </button>
          )}
        </>
      }
    >
      <div className="app-panel__hero">
        <AppIcon icon={app.icon} accent={app.accent} size="xl" />
        <div className="app-panel__intro">
          <p className="eyebrow">{app.tagline}</p>
          <p>{app.description}</p>
          <div className="app-panel__rating">
            <Star size={14} aria-hidden="true" />
            <strong>{app.rating.toFixed(1)}</strong>
            <span>· {app.downloads} installs</span>
          </div>
        </div>
      </div>

      <div className="app-panel__status">
        <div>
          <span className="meta-label">Status</span>
          {installedApp ? (
            <StatusBadge tone={installedApp.running ? 'success' : 'neutral'}>
              {installedApp.running ? 'Running' : 'Stopped'}
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Not installed</StatusBadge>
          )}
        </div>
        <div>
          <span className="meta-label">CPU</span>
          <strong>{cpu.toFixed(1)}%</strong>
        </div>
        <div>
          <span className="meta-label">Memory</span>
          <strong>{memory} MB</strong>
          <div className="mini-bar" aria-hidden="true">
            <span style={{ width: `${memoryPercent}%` }} />
          </div>
        </div>
        <div>
          <span className="meta-label">Uptime</span>
          <strong>{installedApp?.running ? '6d 04h' : '—'}</strong>
        </div>
      </div>

      <dl className="app-panel__details">
        <div>
          <dt>Version</dt>
          <dd>{app.version}</dd>
        </div>
        <div>
          <dt>Image size</dt>
          <dd>{app.size}</dd>
        </div>
        <div>
          <dt>Installed</dt>
          <dd>
            {installedApp ? formatFullDateTime(installedApp.installedAt) : 'Not installed'}
          </dd>
        </div>
        <div>
          <dt>Container</dt>
          <dd>orion-{app.id}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>bridge · port {8000 + (seed % 900)}</dd>
        </div>
        <div>
          <dt>Auto-update</dt>
          <dd>Enabled</dd>
        </div>
      </dl>

      <div className="app-panel__note">
        <Power size={16} aria-hidden="true" />
        <span>
          Orion keeps the container patched and backed up. Data persists in
          <code> /AppData/{app.id}</code>.
        </span>
        {installedApp ? (
          <button
            type="button"
            className="text-button text-button--danger"
            onClick={() => {
              uninstallApp(app.id)
              onClose()
            }}
          >
            Uninstall
          </button>
        ) : null}
      </div>
    </Modal>
  )
}
