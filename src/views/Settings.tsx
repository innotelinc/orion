import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  ArrowUpRight,
  BellRing,
  Check,
  CircleCheckBig,
  Download,
  Globe,
  Info,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Network,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Trash2,
  UserPlus,
  Users,
  Wifi,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { classNames } from '../lib/format'
import { Avatar } from '../components/ui/Avatar'
import { Modal } from '../components/ui/Modal'
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
  UserAccount,
  Wallpaper,
} from '../types'

interface SettingsProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof SlidersHorizontal; hint: string }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, hint: 'Device & updates' },
  { id: 'appearance', label: 'Appearance', icon: Palette, hint: 'Theme & wallpaper' },
  { id: 'network', label: 'Network', icon: Network, hint: 'Address & DNS' },
  { id: 'users', label: 'Users', icon: Users, hint: 'Accounts & roles' },
  { id: 'security', label: 'Security', icon: ShieldCheck, hint: 'Access & sessions' },
  { id: 'about', label: 'About', icon: Info, hint: 'Version & support' },
]

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
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

function isIPv4(value: string) {
  const parts = value.trim().split('.')
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  )
}

function validHostname(value: string) {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{1,30})[a-zA-Z0-9]$/.test(value.trim())
}

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

export function Settings({ activeTab, onTabChange }: SettingsProps) {
  const {
    settings,
    updateSettings,
    users,
    addUser,
    removeUser,
    pushToast,
    resetDemo,
    storage,
    installed,
  } = useApp()

  const [general, setGeneral] = useState({
    hostname: settings.hostname,
    language: settings.language,
    timezone: settings.timezone,
    updateChannel: settings.updateChannel,
    autoUpdate: settings.autoUpdate,
  })
  const [generalError, setGeneralError] = useState('')

  const [network, setNetwork] = useState(settings.network)
  const [networkError, setNetworkError] = useState('')

  const [addUserOpen, setAddUserOpen] = useState(false)
  const [userForm, setUserForm] = useState({ name: '', email: '', role: 'Member' as UserAccount['role'] })
  const [userError, setUserError] = useState('')
  const [removeTarget, setRemoveTarget] = useState<UserAccount | null>(null)

  const [sessions, setSessions] = useState([
    {
      id: 's-current',
      device: 'This browser',
      detail: 'Windows · Chrome 155 · 192.168.1.42',
      icon: Monitor,
      current: true,
    },
    {
      id: 's-mac',
      device: 'MacBook Pro',
      detail: 'Sonoma · Safari 19 · 10.0.0.24',
      icon: Laptop,
      current: false,
    },
    {
      id: 's-phone',
      device: 'iPhone 17 Pro',
      detail: 'Orion app · 2 hours ago',
      icon: Smartphone,
      current: false,
    },
  ])

  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const generalDirty =
    general.hostname !== settings.hostname ||
    general.language !== settings.language ||
    general.timezone !== settings.timezone ||
    general.updateChannel !== settings.updateChannel ||
    general.autoUpdate !== settings.autoUpdate

  const networkDirty =
    network.method !== settings.network.method ||
    network.ip !== settings.network.ip ||
    network.gateway !== settings.network.gateway ||
    network.dns !== settings.network.dns

  const securityScore = useMemo(() => {
    let score = 35
    if (settings.security.twoFactor) score += 25
    if (settings.security.firewall) score += 20
    if (settings.security.autoLock !== 'never') score += 10
    if (!settings.security.remoteAccess) score += 5
    return Math.min(100, score + 5)
  }, [settings.security])

  const saveGeneral = (event?: FormEvent) => {
    event?.preventDefault()
    if (!validHostname(general.hostname)) {
      setGeneralError('Use 3–32 letters, numbers or hyphens, starting and ending with a letter or number.')
      return
    }
    setGeneralError('')
    updateSettings({ ...general })
    pushToast({
      title: 'Device settings saved',
      description: `${general.hostname}.local · ${general.timezone}`,
      tone: 'success',
    })
  }

  const saveNetwork = (event?: FormEvent) => {
    event?.preventDefault()
    if (network.method === 'static') {
      if (!isIPv4(network.ip)) {
        setNetworkError('Enter a valid IPv4 address, for example 192.168.1.42.')
        return
      }
      if (!isIPv4(network.gateway)) {
        setNetworkError('Enter a valid gateway address.')
        return
      }
      if (!network.dns.split(',').every((part) => isIPv4(part))) {
        setNetworkError('Enter DNS servers separated by commas, for example 1.1.1.1, 9.9.9.9.')
        return
      }
    }
    setNetworkError('')
    updateSettings({ network: { ...network } })
    pushToast({
      title: 'Network settings saved',
      description:
        network.method === 'dhcp'
          ? 'Orion will keep its DHCP lease.'
          : `Static address ${network.ip}.`,
      tone: 'success',
    })
  }

  const submitUser = (event?: FormEvent) => {
    event?.preventDefault()
    const result = addUser(userForm)
    if (!result.ok) {
      setUserError(result.error ?? 'Could not add that user.')
      return
    }
    setUserError('')
    setAddUserOpen(false)
    setUserForm({ name: '', email: '', role: 'Member' })
  }

  const updateSecurity = (patch: Partial<typeof settings.security>) => {
    updateSettings({ security: { ...settings.security, ...patch } })
  }

  const tab = activeTab

  return (
    <section className="view settings-view">
      <PageHeader
        eyebrow="Control centre"
        title="Settings"
        description="Shape how Orion looks, how it connects, and who can reach it."
        actions={
          <span className="settings-health">
            <span className="live-dot" aria-hidden="true" />
            All systems normal
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
            <span>Orion NAS</span>
            <strong>v1.4.0</strong>
            <small>{settings.hostname}.local</small>
          </div>
        </nav>

        <div className="settings-content">
          {tab === 'general' ? (
            <div className="settings-stack">
              <SectionCard
                title="Device"
                description="A friendly name and regional defaults for everyone on this NAS."
                footer={
                  <>
                    <span className={classNames('settings-dirty', generalDirty && 'is-dirty')}>
                      {generalDirty ? 'Unsaved changes' : 'All changes saved'}
                    </span>
                    <button
                      type="button"
                      className="button"
                      disabled={!generalDirty}
                      onClick={() => {
                        setGeneral({
                          hostname: settings.hostname,
                          language: settings.language,
                          timezone: settings.timezone,
                          updateChannel: settings.updateChannel,
                          autoUpdate: settings.autoUpdate,
                        })
                        setGeneralError('')
                      }}
                    >
                      Discard
                    </button>
                    <button
                      type="submit"
                      form="general-form"
                      className="button button--primary"
                      disabled={!generalDirty}
                    >
                      <Save size={14} aria-hidden="true" />
                      Save changes
                    </button>
                  </>
                }
              >
                <form id="general-form" onSubmit={saveGeneral} className="settings-form">
                  <div className="settings-form__grid">
                    <div className="field">
                      <label htmlFor="device-name">Device name</label>
                      <div className="input-suffix">
                        <input
                          id="device-name"
                          className="input"
                          value={general.hostname}
                          onChange={(event) => {
                            setGeneral({ ...general, hostname: event.target.value })
                            setGeneralError('')
                          }}
                          aria-invalid={Boolean(generalError)}
                        />
                        <span>.local</span>
                      </div>
                      {generalError ? (
                        <span className="field__error" role="alert">
                          <Info size={12} aria-hidden="true" />
                          {generalError}
                        </span>
                      ) : (
                        <span className="field__hint">Shown across the desktop and network shares.</span>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="language">Language</label>
                      <select
                        id="language"
                        className="select"
                        value={general.language}
                        onChange={(event) => setGeneral({ ...general, language: event.target.value })}
                      >
                        <option value="en-US">English (United States)</option>
                        <option value="en-GB">English (United Kingdom)</option>
                        <option value="de-DE">Deutsch</option>
                        <option value="fr-FR">Français</option>
                        <option value="ja-JP">日本語</option>
                      </select>
                      <span className="field__hint">Dates, numbers and interface copy.</span>
                    </div>
                    <div className="field">
                      <label htmlFor="timezone">Timezone</label>
                      <select
                        id="timezone"
                        className="select"
                        value={general.timezone}
                        onChange={(event) => setGeneral({ ...general, timezone: event.target.value })}
                      >
                        {TIMEZONES.map((zone) => (
                          <option key={zone} value={zone}>
                            {zone.replace('_', ' ').replace('/', ' / ')}
                          </option>
                        ))}
                      </select>
                      <span className="field__hint">Used by schedules, backups and logs.</span>
                    </div>
                    <div className="field">
                      <label htmlFor="channel">Update channel</label>
                      <select
                        id="channel"
                        className="select"
                        value={general.updateChannel}
                        onChange={(event) =>
                          setGeneral({
                            ...general,
                            updateChannel: event.target.value as 'stable' | 'beta',
                          })
                        }
                      >
                        <option value="stable">Stable</option>
                        <option value="beta">Beta</option>
                      </select>
                      <span className="field__hint">Stable is recommended for primary storage.</span>
                    </div>
                  </div>
                  <Switch
                    checked={general.autoUpdate}
                    onChange={(checked) => setGeneral({ ...general, autoUpdate: checked })}
                    label="Install updates automatically"
                    description="Orion applies security patches during the maintenance window."
                  />
                </form>
              </SectionCard>

              <div className="settings-split">
                <SectionCard title="This device" description="Read-only hardware and software facts.">
                  <dl className="detail-list">
                    <div>
                      <dt>Model</dt>
                      <dd>Orion One · 4-bay</dd>
                    </div>
                    <div>
                      <dt>Processor</dt>
                      <dd>Intel N305 · 8 cores</dd>
                    </div>
                    <div>
                      <dt>Memory</dt>
                      <dd>16 GB DDR5</dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd>{`Orion OS 1.4.0`}</dd>
                    </div>
                    <div>
                      <dt>Uptime</dt>
                      <dd>47 days, 6 hours</dd>
                    </div>
                    <div>
                      <dt>Installed apps</dt>
                      <dd>{Object.keys(installed).length}</dd>
                    </div>
                  </dl>
                </SectionCard>
                <SectionCard title="Support" description="Get help without leaving the house.">
                  <div className="support-actions">
                    <button
                      type="button"
                      className="support-action"
                      onClick={() =>
                        pushToast({
                          title: 'Documentation',
                          description: 'The Orion handbook would open in a new tab.',
                          tone: 'info',
                        })
                      }
                    >
                      <span className="support-action__icon" aria-hidden="true">
                        <Info size={16} />
                      </span>
                      <span>
                        <strong>Read the handbook</strong>
                        <small>Setup, shares, backups and more</small>
                      </span>
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="support-action"
                      onClick={() =>
                        pushToast({
                          title: 'Community forum',
                          description: 'Orion owners are online 24/7.',
                          tone: 'info',
                        })
                      }
                    >
                      <span className="support-action__icon" aria-hidden="true">
                        <Users size={16} />
                      </span>
                      <span>
                        <strong>Ask the community</strong>
                        <small>12,400 owners and tinkerers</small>
                      </span>
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="support-action"
                      onClick={() =>
                        pushToast({
                          title: 'Diagnostics exported',
                          description: 'A redacted system report is ready (demo).',
                          tone: 'success',
                        })
                      }
                    >
                      <span className="support-action__icon" aria-hidden="true">
                        <Download size={16} />
                      </span>
                      <span>
                        <strong>Export diagnostics</strong>
                        <small>Logs and health report</small>
                      </span>
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </SectionCard>
              </div>
            </div>
          ) : null}

          {tab === 'appearance' ? (
            <div className="settings-stack">
              <SectionCard
                title="Theme"
                description="Changes apply instantly across every screen and stay saved on this browser."
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
                    <span>Compact fits more files and apps on screen.</span>
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
                description="Orion draws these locally, so they stay crisp at any resolution."
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

              <div className="appearance-preview card">
                <div className="appearance-preview__copy">
                  <p className="eyebrow">Live preview</p>
                  <h3>Feels like home</h3>
                  <p>Theme, accent and wallpaper update the entire desktop in real time.</p>
                </div>
                <div className="appearance-preview__mock" aria-hidden="true">
                  <span className="appearance-preview__orb" />
                  <span className="appearance-preview__tile" />
                  <span className="appearance-preview__tile appearance-preview__tile--two" />
                  <span className="appearance-preview__bar" />
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'network' ? (
            <div className="settings-stack">
              <SectionCard
                title="Network"
                description="How Orion appears on your LAN. Changing this briefly interrupts active transfers."
                footer={
                  <>
                    <span className={classNames('settings-dirty', networkDirty && 'is-dirty')}>
                      {networkDirty ? 'Unsaved changes' : 'All changes saved'}
                    </span>
                    <button
                      type="button"
                      className="button"
                      disabled={!networkDirty}
                      onClick={() => {
                        setNetwork(settings.network)
                        setNetworkError('')
                      }}
                    >
                      Discard
                    </button>
                    <button
                      type="submit"
                      form="network-form"
                      className="button button--primary"
                      disabled={!networkDirty}
                    >
                      <Save size={14} aria-hidden="true" />
                      Save network
                    </button>
                  </>
                }
              >
                <form id="network-form" onSubmit={saveNetwork} className="settings-form">
                  <div className="setting-row setting-row--start">
                    <div className="setting-row__copy">
                      <strong>Address method</strong>
                      <span>DHCP is easiest; static addresses are better for port forwarding.</span>
                    </div>
                    <Segmented<'dhcp' | 'static'>
                      label="Address method"
                      value={network.method}
                      onChange={(method) => {
                        setNetwork({ ...network, method })
                        setNetworkError('')
                      }}
                      options={[
                        { value: 'dhcp', label: 'Automatic (DHCP)' },
                        { value: 'static', label: 'Static' },
                      ]}
                    />
                  </div>
                  <div className="settings-form__grid">
                    <div className="field">
                      <label htmlFor="ip-address">IP address</label>
                      <input
                        id="ip-address"
                        className="input tabular"
                        value={network.ip}
                        disabled={network.method === 'dhcp'}
                        onChange={(event) => {
                          setNetwork({ ...network, ip: event.target.value })
                          setNetworkError('')
                        }}
                        aria-invalid={Boolean(networkError)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="gateway">Gateway</label>
                      <input
                        id="gateway"
                        className="input tabular"
                        value={network.gateway}
                        disabled={network.method === 'dhcp'}
                        onChange={(event) => {
                          setNetwork({ ...network, gateway: event.target.value })
                          setNetworkError('')
                        }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="dns">DNS servers</label>
                      <input
                        id="dns"
                        className="input tabular"
                        value={network.dns}
                        disabled={network.method === 'dhcp'}
                        onChange={(event) => {
                          setNetwork({ ...network, dns: event.target.value })
                          setNetworkError('')
                        }}
                        placeholder="1.1.1.1, 9.9.9.9"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="interface">Interface</label>
                      <input id="interface" className="input" value="eth0 · 10 GbE" disabled readOnly />
                    </div>
                  </div>
                  {networkError ? (
                    <span className="field__error" role="alert">
                      <Info size={12} aria-hidden="true" />
                      {networkError}
                    </span>
                  ) : (
                    <span className="field__hint">
                      {network.method === 'dhcp'
                        ? 'Orion will request a fresh lease on save.'
                        : 'Use an address outside your router’s DHCP range.'}
                    </span>
                  )}
                </form>
              </SectionCard>

              <div className="settings-split">
                <SectionCard title="Connection" description="Live link status.">
                  <div className="connection-status">
                    <span className="connection-status__icon" aria-hidden="true">
                      <Wifi size={20} />
                    </span>
                    <div>
                      <strong>Connected · 10 Gbps</strong>
                      <span>eth0 · {settings.network.method === 'dhcp' ? 'DHCP' : 'Static'} · MTU 1500</span>
                    </div>
                    <StatusBadge tone="success">Online</StatusBadge>
                  </div>
                  <dl className="detail-list">
                    <div>
                      <dt>MAC address</dt>
                      <dd>6C:1F:8A:2D:44:B1</dd>
                    </div>
                    <div>
                      <dt>Hostname</dt>
                      <dd>{settings.hostname}.local</dd>
                    </div>
                    <div>
                      <dt>DNS</dt>
                      <dd>{settings.network.dns}</dd>
                    </div>
                    <div>
                      <dt>Uptime</dt>
                      <dd>47 days, 6 hours</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="button button--block"
                    onClick={() =>
                      pushToast({
                        title: 'Lease renewed',
                        description: 'eth0 received a new DHCP lease (demo).',
                        tone: 'success',
                      })
                    }
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    Renew lease
                  </button>
                </SectionCard>
                <SectionCard title="Remote access" description="Reach Orion without opening ports.">
                  <div className="remote-access-state">
                    <span className="remote-access-state__icon" aria-hidden="true">
                      <Globe size={20} />
                    </span>
                    <div>
                      <strong>
                        {settings.security.remoteAccess ? 'Tunnel active' : 'Tunnel disabled'}
                      </strong>
                      <span>
                        {settings.security.remoteAccess
                          ? `orion-${settings.hostname}.orion.link`
                          : 'Enable remote access in Security to get a private link.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button button--sm"
                      onClick={() => onTabChange('security')}
                    >
                      Manage
                    </button>
                  </div>
                  <div className="callout">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <p>
                      Remote sessions are end-to-end encrypted and require two-factor
                      authentication. No port forwarding is needed.
                    </p>
                  </div>
                </SectionCard>
              </div>
            </div>
          ) : null}

          {tab === 'users' ? (
            <div className="settings-stack">
              <SectionCard
                title="Household accounts"
                description="Share Orion with the people you trust. Roles control what each account can change."
                footer={
                  <>
                    <span className="settings-dirty">
                      {users.length} accounts · {users.filter((user) => user.role !== 'Guest').length} full
                      members
                    </span>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => {
                        setAddUserOpen(true)
                        setUserError('')
                      }}
                    >
                      <UserPlus size={14} aria-hidden="true" />
                      Add user
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
                          {user.isCurrent ? <span className="user-you">You</span> : null}
                        </strong>
                        <span>{user.email}</span>
                      </div>
                      <span className={`role-badge role-badge--${user.role.toLowerCase()}`}>
                        {user.role}
                      </span>
                      <span className="user-row__active">{user.lastActive}</span>
                      <button
                        type="button"
                        className="icon-button icon-button--sm user-row__remove"
                        aria-label={`Remove ${user.name}`}
                        title={
                          user.isCurrent || user.role === 'Owner'
                            ? 'This account is protected'
                            : `Remove ${user.name}`
                        }
                        disabled={user.isCurrent || user.role === 'Owner'}
                        onClick={() => setRemoveTarget(user)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard title="Roles" description="A quick reminder of what each role can do.">
                <div className="role-grid">
                  <div className="role-card">
                    <span className="role-badge role-badge--owner">Owner</span>
                    <p>Full control, including storage pools, updates and account removal.</p>
                  </div>
                  <div className="role-card">
                    <span className="role-badge role-badge--admin">Admin</span>
                    <p>Manages apps, shares and users. Cannot delete the owner or reset the device.</p>
                  </div>
                  <div className="role-card">
                    <span className="role-badge role-badge--member">Member</span>
                    <p>Uses apps and personal folders. Can share files within their own space.</p>
                  </div>
                  <div className="role-card">
                    <span className="role-badge role-badge--guest">Guest</span>
                    <p>Limited to shared folders with no access to settings or the App Store.</p>
                  </div>
                </div>
              </SectionCard>
            </div>
          ) : null}

          {tab === 'security' ? (
            <div className="settings-stack">
              <div className="security-hero card">
                <div className="security-hero__score">
                  <div className="security-ring" style={{ '--score': `${securityScore}%` } as CSSProperties}>
                    <div>
                      <strong>{securityScore}</strong>
                      <span>of 100</span>
                    </div>
                  </div>
                </div>
                <div className="security-hero__copy">
                  <p className="eyebrow">Security posture</p>
                  <h2>
                    {securityScore >= 90 ? 'Locked down' : securityScore >= 70 ? 'Looking good' : 'Needs attention'}
                  </h2>
                  <p>
                    Orion is protected against unauthorised LAN access. Enable remote access only
                    when you need it.
                  </p>
                  <div className="security-hero__checks">
                    <span>
                      <CircleCheckBig size={13} aria-hidden="true" /> Firewall active
                    </span>
                    <span>
                      <CircleCheckBig size={13} aria-hidden="true" /> TLS certificates valid
                    </span>
                    <span className={settings.security.twoFactor ? '' : 'is-off'}>
                      <CircleCheckBig size={13} aria-hidden="true" />
                      {settings.security.twoFactor ? 'Two-factor enabled' : 'Two-factor disabled'}
                    </span>
                  </div>
                </div>
                <div className="security-hero__art" aria-hidden="true">
                  <ShieldCheck size={58} strokeWidth={1.2} />
                </div>
              </div>

              <div className="settings-split">
                <SectionCard title="Protection" description="Apply immediately to every account.">
                  <Switch
                    checked={settings.security.remoteAccess}
                    onChange={(checked) => {
                      updateSecurity({ remoteAccess: checked })
                      pushToast({
                        title: checked ? 'Remote access enabled' : 'Remote access disabled',
                        description: checked
                          ? 'A private encrypted tunnel is being established.'
                          : 'Orion is reachable on the local network only.',
                        tone: checked ? 'info' : 'success',
                      })
                    }}
                    label="Remote access"
                    description="Private tunnel via orion.link — no port forwarding."
                  />
                  <Switch
                    checked={settings.security.twoFactor}
                    onChange={(checked) => {
                      updateSecurity({ twoFactor: checked })
                      pushToast({
                        title: checked ? 'Two-factor enforced' : 'Two-factor disabled',
                        description: checked
                          ? 'An authenticator code is now required at sign-in.'
                          : 'Your accounts are less protected.',
                        tone: checked ? 'success' : 'error',
                      })
                    }}
                    label="Two-factor authentication"
                    description="Require a time-based code for every new sign-in."
                  />
                  <Switch
                    checked={settings.security.firewall}
                    onChange={(checked) => updateSecurity({ firewall: checked })}
                    label="Firewall"
                    description="Block unsolicited traffic from the LAN and WAN."
                  />
                  <div className="setting-row setting-row--select">
                    <div className="setting-row__copy">
                      <strong>Auto-lock sessions</strong>
                      <span>Sign out idle browser sessions automatically.</span>
                    </div>
                    <select
                      className="select"
                      value={settings.security.autoLock}
                      onChange={(event) =>
                        updateSecurity({
                          autoLock: event.target.value as typeof settings.security.autoLock,
                        })
                      }
                      aria-label="Auto-lock idle sessions"
                    >
                      <option value="5">After 5 minutes</option>
                      <option value="10">After 10 minutes</option>
                      <option value="30">After 30 minutes</option>
                      <option value="never">Never</option>
                    </select>
                  </div>
                </SectionCard>

                <SectionCard title="Active sessions" description="Revoke anything you don’t recognise.">
                  <ul className="session-list">
                    {sessions.map((session) => {
                      const Icon = session.icon
                      return (
                        <li key={session.id} className="session-row">
                          <span className="session-row__icon" aria-hidden="true">
                            <Icon size={16} />
                          </span>
                          <div className="session-row__copy">
                            <strong>
                              {session.device}
                              {session.current ? <span className="user-you">This device</span> : null}
                            </strong>
                            <span>{session.detail}</span>
                          </div>
                          {session.current ? (
                            <StatusBadge tone="success">Active</StatusBadge>
                          ) : (
                            <button
                              type="button"
                              className="button button--sm button--ghost"
                              onClick={() => {
                                setSessions((previous) =>
                                  previous.filter((item) => item.id !== session.id),
                                )
                                pushToast({
                                  title: 'Session revoked',
                                  description: `${session.device} must sign in again.`,
                                  tone: 'success',
                                })
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  <div className="callout">
                    <KeyRound size={16} aria-hidden="true" />
                    <p>Passwords are hashed with Argon2id and never leave the device.</p>
                  </div>
                </SectionCard>
              </div>

              <SectionCard title="Sign-in activity" description="The last week of access attempts.">
                <ul className="login-list">
                  <li>
                    <span className="login-list__dot login-list__dot--success" aria-hidden="true" />
                    <div>
                      <strong>Successful sign-in</strong>
                      <span>Alex Morgan · Chrome on Windows · 192.168.1.42</span>
                    </div>
                    <time>Just now</time>
                  </li>
                  <li>
                    <span className="login-list__dot login-list__dot--success" aria-hidden="true" />
                    <div>
                      <strong>Successful sign-in</strong>
                      <span>Sam Chen · Orion app on iPhone · 10.0.0.24</span>
                    </div>
                    <time>2 hours ago</time>
                  </li>
                  <li>
                    <span className="login-list__dot login-list__dot--warning" aria-hidden="true" />
                    <div>
                      <strong>Blocked sign-in</strong>
                      <span>Unknown device · invalid password · 45.14.22.9</span>
                    </div>
                    <time>Yesterday</time>
                  </li>
                </ul>
              </SectionCard>
            </div>
          ) : null}

          {tab === 'about' ? (
            <div className="settings-stack">
              <div className="about-hero card">
                <span className="about-hero__mark" aria-hidden="true">
                  <svg viewBox="0 0 40 40">
                    <path
                      d="M10.6 27.4c-2.8 0-5.1-2.2-5.1-4.9 0-2.6 2-4.7 4.6-4.9 1-4.1 4.4-7 8.4-7 4.1 0 7.6 2.8 8.3 6.5 2.6.2 4.6 2.3 4.6 4.9 0 2.7-2.3 4.9-5.1 4.9H10.6Z"
                      fill="currentColor"
                    />
                    <circle cx="16" cy="21.6" r="1.6" fill="var(--bg)" />
                    <circle cx="24" cy="21.6" r="1.6" fill="var(--bg)" />
                  </svg>
                </span>
                <div className="about-hero__copy">
                  <p className="eyebrow">Orion OS</p>
                  <h2>Version 1.4.0</h2>
                  <p>Build 20261023.4 · Orion One · {settings.hostname}</p>
                  <div className="about-hero__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={checkingUpdates}
                      onClick={() => {
                        setCheckingUpdates(true)
                        window.setTimeout(() => {
                          setCheckingUpdates(false)
                          pushToast({
                            title: 'Orion is up to date',
                            description: 'Version 1.4.0 is the latest stable release.',
                            tone: 'success',
                          })
                        }, 1200)
                      }}
                    >
                      {checkingUpdates ? (
                        <Loader2 size={14} className="spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw size={14} aria-hidden="true" />
                      )}
                      {checkingUpdates ? 'Checking…' : 'Check for updates'}
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() =>
                        pushToast({
                          title: 'Release notes',
                          description: 'Orion 1.4 improves SMB multichannel and search.',
                          tone: 'info',
                        })
                      }
                    >
                      What’s new
                    </button>
                  </div>
                </div>
                <div className="about-hero__art" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>

              <div className="settings-split">
                <SectionCard title="System facts" description="Useful when requesting support.">
                  <dl className="detail-list">
                    <div>
                      <dt>Kernel</dt>
                      <dd>Linux 6.12.4-orion</dd>
                    </div>
                    <div>
                      <dt>Architecture</dt>
                      <dd>x86_64</dd>
                    </div>
                    <div>
                      <dt>Container runtime</dt>
                      <dd>Podman 5.4</dd>
                    </div>
                    <div>
                      <dt>Storage</dt>
                      <dd>
                        {storage.pools.length} pools · {storage.disks.length} disks
                      </dd>
                    </div>
                    <div>
                      <dt>Installed apps</dt>
                      <dd>{Object.keys(installed).length}</dd>
                    </div>
                    <div>
                      <dt>License</dt>
                      <dd>Orion Home · perpetual</dd>
                    </div>
                  </dl>
                </SectionCard>
                <SectionCard title="Privacy" description="Your data stays on this device.">
                  <div className="callout callout--stack">
                    <Lock size={16} aria-hidden="true" />
                    <p>
                      Orion only contacts the update service when you ask it to. Files, photos and
                      app data are never uploaded.
                    </p>
                  </div>
                  <div className="callout callout--stack">
                    <BellRing size={16} aria-hidden="true" />
                    <p>
                      Telemetry is off by default. You can opt into anonymous crash reports at any
                      time.
                    </p>
                  </div>
                  <div className="callout callout--stack">
                    <Globe size={16} aria-hidden="true" />
                    <p>Remote access can be disabled instantly without affecting local shares.</p>
                  </div>
                </SectionCard>
              </div>

              <SectionCard
                title="Danger zone"
                description="Reset this browser demo to its original seeded state."
                className="settings-card--danger"
              >
                <div className="danger-row">
                  <div>
                    <strong>Reset demo data</strong>
                    <span>
                      Clears installed apps, folders, users, storage changes and preferences in this
                      browser. Nothing on the real NAS is affected.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => setResetOpen(true)}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    Reset demo
                  </button>
                </div>
              </SectionCard>
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        open={addUserOpen}
        onClose={() => {
          setAddUserOpen(false)
          setUserError('')
        }}
        title="Add a user"
        description="They will receive an invitation to create a password."
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="button"
              onClick={() => {
                setAddUserOpen(false)
                setUserError('')
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-user-form"
              className="button button--primary"
              disabled={!userForm.name.trim() || !userForm.email.trim()}
            >
              <UserPlus size={14} aria-hidden="true" />
              Send invite
            </button>
          </>
        }
      >
        <form id="add-user-form" onSubmit={submitUser} className="settings-form">
          <div className="field">
            <label htmlFor="user-name">Full name</label>
            <input
              id="user-name"
              className="input"
              data-autofocus
              value={userForm.name}
              onChange={(event) => {
                setUserForm({ ...userForm, name: event.target.value })
                setUserError('')
              }}
              placeholder="e.g. Jordan Lee"
            />
          </div>
          <div className="field">
            <label htmlFor="user-email">Email</label>
            <input
              id="user-email"
              className="input"
              type="email"
              value={userForm.email}
              onChange={(event) => {
                setUserForm({ ...userForm, email: event.target.value })
                setUserError('')
              }}
              placeholder="jordan@orion.local"
              aria-invalid={Boolean(userError)}
            />
          </div>
          <div className="field">
            <label htmlFor="user-role">Role</label>
            <select
              id="user-role"
              className="select"
              value={userForm.role}
              onChange={(event) =>
                setUserForm({ ...userForm, role: event.target.value as UserAccount['role'] })
              }
            >
              <option value="Admin">Admin — manage apps and users</option>
              <option value="Member">Member — personal files and apps</option>
              <option value="Guest">Guest — shared folders only</option>
            </select>
          </div>
          {userError ? (
            <span className="field__error" role="alert">
              <Info size={12} aria-hidden="true" />
              {userError}
            </span>
          ) : (
            <span className="field__hint">
              The owner account is protected and cannot be created from this dialog.
            </span>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? 'user'}?`}
        description="They lose access immediately. Shared files remain in place."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setRemoveTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                if (!removeTarget) return
                const result = removeUser(removeTarget.id)
                if (!result.ok) {
                  pushToast({
                    title: 'Could not remove user',
                    description: result.error,
                    tone: 'error',
                  })
                }
                setRemoveTarget(null)
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Remove user
            </button>
          </>
        }
      >
        <div className="danger-note">
          <Trash2 size={17} aria-hidden="true" />
          <span>
            {removeTarget?.name} ({removeTarget?.email}) will be signed out everywhere and will need
            a new invitation to return.
          </span>
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset demo data?"
        description="This clears every change stored in this browser and reloads Orion."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setResetOpen(false)}>
              Keep my changes
            </button>
            <button type="button" className="button button--danger" onClick={resetDemo}>
              <RotateCcw size={14} aria-hidden="true" />
              Reset everything
            </button>
          </>
        }
      >
        <div className="danger-note">
          <RotateCcw size={17} aria-hidden="true" />
          <span>
            Installed apps, folders, uploaded file metadata, users, storage changes and appearance
            preferences will return to their seeded state.
          </span>
        </div>
      </Modal>
    </section>
  )
}
