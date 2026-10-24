import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  BellRing,
  CheckCheck,
  Moon,
  Search,
  Server,
  Sun,
  X,
} from 'lucide-react'
import { useClickOutside } from '../hooks/useClickOutside'
import { useApp } from '../context/AppContext'
import { classNames } from '../lib/format'
import { Avatar } from './ui/Avatar'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'
import type { NotificationItem } from '../types'

const TONE_ICONS = {
  info: Bell,
  success: CheckCheck,
  warning: Server,
  danger: BellRing,
}

function NotificationsMenu({
  navigate,
}: {
  navigate: (name: RouteName, options?: NavigateOptions) => void
}) {
  const { notifications, markAllRead, markRead, dismissNotification } = useApp()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useClickOutside(menuRef, () => setOpen(false), open)
  const unread = notifications.filter((notification) => !notification.read).length

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  const openNotification = (notification: NotificationItem) => {
    markRead(notification.id)
    if (notification.action) {
      navigate(notification.action.route, {
        path: notification.action.path,
        tab: notification.action.tab,
      })
    }
    setOpen(false)
  }

  return (
    <div className="notif-menu" ref={menuRef}>
      <button
        type="button"
        className={classNames('icon-button', unread > 0 && 'icon-button--alert')}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 ? <span className="notif-dot">{unread}</span> : null}
      </button>

      {open ? (
        <div className="notif-popover" role="dialog" aria-label="Notifications">
          <div className="notif-popover__head">
            <div>
              <strong>Notifications</strong>
              <span>{unread ? `${unread} unread` : 'All caught up'}</span>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={markAllRead}
              disabled={!unread}
            >
              Mark all read
            </button>
          </div>

          <div className="notif-popover__list">
            {notifications.length === 0 ? (
              <div className="notif-empty">
                <CheckCheck size={22} aria-hidden="true" />
                <strong>Nothing new</strong>
                <span>Orion will ping you if something needs attention.</span>
              </div>
            ) : (
              notifications.map((notification) => {
                const Icon = TONE_ICONS[notification.tone]
                return (
                  <article
                    key={notification.id}
                    className={classNames(
                      'notif-item',
                      !notification.read && 'is-unread',
                      `notif-item--${notification.tone}`,
                    )}
                  >
                    <span className="notif-item__icon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <div className="notif-item__copy">
                      <div className="notif-item__title">
                        <strong>{notification.title}</strong>
                        <time>{notification.time}</time>
                      </div>
                      <p>{notification.body}</p>
                      {notification.action ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => openNotification(notification)}
                        >
                          {notification.action.label}
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="notif-item__dismiss"
                      aria-label={`Dismiss ${notification.title}`}
                      onClick={() => dismissNotification(notification.id)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </article>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface TitleBarProps {
  resolvedTheme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenPalette: () => void
  navigate: (name: RouteName, options?: NavigateOptions) => void
}

export function TitleBar({ resolvedTheme, onToggleTheme, onOpenPalette, navigate }: TitleBarProps) {
  const { settings, users, mode, liveSystem } = useApp()
  const currentUser = users.find((user) => user.isCurrent) ?? users[0]
  const hostname = liveSystem?.hostname ?? settings.hostname
  const address = liveSystem
    ? `${liveSystem.cpu.cores} cores · ${liveSystem.arch}`
    : settings.network.ip

  return (
    <header className="titlebar">
      <div className="titlebar__brand-group">
        <button
          type="button"
          className="brand"
          onClick={() => navigate('dashboard')}
          aria-label="Orion home"
        >
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" role="presentation">
              <path
                d="M10.6 27.4c-2.8 0-5.1-2.2-5.1-4.9 0-2.6 2-4.7 4.6-4.9 1-4.1 4.4-7 8.4-7 4.1 0 7.6 2.8 8.3 6.5 2.6.2 4.6 2.3 4.6 4.9 0 2.7-2.3 4.9-5.1 4.9H10.6Z"
                fill="currentColor"
              />
              <circle cx="16" cy="21.6" r="1.6" fill="var(--bg)" />
              <circle cx="24" cy="21.6" r="1.6" fill="var(--bg)" />
            </svg>
          </span>
          <span className="brand__name">Orion</span>
          <span className="brand__tag">NAS</span>
        </button>

        <button
          type="button"
          className="device-chip"
          onClick={() => navigate('settings', { tab: 'general' })}
          title={`${hostname} · ${address}`}
        >
          <Server size={14} aria-hidden="true" />
          <span className="device-chip__copy">
            <strong>{hostname}</strong>
            <span>{address}</span>
          </span>
          <span className="device-chip__status" aria-label="System online" />
        </button>
      </div>

      <button
        type="button"
        className="command-trigger"
        onClick={onOpenPalette}
        aria-label="Open command palette"
      >
        <Search size={16} aria-hidden="true" />
        <span>Search files, apps, and commands</span>
        <kbd>
          <span className="key-mod">⌘</span>K
        </kbd>
      </button>

      <div className="titlebar__actions">
        <span
          className="titlebar__system"
          title={
            mode === 'live'
              ? 'Reading this machine: real files, disks and metrics'
              : 'No server detected — showing the built-in demo dataset'
          }
        >
          <span className="live-dot" aria-hidden="true" />
          {mode === 'live' ? 'Live host' : 'Demo data'}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {resolvedTheme === 'dark' ? (
            <Sun size={18} aria-hidden="true" />
          ) : (
            <Moon size={18} aria-hidden="true" />
          )}
        </button>
        <NotificationsMenu navigate={navigate} />
        <button
          type="button"
          className="profile-button"
          onClick={() => navigate('settings', { tab: 'users' })}
          aria-label="Open account settings"
          title={currentUser?.name}
        >
          <Avatar
            name={currentUser?.name ?? 'Alex Morgan'}
            color={currentUser?.color ?? '#0a63ff'}
            size="sm"
          />
        </button>
      </div>
    </header>
  )
}
