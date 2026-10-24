import type { CSSProperties, ReactNode } from 'react'
import {
  Check,
  Globe,
  HardDrive,
  Info,
  Monitor,
  Moon,
  Network,
  Palette,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Users,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { classNames, formatBytes } from '../lib/format'
import { Avatar } from '../components/ui/Avatar'
import { PageHeader } from '../components/ui/PageHeader'
import { Segmented } from '../components/ui/Segmented'
import { StatusBadge } from '../components/ui/StatusBadge'
import { Switch } from '../components/ui/Switch'
import type {
  Accent,
  Density,
  SettingsTab,
  ThemeMode,
  TimeFormat,
  Wallpaper,
} from '../types'

interface SettingsProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof SlidersHorizontal; hint: string }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, hint: 'Host & build' },
  { id: 'appearance', label: 'Appearance', icon: Palette, hint: 'Theme & wallpaper' },
  { id: 'network', label: 'Network', icon: Network, hint: 'Address & DNS' },
  { id: 'users', label: 'Users', icon: Users, hint: 'Accounts' },
  { id: 'security', label: 'Security', icon: ShieldCheck, hint: 'Access' },
  { id: 'about', label: 'About', icon: Info, hint: 'Version & support' },
]

const WALLPAPERS: Array<{ id: Wallpaper; label: string; hint: string }> = [
  { id: 'aurora', label: 'Aurora', hint: 'Cool blue light' },
  { id: 'nebula', label: 'Nebula', hint: 'Violet depth' },
  { id: 'dawn', label: 'Dawn', hint: 'Warm horizon' },
]

const ACCENTS: Array<{ id: Accent; label: string; color: string }> = [
  { id: 'blue', label: 'Cobalt', color: '#0a63ff' },
  { id: 'violet', label: 'Violet', color: '#7c5cff' },
  { id: 'emerald', label: 'Emerald', color: '#10b981' },
  { id: 'amber', label: 'Amber', color: '#f59e0b' },
]

function SectionCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <section className={classNames('settings-card card', className)}>
      <header className="settings-card__head">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="settings-card__body">{children}</div>
      {footer ? <footer className="settings-card__footer">{footer}</footer> : null}
    </section>
  )
}

function uptimeLabel(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} day${days === 1 ? '' : 's'}, ${hours} hours`
  if (hours > 0) return `${hours} hours, ${minutes} minutes`
  return `${minutes} minutes`
}

export function Settings({ activeTab, onTabChange }: SettingsProps) {
  const {
    settings,
    updateSettings,
    system,
    services,
    users,
    storage,
    refresh,
    resetPreferences,
    loading,
  } = useApp()
  const tab = activeTab
  const version = system?.version
  const network = system?.network
  const identity = system?.identity
  const running = services.filter((service) => service.running).length

  return (
    <section className="view settings-view">
      <PageHeader
        eyebrow="Control centre"
        title="Settings"
        description="Preferences live in this browser. Everything about the machine is read from the API, so there is nothing here to save that would not be true."
        actions={
          <span className="settings-health">
            <span className="live-dot" aria-hidden="true" />
            {system ? `${system.hostname} · ${system.runtime}` : 'Connecting…'}
          </span>
        }
      />

      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          {TABS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className={classNames('settings-tab', tab === item.id && 'is-active')}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => onTabChange(item.id)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>
                  {item.label}
                  <small>{item.hint}</small>
                </span>
              </button>
            )
          })}
          <div className="settings-tabs__meta">
            <span>{system?.hostname ?? 'Orion'}</span>
            <strong>v{version?.version ?? '—'}</strong>
            <small>{version?.build ? `build ${version.build}` : 'reading build…'}</small>
          </div>
        </nav>

        <div className="settings-content">
          {tab === 'general' ? (
            <div className="settings-stack">
              <div className="settings-split">
                <SectionCard
                  title="This machine"
                  description="Read from uname, /proc and systemd-detect-virt."
                  footer={
                    <button
                      type="button"
                      className="button"
                      onClick={() => void refresh()}
                      disabled={loading}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      {loading ? 'Reading…' : 'Re-read host'}
                    </button>
                  }
                >
                  <dl className="detail-list">
                    <div>
                      <dt>Hostname</dt>
                      <dd>{system?.hostname ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Runtime</dt>
                      <dd>{system?.runtime ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Kernel</dt>
                      <dd>{system?.kernel ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Architecture</dt>
                      <dd>{system?.arch ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Processor</dt>
                      <dd>
                        {system ? `${system.cpu.model} · ${system.cpu.cores} cores` : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Memory</dt>
                      <dd>
                        {system
                          ? `${formatBytes(system.memory.totalBytes)} total · ${formatBytes(
                              system.memory.usedBytes,
                            )} used`
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Uptime</dt>
                      <dd>{system ? uptimeLabel(system.uptimeSeconds) : '—'}</dd>
                    </div>
                  </dl>
                </SectionCard>

                <SectionCard title="Deployment" description="Where this desktop runs.">
                  <dl className="detail-list">
                    <div>
                      <dt>Storage root</dt>
                      <dd>
                        <code>{system?.storageRoot ?? '—'}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd>
                        {version?.version ?? '—'} · {version?.build ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Built</dt>
                      <dd>
                        {version?.builtAt
                          ? new Date(version.builtAt).toLocaleString()
                          : 'not recorded'}
                      </dd>
                    </div>
                    <div>
                      <dt>Units running</dt>
                      <dd>
                        {running} of {services.length}
                      </dd>
                    </div>
                    <div>
                      <dt>Sign-in</dt>
                      <dd>{identity?.email ?? 'edge gate (identity not forwarded)'}</dd>
                    </div>
                    <div>
                      <dt>Snapshot</dt>
                      <dd>
                        {system?.generatedAt
                          ? new Date(system.generatedAt).toLocaleTimeString()
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </SectionCard>
              </div>

            </div>
          ) : null}

          {tab === 'appearance' ? (
            <div className="settings-stack">
              <SectionCard
                title="Theme"
                description="Changes apply instantly across every screen and stay saved on this browser."
                footer={
                  <>
                    <span className="settings-dirty">Stored in this browser</span>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={resetPreferences}
                    >
                      Reset appearance
                    </button>
                  </>
                }
              >
                <div className="setting-row">
                  <div className="setting-row__copy">
                    <strong>Colour mode</strong>
                    <span>Match the room, the time of day, or the system.</span>
                  </div>
                  <Segmented<ThemeMode>
                    label="Colour mode"
                    value={settings.theme}
                    onChange={(theme) => updateSettings({ theme })}
                    options={[
                      { value: 'dark', label: 'Dark', icon: Moon },
                      { value: 'light', label: 'Light', icon: Sun },
                      { value: 'system', label: 'System', icon: Monitor },
                    ]}
                  />
                </div>
                <div className="setting-row setting-row--start">
                  <div className="setting-row__copy">
                    <strong>Accent</strong>
                    <span>Used for buttons, focus and live data.</span>
                  </div>
                  <div className="accent-swatches" role="radiogroup" aria-label="Accent colour">
                    {ACCENTS.map((accent) => (
                      <button
                        key={accent.id}
                        type="button"
                        role="radio"
                        aria-checked={settings.accent === accent.id}
                        aria-label={accent.label}
                        className={classNames(
                          'accent-swatch',
                          settings.accent === accent.id && 'is-selected',
                        )}
                        style={{ '--swatch': accent.color } as CSSProperties}
                        onClick={() => updateSettings({ accent: accent.id })}
                      >
                        {settings.accent === accent.id ? <Check size={13} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-row__copy">
                    <strong>Density</strong>
                    <span>Compact fits more files and services on screen.</span>
                  </div>
                  <Segmented<Density>
                    label="Interface density"
                    value={settings.density}
                    onChange={(density) => updateSettings({ density })}
                    options={[
                      { value: 'comfortable', label: 'Comfortable' },
                      { value: 'compact', label: 'Compact' },
                    ]}
                  />
                </div>
                <div className="setting-row">
                  <div className="setting-row__copy">
                    <strong>Time format</strong>
                    <span>Applies to the dashboard clock and every timestamp.</span>
                  </div>
                  <Segmented<TimeFormat>
                    label="Time format"
                    value={settings.timeFormat}
                    onChange={(timeFormat) => updateSettings({ timeFormat })}
                    options={[
                      { value: '12', label: '12-hour' },
                      { value: '24', label: '24-hour' },
                    ]}
                  />
                </div>
                <Switch
                  checked={settings.reduceMotion}
                  onChange={(reduceMotion) => updateSettings({ reduceMotion })}
                  label="Reduce motion"
                  description="Turns off wallpaper drift, tile lifts and view animations."
                />
              </SectionCard>

              <SectionCard
                title="Wallpaper"
                description="Drawn locally with CSS, so they stay crisp at any resolution."
              >
                <div className="wallpaper-options" role="radiogroup" aria-label="Wallpaper">
                  {WALLPAPERS.map((wallpaper) => (
                    <button
                      key={wallpaper.id}
                      type="button"
                      role="radio"
                      aria-checked={settings.wallpaper === wallpaper.id}
                      className={classNames(
                        'wallpaper-option',
                        `wallpaper-option--${wallpaper.id}`,
                        settings.wallpaper === wallpaper.id && 'is-selected',
                      )}
                      onClick={() => updateSettings({ wallpaper: wallpaper.id })}
                    >
                      <span className="wallpaper-option__preview" aria-hidden="true">
                        <span className="wallpaper-option__glow" />
                        <span className="wallpaper-option__card" />
                        <span className="wallpaper-option__card wallpaper-option__card--two" />
                      </span>
                      <span className="wallpaper-option__label">
                        <strong>{wallpaper.label}</strong>
                        <small>{wallpaper.hint}</small>
                        {settings.wallpaper === wallpaper.id ? (
                          <span className="wallpaper-option__check">
                            <Check size={11} aria-hidden="true" />
                          </span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </SectionCard>
            </div>
          ) : null}

          {tab === 'network' ? (
            <div className="settings-stack">
              <SectionCard
                title="Interface"
                description="Read from the default route, ip addr and resolvectl. This container does not reconfigure its own network."
              >
                <div className="connection-status">
                  <span className="connection-status__icon" aria-hidden="true">
                    <Globe size={20} />
                  </span>
                  <div>
                    <strong>
                      {network?.ip ? `${network.ip}/${network.prefix}` : 'No address'} ·{' '}
                      {network?.interface ?? '—'}
                    </strong>
                    <span>
                      {network?.method === 'static' ? 'Static' : 'DHCP or routed'} ·{' '}
                      {network?.linkMbps ? `${network.linkMbps} Mb/s link` : 'link speed unknown'}
                    </span>
                  </div>
                  <StatusBadge tone={network?.ip ? 'success' : 'warning'}>
                    {network?.ip ? 'Up' : 'Down'}
                  </StatusBadge>
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>Gateway</dt>
                    <dd>{network?.gateway || '—'}</dd>
                  </div>
                  <div>
                    <dt>MAC address</dt>
                    <dd>{network?.mac || '—'}</dd>
                  </div>
                  <div>
                    <dt>DNS</dt>
                    <dd>{network?.dns.length ? network.dns.join(', ') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Hostname</dt>
                    <dd>{system?.hostname ?? '—'}</dd>
                  </div>
                </dl>
              </SectionCard>

              <SectionCard
                title="Public access"
                description="How this site is reached from outside the container."
              >
                <dl className="detail-list">
                  <div>
                    <dt>Edge</dt>
                    <dd>
                      <code>nas.innotel.us</code> → nginx on this host
                    </dd>
                  </div>
                  <div>
                    <dt>TLS</dt>
                    <dd>terminated at the NPM edge, renewed by Cerulean</dd>
                  </div>
                  <div>
                    <dt>Sign-in</dt>
                    <dd>oauth2-proxy in front of Authentik</dd>
                  </div>
                  <div>
                    <dt>Direct access</dt>
                    <dd>vhost accepts only the proxy address and localhost</dd>
                  </div>
                </dl>
              </SectionCard>
            </div>
          ) : null}

          {tab === 'users' ? (
            <div className="settings-stack">
              <SectionCard
                title="Accounts"
                description="Unix accounts with a login shell, plus the identity the edge forwarded for this session. Accounts are managed with usermod, not from the browser."
                footer={
                  <>
                    <span className="settings-dirty">{users.length} accounts</span>
                    <button type="button" className="button" onClick={() => void refresh()}>
                      <RefreshCw size={14} aria-hidden="true" />
                      Re-read
                    </button>
                  </>
                }
              >
                <ul className="user-list">
                  {users.map((user) => (
                    <li key={user.id} className="user-row">
                      <Avatar name={user.name} color={user.color} size="md" />
                      <div className="user-row__copy">
                        <strong>
                          {user.name}
                          {user.isCurrent ? <span className="user-you">This session</span> : null}
                        </strong>
                        <span>{user.email}</span>
                        {user.home ? <span>{user.home}</span> : null}
                      </div>
                      <span className={`role-badge role-badge--${user.role.toLowerCase()}`}>
                        {user.role}
                      </span>
                      <span className="user-row__active">{user.lastActive}</span>
                    </li>
                  ))}
                </ul>
                {users.length === 0 ? <p className="dim">No login accounts were found.</p> : null}
              </SectionCard>

              <SectionCard title="How access actually works" description="No invite flow is shown because this host has none.">
                <p className="settings-note">
                  People sign in at the edge. The proxy forwards the address in{' '}
                  <code>X-Auth-Request-Email</code>, which is the row marked “This session”. Adding
                  someone means creating an Authentik account, not a local one here.
                </p>
              </SectionCard>
            </div>
          ) : null}

          {tab === 'security' ? (
            <div className="settings-stack">
              <SectionCard title="This session" description="Identity as the proxy passed it to the API.">
                <dl className="detail-list">
                  <div>
                    <dt>Email</dt>
                    <dd>{identity?.email ?? 'not forwarded'}</dd>
                  </div>
                  <div>
                    <dt>Groups</dt>
                    <dd>
                      {identity?.groups.length ? identity.groups.join(', ') : 'none reported'}
                    </dd>
                  </div>
                  <div>
                    <dt>Access path</dt>
                    <dd>nas.innotel.us → oauth2-proxy → Authentik → this host</dd>
                  </div>
                  <div>
                    <dt>Direct port 80</dt>
                    <dd>restricted to 192.168.1.71 and 127.0.0.1</dd>
                  </div>
                </dl>
              </SectionCard>

              <div className="settings-split">
                <SectionCard title="Serving units" description="What answers on this host right now.">
                  <dl className="detail-list">
                    {services
                      .filter((service) => ['nginx', 'orion-api'].includes(service.name))
                      .map((service) => (
                        <div key={service.id}>
                          <dt>{service.name}</dt>
                          <dd>
                            <StatusBadge tone={service.running ? 'success' : 'danger'}>
                              {service.active}
                            </StatusBadge>
                          </dd>
                        </div>
                      ))}
                    {services.filter((service) => ['nginx', 'orion-api'].includes(service.name))
                      .length === 0 ? (
                      <div>
                        <dt>Units</dt>
                        <dd>not reported</dd>
                      </div>
                    ) : null}
                  </dl>
                </SectionCard>

                <SectionCard title="Unavailable here" description="Stated plainly instead of toggled.">
                  <dl className="detail-list">
                    <div>
                      <dt>Firewall</dt>
                      <dd>not installed in this container</dd>
                    </div>
                    <div>
                      <dt>Two-factor</dt>
                      <dd>enforced by Authentik at the edge</dd>
                    </div>
                    <div>
                      <dt>SSH</dt>
                      <dd>no sshd; access is incus exec</dd>
                    </div>
                    <div>
                      <dt>Sessions</dt>
                      <dd>the proxy owns them, not the desktop</dd>
                    </div>
                  </dl>
                </SectionCard>
              </div>
            </div>
          ) : null}

          {tab === 'about' ? (
            <div className="settings-stack">
              <div className="about-hero card">
                <span className="about-hero__mark" aria-hidden="true">
                  <HardDrive size={26} />
                </span>
                <div className="about-hero__copy">
                  <p className="eyebrow">Orion OS</p>
                  <h2>Version {version?.version ?? '—'}</h2>
                  <p>
                    Build {version?.build ?? '—'} · {system?.runtime ?? '—'} ·{' '}
                    {system?.hostname ?? '—'}
                  </p>
                  <div className="about-hero__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => void refresh()}
                      disabled={loading}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      {loading ? 'Reading…' : 'Re-read build'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-split">
                <SectionCard title="System facts" description="Useful when requesting support.">
                  <dl className="detail-list">
                    <div>
                      <dt>Kernel</dt>
                      <dd>{system?.kernel ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Architecture</dt>
                      <dd>{system?.arch ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Runtime</dt>
                      <dd>{system?.runtime ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Storage</dt>
                      <dd>
                        <code>{system?.storageRoot ?? '—'}</code> ·{' '}
                        {formatBytes(storage.files.bytes)} in {storage.files.count} files
                      </dd>
                    </div>
                    <div>
                      <dt>Services</dt>
                      <dd>
                        {running} running · {services.length} known
                      </dd>
                    </div>
                    <div>
                      <dt>Build time</dt>
                      <dd>
                        {version?.builtAt
                          ? new Date(version.builtAt).toLocaleString()
                          : 'not recorded'}
                      </dd>
                    </div>
                  </dl>
                </SectionCard>

                <SectionCard title="Deploying a change" description="There is no update button because the image is built, not downloaded.">
                  <pre className="settings-code">
{`# on the build host
cd orion-work
npm ci && npm run build
tar -C dist -cf - . | incus exec i1move:nas -- \\
  tar -C /var/www/orion -xf -
systemctl reload nginx`}
                  </pre>
                  <p className="settings-note">
                    The landing page and API ship separately: <code>web/landing</code> and{' '}
                    <code>server/orion-api.py</code>.
                  </p>
                </SectionCard>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
