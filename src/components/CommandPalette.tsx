import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  Music,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { APP_BY_ID, APP_CATALOG } from '../data/apps'
import { useApp } from '../context/AppContext'
import { classNames, formatBytes } from '../lib/format'
import { iconFor } from '../lib/icons'
import type { AppDefinition, FileTone } from '../types'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'

const FILE_ICONS: Record<FileTone, LucideIcon> = {
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

interface Command {
  id: string
  label: string
  description?: string
  group: string
  icon: LucideIcon
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  navigate: (name: RouteName, options?: NavigateOptions) => void
  onLaunchApp: (app: AppDefinition) => void
  resolvedTheme: 'dark' | 'light'
}

export function CommandPalette({
  open,
  onClose,
  navigate,
  onLaunchApp,
  resolvedTheme,
}: CommandPaletteProps) {
  const { files, installed, settings, updateSettings, notifications, markAllRead, pushToast } =
    useApp()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) dialog.showModal()
      setQuery('')
      setActiveIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleClose = () => onClose()
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [onClose])

  const commands = useMemo<Command[]>(() => {
    const normalised = query.trim().toLowerCase()
    const navCommands: Command[] = [
      {
        id: 'nav-dashboard',
        label: 'Go to Dashboard',
        description: 'Widgets, apps and system health',
        group: 'Navigate',
        icon: Sparkles,
        run: () => navigate('dashboard'),
      },
      {
        id: 'nav-files',
        label: 'Go to Files',
        description: 'Browse and manage every share',
        group: 'Navigate',
        icon: Folder,
        run: () => navigate('files'),
      },
      {
        id: 'nav-apps',
        label: 'Go to App Store',
        description: 'Install a self-hosted app in one click',
        group: 'Navigate',
        icon: iconFor('Store'),
        run: () => navigate('apps'),
      },
      {
        id: 'nav-storage',
        label: 'Go to Storage',
        description: 'Pools, disks and health',
        group: 'Navigate',
        icon: iconFor('ArchiveRestore'),
        run: () => navigate('storage'),
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        description: 'Appearance, network, users and security',
        group: 'Navigate',
        icon: iconFor('Settings'),
        run: () => navigate('settings'),
      },
    ]

    const actionCommands: Command[] = [
      {
        id: 'action-theme',
        label: `Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`,
        description: 'Change Orion appearance instantly',
        group: 'Actions',
        icon: Sparkles,
        run: () => {
          updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })
          pushToast({
            title: `${resolvedTheme === 'dark' ? 'Light' : 'Dark'} theme applied`,
            tone: 'info',
          })
        },
      },
      {
        id: 'action-read',
        label: 'Mark all notifications as read',
        description: `${notifications.filter((item) => !item.read).length} unread`,
        group: 'Actions',
        icon: Sparkles,
        run: () => {
          markAllRead()
          pushToast({ title: 'Notifications cleared', tone: 'info' })
        },
      },
      {
        id: 'action-copy',
        label: 'Copy device address',
        description: `${settings.hostname} · ${settings.network.ip}`,
        group: 'Actions',
        icon: Sparkles,
        run: () => {
          if (!navigator.clipboard) {
            pushToast({
              title: 'Clipboard unavailable',
              description: `The address is ${settings.network.ip}`,
              tone: 'error',
            })
            return
          }
          void navigator.clipboard
            .writeText(settings.network.ip)
            .then(() => pushToast({ title: 'Address copied', description: settings.network.ip, tone: 'success' }))
            .catch(() =>
              pushToast({
                title: 'Clipboard unavailable',
                description: `The address is ${settings.network.ip}`,
                tone: 'error',
              }),
            )
        },
      },
    ]

    const fileCommands: Command[] =
      normalised.length < 1
        ? []
        : files
            .filter((file) => {
              const haystack = `${file.name} ${file.parent}`.toLowerCase()
              return haystack.includes(normalised)
            })
            .slice(0, 6)
            .map((file) => {
              const Icon = FILE_ICONS[file.tone]
              return {
                id: `file-${file.id}`,
                label: file.name,
                description: `${file.parent} · ${file.type === 'folder' ? 'Folder' : formatBytes(file.size)}`,
                group: 'Files',
                icon: Icon,
                run: () =>
                  navigate('files', { path: file.parent, highlight: file.id }),
              }
            })

    const appCommands: Command[] =
      normalised.length < 1
        ? []
        : APP_CATALOG.filter((app) =>
            `${app.name} ${app.tagline} ${app.category}`.toLowerCase().includes(normalised),
          )
            .slice(0, 5)
            .map((app) => {
              const installedApp = installed[app.id]
              return {
                id: `app-${app.id}`,
                label: installedApp ? `Open ${app.name}` : `Find ${app.name} in App Store`,
                description: installedApp
                  ? `${app.category} · ${installedApp.running ? 'Running' : 'Stopped'}`
                  : `${app.category} · Not installed`,
                group: 'Apps',
                icon: APP_BY_ID.has(app.id) ? iconFor(app.icon) : Sparkles,
                run: () => {
                  if (installedApp) onLaunchApp(app)
                  else navigate('apps')
                },
              }
            })

    const all = [...navCommands, ...fileCommands, ...appCommands, ...actionCommands]
    if (!normalised) return all
    return all.filter((command) => {
      if (command.group === 'Files' || command.group === 'Apps') return true
      return `${command.label} ${command.description ?? ''}`.toLowerCase().includes(normalised)
    })
  }, [
    files,
    installed,
    markAllRead,
    navigate,
    notifications,
    onLaunchApp,
    pushToast,
    query,
    resolvedTheme,
    settings.hostname,
    settings.network.ip,
    updateSettings,
  ])

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(commands.length - 1, 0)))
  }, [commands.length])

  useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${activeIndex}"]`,
    )
    option?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const runCommand = (command: Command | undefined) => {
    if (!command) return
    command.run()
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % Math.max(commands.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(
        (current) => (current - 1 + Math.max(commands.length, 1)) % Math.max(commands.length, 1),
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runCommand(commands[activeIndex])
    }
  }

  let previousGroup = ''

  return createPortal(
    <dialog
      ref={dialogRef}
      className="palette-dialog"
      aria-label="Command palette"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="palette">
        <div className="palette__search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search files, apps and commands…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={
              commands[activeIndex] ? `command-${commands[activeIndex].id}` : undefined
            }
          />
          <kbd>ESC</kbd>
        </div>

        <div className="palette__results" id="command-results" role="listbox" ref={listRef}>
          {commands.length === 0 ? (
            <div className="palette__empty">
              <Search size={20} aria-hidden="true" />
              <strong>No matches</strong>
              <span>Try a file name, an app, or “storage”.</span>
            </div>
          ) : (
            commands.map((command, index) => {
              const Icon = command.icon
              const showGroup = command.group !== previousGroup
              previousGroup = command.group
              return (
                <div key={command.id}>
                  {showGroup ? <p className="palette__group">{command.group}</p> : null}
                  <button
                    type="button"
                    id={`command-${command.id}`}
                    data-command-index={index}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={classNames('palette__item', index === activeIndex && 'is-active')}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runCommand(command)}
                  >
                    <span className="palette__icon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className="palette__copy">
                      <strong>{command.label}</strong>
                      {command.description ? <span>{command.description}</span> : null}
                    </span>
                    {index === activeIndex ? (
                      <CornerDownLeft size={14} className="palette__enter" aria-hidden="true" />
                    ) : null}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="palette__footer">
          <span>
            <kbd>
              <ArrowUp size={11} aria-hidden="true" />
              <ArrowDown size={11} aria-hidden="true" />
            </kbd>
            to navigate
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={11} aria-hidden="true" />
            </kbd>
            to select
          </span>
          <span className="palette__brand">Orion Command</span>
        </div>
      </div>
    </dialog>,
    document.body,
  )
}
