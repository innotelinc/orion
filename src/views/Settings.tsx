import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Check,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Network,
  Palette,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { classNames, formatBytes } from '../lib/format'
import { signOut } from '../lib/session'
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
  Space,
  ThemeMode,
  TimeFormat,
  UserRole,
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
  { id: 'users', label: 'Users', icon: Users, hint: 'Spaces' },
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

const ROLE_TONE: Record<string, string> = {
  'Platform admin': 'platform',
  'Agency admin': 'agency',
  Member: 'member',
  Guest: 'guest',
}

function roleTone(role: UserRole) {
  return ROLE_TONE[role] ?? 'member'
}

function uptimeLabel(seconds: number) {  const days = Math.floor(seconds / 86_400)
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
    session,
    signin,
    system,
    services,
    users,
    spaces,
    apps,
    addSpace,
    removeSpace,
    setSpacePassword,
    setSpaceRole,
    pushToast,
    storage,
    refresh,
    resetPreferences,
    loading,
  } = useApp()
  const tab = activeTab
  const [spaceForm, setSpaceForm] = useState({
    name: '',
    email: '',
    role: 'Member' as UserRole,
    agency: '',
    password: '',
  })
  const [spaceError, setSpaceError] = useState<string | null>(null)
  const [spaceOpen, setSpaceOpen] = useState(false)
  const [removeSpaceTarget, setRemoveSpaceTarget] = useState<Space | null>(null)
  const [spaceBusy, setSpaceBusy] = useState(false)
  const [roleTarget, setRoleTarget] = useState<Space | null>(null)
  const [roleValue, setRoleValue] = useState<UserRole>('Member')
  const [roleError, setRoleError] = useState<string | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<Space | null>(null)
  const [passwordValue, setPasswordValue] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const smbApp = apps.find((app) => app.id === 'smb')
  // Who may administer whom is decided by the API; the UI only mirrors it so a
  // member is not offered buttons the host would refuse.
  const canManageUsers = session.permissions.manageUsers
  const platformWide = session.permissions.scope === 'all'
  const myAgency = spaces.find((space) => space.slug === session.permissions.agency)
  const agencies = spaces.filter((space) => space.role === 'Agency admin')
  const roleChoices: UserRole[] = platformWide
    ? ['Agency admin', 'Member', 'Guest']
    : ['Member', 'Guest']

  const submitPassword = async () => {
    if (!passwordTarget) return
    if (passwordValue.length < 8) {
      setPasswordError('Use at least 8 characters.')
      return
    }
    setSpaceBusy(true)
    const result = await setSpacePassword(passwordTarget.id, passwordValue)
    setSpaceBusy(false)
    if (!result.ok) {
      setPasswordError(result.error ?? 'The host refused that password.')
      return
    }
    setPasswordTarget(null)
    setPasswordValue('')
  }

  const submitRole = async () => {
    if (!roleTarget) return
    setSpaceBusy(true)
    const result = await setSpaceRole(roleTarget.id, roleValue)
    setSpaceBusy(false)
    if (!result.ok) {
      setRoleError(result.error ?? 'The host refused that change.')
      return
    }
    setRoleTarget(null)
  }

  const submitSpace = async () => {
    const name = spaceForm.name.trim()
    if (name.length < 2) {
      setSpaceError('Give the person a name.')
      return
    }
    setSpaceBusy(true)
    const result = await addSpace({
      name,
      email: spaceForm.email.trim(),
      role: spaceForm.role,
      agency: spaceForm.role === 'Agency admin' ? '' : spaceForm.agency || undefined,
      password: spaceForm.password || undefined,
    })
    setSpaceBusy(false)
    if (!result.ok) {
      setSpaceError(result.error ?? 'Could not create that space.')
      return
    }
    setSpaceOpen(false)
    setSpaceForm({ name: '', email: '', role: 'Member', agency: '', password: '' })
  }

  const confirmRemoveSpace = async () => {
    if (!removeSpaceTarget) return
    setSpaceBusy(true)
    const result = await removeSpace(removeSpaceTarget.id)
    setSpaceBusy(false)
    if (!result.ok) {
      pushToast({
        title: 'Could not remove that space',
        description: result.error,
        tone: 'error',
      })
    }
    setRemoveSpaceTarget(null)
  }
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
                title="Spaces"
                description="One folder per person on the storage volume. A space is a folder, not a session: adding someone creates their folder, and removing them moves it to Trash."
                footer={
                  <>
                    <span className="settings-dirty">
                      {spaces.length} {spaces.length === 1 ? 'space' : 'spaces'} ·{' '}
                      {formatBytes(spaces.reduce((sum, space) => sum + space.usedBytes, 0))} stored
                    </span>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={!canManageUsers}
                      title={
                        canManageUsers
                          ? platformWide
                            ? 'Add anyone to this box'
                            : `Add someone to ${myAgency?.name ?? 'your agency'}`
                          : 'Only a platform admin or an agency admin can add people'
                      }
                      onClick={() => {
                        setSpaceError(null)
                        // A previous form may have been left on a role this
                        // session cannot appoint.
                        setSpaceForm((previous) => ({
                          ...previous,
                          role: roleChoices.includes(previous.role) ? previous.role : 'Member',
                          agency: platformWide ? previous.agency : '',
                        }))
                        setSpaceOpen(true)
                      }}
                    >
                      <UserPlus size={14} aria-hidden="true" />
                      New space
                    </button>
                  </>
                }
              >
                <div className="user-scope">
                  <span className="user-scope__role">
                    <ShieldCheck size={14} aria-hidden="true" />
                    {session.role}
                  </span>
                  <span>
                    {canManageUsers
                      ? platformWide
                        ? 'You administer every account on this box.'
                        : `You administer the people filed under ${
                            myAgency?.name ?? session.agency
                          }, and nobody else.`
                      : 'You can see every space. Adding, removing and re-keying people is reserved for administrators.'}
                  </span>
                </div>
                {spaces.length ? (
                  <ul className="user-list">
                    {spaces.map((space) => (
                      <li key={space.id} className="user-row">
                        <Avatar name={space.name} color={space.color} size="md" />
                        <div className="user-row__copy">
                          <strong>{space.name}</strong>
                          <span>{space.email || 'no address recorded'}</span>
                          <span>
                            {space.path} · {formatBytes(space.usedBytes)} stored
                            {space.smb ? ' · SMB share' : ''}
                            {space.signin ? ` · signs in as ${space.signin}` : ''}
                            {space.agency
                              ? ` · under ${spaces.find((item) => item.slug === space.agency)?.name ?? space.agency}`
                              : ''}
                          </span>
                        </div>
                        <span className={`role-badge role-badge--${roleTone(space.role)}`}>
                          {space.role}
                        </span>
                        <span className="user-row__active">
                          {space.createdAt ? `added ${space.createdAt.slice(0, 10)}` : 'available'}
                        </span>
                        {smbApp?.installed && space.manageable !== false ? (
                          <button
                            type="button"
                            className="button button--sm button--ghost"
                            title={
                              space.smb
                                ? 'Change the SMB password for this share'
                                : 'Create the SMB account and share for this space'
                            }
                            onClick={() => {
                              setPasswordTarget(space)
                              setPasswordValue('')
                              setPasswordError(null)
                            }}
                          >
                            <KeyRound size={13} aria-hidden="true" />
                            {space.smb ? 'SMB' : 'Enable SMB'}
                          </button>
                        ) : null}
                        {platformWide ? (
                          <button
                            type="button"
                            className="button button--sm button--ghost"
                            title={
                              space.role === 'Agency admin'
                                ? `Stop ${space.name} administering an agency`
                                : `Let ${space.name} administer an agency`
                            }
                            onClick={() => {
                              setRoleTarget(space)
                              setRoleValue(space.role === 'Agency admin' ? 'Member' : 'Agency admin')
                              setRoleError(null)
                            }}
                          >
                            <UserCog size={13} aria-hidden="true" />
                            {space.role === 'Agency admin' ? 'Demote' : 'Promote'}
                          </button>
                        ) : null}
                        {space.manageable !== false ? (
                          <button
                            type="button"
                            className="icon-button icon-button--sm user-row__remove"
                            aria-label={`Remove ${space.name}`}
                            title={`Remove ${space.name}`}
                            onClick={() => setRemoveSpaceTarget(space)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        ) : (
                          <span
                            className="user-row__locked"
                            title="Only a platform admin, or the agency admin this person is filed under, can change this account"
                          >
                            <Lock size={13} aria-hidden="true" />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="dim">
                    No spaces yet. A new one appears under <code>Users</code> in Files, and can hold
                    anything that person uploads.
                  </p>
                )}
              </SectionCard>

              <SectionCard
                title="Accounts"
                description="Everyone this app knows: the sign-in the edge forwarded for this session, and the spaces an admin issued. The container's own Unix accounts are plumbing and are not listed here."                footer={
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
                      <span className={`role-badge role-badge--${roleTone(user.role)}`}>
                        {user.role}
                      </span>
                      <span className="user-row__active">{user.lastActive}</span>
                    </li>
                  ))}
                </ul>
                {users.length === 0 ? (
                  <p className="dim">
                    Nobody yet. Sign in at the edge, or add a space above to issue an account.
                  </p>
                ) : null}
              </SectionCard>

              <SectionCard
                title="How access actually works"
                description="A space organises files; it does not grant access."
                footer={
                  <>
                    <span className="settings-dirty">
                      {identity?.email ?? 'no edge session'}
                    </span>
                    {identity ? (
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={signOut}
                      >
                        <LogOut size={14} aria-hidden="true" />
                        Sign out
                      </button>
                    ) : null}
                  </>
                }
              >
                <p className="settings-note">
                  People sign in at the edge. The proxy forwards the address in{' '}
                  <code>X-Auth-Request-Email</code>, which is the row marked “This session”, and
                  every signed-in visitor sees the same desktop — so a space is a shared folder,
                  not a private one. Administration is two levels: a{' '}
                  <strong>platform admin</strong> owns every account on the box (granted by the
                  provider's <code>orion-platform-admins</code> group, or recorded in{' '}
                  <code>.orion/platform-admins.json</code>), and an <strong>agency admin</strong>{' '}
                  owns only the people filed under their own space. Signing out ends the proxy
                  cookie and the Authentik session behind it, so the next visit asks for a
                  password again.
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

      <Modal
        open={spaceOpen}
        onClose={() => setSpaceOpen(false)}
        title="New space"
        description="Creates a folder on the storage volume. Nothing is asked of the host's own accounts."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setSpaceOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={spaceBusy || !spaceForm.name.trim()}
              onClick={() => void submitSpace()}
            >
              <UserPlus size={14} aria-hidden="true" />
              Create space
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="space-name">Name</label>
          <input
            id="space-name"
            className="input"
            data-autofocus
            value={spaceForm.name}
            onChange={(event) => {
              setSpaceForm((previous) => ({ ...previous, name: event.target.value }))
              setSpaceError(null)
            }}
            placeholder="e.g. Ada Lovelace"
            aria-invalid={Boolean(spaceError)}
          />
          <span className="field__hint">The folder is named from this: ada-lovelace.</span>
        </div>
        <div className="field">
          <label htmlFor="space-email">Email (optional)</label>
          <input
            id="space-email"
            className="input"
            type="email"
            value={spaceForm.email}
            onChange={(event) => {
              setSpaceForm((previous) => ({ ...previous, email: event.target.value }))
              setSpaceError(null)
            }}
            placeholder="who the folder belongs to"
          />
        </div>
        <div className="field">
          <label htmlFor="space-password">Password (optional)</label>
          <input
            id="space-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={spaceForm.password}
            onChange={(event) => {
              setSpaceForm((previous) => ({ ...previous, password: event.target.value }))
              setSpaceError(null)
            }}
            placeholder="at least 8 characters"
          />
          <span className="field__hint">
            {signin.available && spaceForm.email.trim()
              ? `One password for their share and their sign-in. It creates the account in ${signin.group}.`
              : signin.available
                ? `Add an email and this also creates their sign-in in ${signin.group}. Leave it empty for a folder only.`
                : smbApp?.installed
                  ? 'Creates their Samba account and share. Leave it empty for a folder only.'
                  : 'Install SMB sharing in the App Store to give spaces network access.'}
          </span>
        </div>
        <div className="field">
          <label htmlFor="space-role">Label</label>
          <select
            id="space-role"
            className="input"
            value={spaceForm.role}
            onChange={(event) =>
              setSpaceForm((previous) => ({ ...previous, role: event.target.value as UserRole }))
            }
          >
            {(['Agency admin', 'Member', 'Guest'] as UserRole[])
              .filter((role) => roleChoices.includes(role))
              .map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <span className="field__hint">
            {platformWide
              ? 'An agency admin runs the people filed under them; a member only has a folder. Platform admin is granted by the provider group, not from here.'
              : 'A member only has a folder. Only a platform admin can appoint an agency admin.'}
          </span>
        </div>
        {platformWide && spaceForm.role !== 'Agency admin' ? (
          <div className="field">
            <label htmlFor="space-agency">Agency (optional)</label>
            <select
              id="space-agency"
              className="input"
              value={spaceForm.agency}
              onChange={(event) =>
                setSpaceForm((previous) => ({ ...previous, agency: event.target.value }))
              }
            >
              <option value="">Unfiled</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.slug}>
                  {agency.name}
                </option>
              ))}
            </select>
            <span className="field__hint">
              Files this person under an agency admin, who can then add, remove and re-key them.
            </span>
          </div>
        ) : null}
        {spaceError ? (
          <span className="field__error" role="alert">
            {spaceError}
          </span>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(roleTarget)}
        onClose={() => setRoleTarget(null)}
        title={roleTarget ? `Change the role of ${roleTarget.name}` : 'Change role'}
        description="A role decides which accounts this person may administer; it never hides files from them."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setRoleTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={spaceBusy || !roleTarget || roleTarget.role === roleValue}
              onClick={() => void submitRole()}
            >
              <UserCog size={14} aria-hidden="true" />
              Save role
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="space-role-set">Role</label>
          <select
            id="space-role-set"
            className="input"
            value={roleValue}
            onChange={(event) => {
              setRoleValue(event.target.value as UserRole)
              setRoleError(null)
            }}
          >
            {(['Agency admin', 'Member', 'Guest'] as UserRole[]).map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <span className="field__hint">
            {roleValue === 'Agency admin'
              ? `${roleTarget?.name ?? 'They'} can add, remove and re-key the people filed under ${roleTarget?.name ?? 'them'} — and nobody else.`
              : 'Anyone filed under their agency becomes unfiled. Their folders and shares are untouched.'}
          </span>
        </div>
        {roleError ? (
          <span className="field__error" role="alert">
            {roleError}
          </span>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(passwordTarget)}
        onClose={() => setPasswordTarget(null)}
        title={passwordTarget?.smb ? 'Change SMB password' : 'Give this space SMB access'}
        description={
          passwordTarget
            ? passwordTarget.signin
              ? `${passwordTarget.name} uses this for their share and their sign-in (${passwordTarget.signin}).`
              : `${passwordTarget.name} will sign in to their own share as “${passwordTarget.slug}”.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setPasswordTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={spaceBusy || passwordValue.length < 8}
              onClick={() => void submitPassword()}
            >
              <KeyRound size={14} aria-hidden="true" />
              Save password
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="space-password-set">Password</label>
          <input
            id="space-password-set"
            className="input"
            type="password"
            autoComplete="new-password"
            data-autofocus
            value={passwordValue}
            onChange={(event) => {
              setPasswordValue(event.target.value)
              setPasswordError(null)
            }}
            placeholder="at least 8 characters"
            aria-invalid={Boolean(passwordError)}
          />
          {passwordError ? (
            <span className="field__error" role="alert">
              {passwordError}
            </span>
          ) : (
            <span className="field__hint">
              Stored by Samba, not by Orion: the API passes it to <code>smbpasswd</code> and keeps
              no copy.
            </span>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(removeSpaceTarget)}
        onClose={() => setRemoveSpaceTarget(null)}
        title={removeSpaceTarget ? `Remove ${removeSpaceTarget.name}?` : 'Remove space?'}
        description="The folder and everything in it move to Trash. Nothing is unlinked."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setRemoveSpaceTarget(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={spaceBusy}
              onClick={() => void confirmRemoveSpace()}
            >
              <Trash2 size={14} aria-hidden="true" />
              Move to Trash
            </button>
          </>
        }
      >
        {removeSpaceTarget ? (
          <div className="danger-note">
            <Trash2 size={17} aria-hidden="true" />
            <span>
              <code>{removeSpaceTarget.path}</code> · {formatBytes(removeSpaceTarget.usedBytes)} of
              files
            </span>
          </div>
        ) : null}
      </Modal>
    </section>
  )
}
