import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Music,
  PanelRight,
  Pencil,
  Search,
  Star,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { joinPath } from '../data/files'
import { downloadUrl } from '../lib/api'
import { useApp } from '../context/AppContext'
import { classNames, formatBytes, formatFullDateTime, formatPercent, relativeTime } from '../lib/format'
import { shareState } from '../lib/shares'
import { Avatar } from '../components/ui/Avatar'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { ProgressBar } from '../components/ui/ProgressBar'
import { iconFor } from '../lib/icons'
import type { FileNode, FileTone } from '../types'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'

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

function iconForRoot(name: string) {
  const key = name.toLowerCase()
  if (key.includes('photo') || key.includes('image')) return 'Images'
  if (key.includes('media') || key.includes('video') || key.includes('movie')) return 'PlayCircle'
  if (key.includes('doc')) return 'FileText'
  if (key.includes('backup')) return 'ArchiveRestore'
  if (key.includes('download')) return 'ArrowDownToLine'
  if (key.includes('share') || key.includes('public')) return 'Users'
  if (key.includes('music')) return 'Music'
  return 'FolderOpen'
}

const TYPE_LABELS: Record<FileTone, string> = {
  folder: 'Folder',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  sheet: 'Spreadsheet',
  archive: 'Archive',
  code: 'Source file',
  file: 'File',
}

type SortKey = 'name' | 'modified' | 'size'

interface FilesProps {
  navigate: (name: RouteName, options?: NavigateOptions) => void
  initialPath?: string
  initialTrash?: boolean
  highlightId?: string
}

export function Files({ navigate, initialPath, initialTrash, highlightId }: FilesProps) {
  const {
    files,
    roots,
    spaces,
    storage,
    users,
    settings,
    addFolder,
    addUploads,
    renameFile,
    deleteFiles,
    toggleStar,
    trashItems,
    trashCount,
    loadTrash,
    restoreTrash,
    emptyTrash,
    pushToast,
  } = useApp()

  const currentPath = initialPath ?? '/'
  // Trash is a pane of Files rather than a folder: its items are not part of the
  // tree, and the route says so (`#/files?trash=1`) so a link can open it.
  const trashOpen = Boolean(initialTrash)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDetails, setShowDetails] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderError, setNewFolderError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [trashBusy, setTrashBusy] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = files.filter(
      (node) =>
        node.parent === currentPath &&
        (!needle || node.name.toLowerCase().includes(needle)),
    )
    return filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      let comparison = 0
      if (sortKey === 'name') comparison = a.name.localeCompare(b.name)
      if (sortKey === 'size') comparison = (a.size ?? -1) - (b.size ?? -1)
      if (sortKey === 'modified')
        comparison = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
      return sortAsc ? comparison : -comparison
    })
  }, [currentPath, files, query, sortAsc, sortKey])

  const selectedNodes = files.filter((node) => selectedIds.has(node.id))
  const activeNode = selectedNodes.length === 1 ? selectedNodes[0] : null
  const allSelected = entries.length > 0 && entries.every((node) => selectedIds.has(node.id))
  const someSelected = entries.some((node) => selectedIds.has(node.id))

  const totalUsed = storage.pools.reduce((total, pool) => total + pool.usedBytes, 0)
  const totalCapacity = storage.pools.reduce((total, pool) => total + pool.totalBytes, 0)
  const usedPercent = formatPercent(totalUsed, totalCapacity)
  const folderSize = entries.reduce((total, node) => total + (node.size ?? 0), 0)

  // The pane reads the trash when it opens, and after every change made here.
  useEffect(() => {
    if (!trashOpen) return
    setSelectedIds(new Set())
    void loadTrash()
  }, [trashOpen, loadTrash])

  useEffect(() => {
    if (!highlightId) return
    const node = files.find((file) => file.id === highlightId)
    if (!node) return
    setSelectedIds(new Set([node.id]))
    setShowDetails(true)
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-file-id="${node.id}"]`)
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target?.focus?.()
    }, 180)
    return () => window.clearTimeout(timer)
  }, [files, highlightId])

  const breadcrumbs = useMemo(() => {
    const segments = currentPath.split('/').filter(Boolean)
    return [
      { label: 'Orion', path: '/' },
      ...segments.map((segment, index) => ({
        label: segment,
        path: `/${segments.slice(0, index + 1).join('/')}`,
      })),
    ]
  }, [currentPath])

  const toggleSelected = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectOnly = (id: string) => {
    setSelectedIds(new Set([id]))
    setShowDetails(true)
  }

  const openEntry = (node: FileNode) => {
    if (node.type === 'folder') {
      navigate('files', { path: joinPath(currentPath, node.name) })
      return
    }
    selectOnly(node.id)
  }

  const handleUploads = (list: FileList | null) => {
    if (!list || list.length === 0) return
    void addUploads(currentPath, Array.from(list))
    if (uploadRef.current) uploadRef.current.value = ''
  }

  const createFolder = async () => {
    const result = await addFolder(currentPath, newFolderName)
    if (!result.ok) {
      setNewFolderError(result.error ?? 'Could not create that folder.')
      return
    }
    setNewFolderOpen(false)
    setNewFolderName('')
    setNewFolderError(null)
  }

  const submitRename = async () => {
    if (!renameTarget) return
    const result = await renameFile(renameTarget.id, renameValue)
    if (!result.ok) {
      setRenameError(result.error ?? 'Could not rename that item.')
      return
    }
    setRenameTarget(null)
    setRenameError(null)
  }

  const confirmDelete = () => {
    void deleteFiles(Array.from(selectedIds))
    setSelectedIds(new Set())
    setDeleteOpen(false)
  }

  const submitRestore = async (name: string) => {
    setTrashBusy(true)
    const result = await restoreTrash(name)
    setTrashBusy(false)
    if (!result.ok) {
      pushToast({
        title: 'Could not put that back',
        description: result.error,
        tone: 'error',
      })
    }
  }

  const confirmEmptyTrash = async () => {
    setTrashBusy(true)
    const result = await emptyTrash()
    setTrashBusy(false)
    setEmptyTrashOpen(false)
    if (!result.ok) {
      pushToast({ title: 'Could not empty Trash', description: result.error, tone: 'error' })
    }
  }

  const trashBytes = trashItems.reduce((total, item) => total + item.size, 0)

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      pushToast({ title: 'Path copied', description: path, tone: 'success' })
    } catch {
      pushToast({ title: 'Clipboard unavailable', description: path, tone: 'error' })
    }
  }

  const userFor = (owner: string) =>
    users.find((user) => user.account === owner) ?? users.find((user) => user.id === owner)

  return (
    <section className="view files-view">
      <PageHeader
        eyebrow="Home cloud"
        title="Files"
        description="Every share, folder and permission in one place. Drop files anywhere to upload."
        actions={
          <>
            <button
              type="button"
              className="button"
              onClick={() => {
                setNewFolderOpen(true)
                setNewFolderError(null)
                setNewFolderName('')
              }}
            >
              <FolderPlus size={15} aria-hidden="true" />
              New folder
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => uploadRef.current?.click()}
            >
              <Upload size={15} aria-hidden="true" />
              Upload
            </button>
            <input
              ref={uploadRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => handleUploads(event.target.files)}
            />
          </>
        }
      />

      <div
        className={classNames('files-layout card', dragging && 'is-dragging')}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          handleUploads(event.dataTransfer.files)
        }}
      >
        <aside className="files-sidebar" aria-label="Folders">
          <p className="files-sidebar__label">Quick access</p>
          <nav className="files-sidebar__nav">
            <button
              type="button"
              className={classNames('files-sidebar__item', currentPath === '/' && 'is-active')}
              onClick={() => navigate('files', { path: '/' })}
            >
              <HardDrive size={15} aria-hidden="true" />
              <span>All files</span>
              <small>{files.filter((file) => file.parent === '/').length}</small>
            </button>
            {roots.map((root) => {
              const Icon = iconFor(iconForRoot(root.label))
              const active = currentPath === root.path || currentPath.startsWith(`${root.path}/`)
              return (
                <button
                  key={root.path}
                  type="button"
                  className={classNames('files-sidebar__item', active && 'is-active')}
                  onClick={() => navigate('files', { path: root.path })}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{root.label}</span>
                  <small>{files.filter((file) => file.parent === root.path).length}</small>
                </button>
              )
            })}
            <button
              type="button"
              className={classNames('files-sidebar__item', trashOpen && 'is-active')}
              onClick={() => navigate('files', { trash: true })}
              title={
                trashCount
                  ? `${trashCount} item${trashCount === 1 ? '' : 's'} can still be put back`
                  : 'Nothing has been deleted'
              }
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>Trash</span>
              <small>{trashCount}</small>
            </button>
          </nav>

          {spaces.length > 0 ? (
            <>
              <p className="files-sidebar__label">Shares</p>
              <nav className="files-sidebar__nav" aria-label="Network shares">
                {spaces.map((space) => {
                  const state = shareState(space)
                  const active =
                    currentPath === space.path || currentPath.startsWith(`${space.path}/`)
                  return (
                    <button
                      key={space.id}
                      type="button"
                      className={classNames('files-sidebar__item', active && 'is-active')}
                      // The dot is the answer to "is anything actually on this share",
                      // so it carries the machine name as its title either way.
                      title={
                        state.live
                          ? `${space.name} — ${state.machine} connected`
                          : space.lastClient
                            ? `${space.name} — last from ${state.machine || 'a client'} ${state.label}`
                            : `${space.name} — no machine has opened this share yet`
                      }
                      onClick={() => navigate('files', { path: space.path })}
                    >
                      <span
                        className={classNames('share-dot', state.live && 'share-dot--live')}
                        aria-hidden="true"
                      />
                      <span>{space.name}</span>
                      <small className={classNames(state.live && 'is-live')}>
                        {state.live ? 'live' : state.label === 'Never' ? 'idle' : state.label}
                      </small>
                    </button>
                  )
                })}
              </nav>
            </>
          ) : null}

          <div className="files-sidebar__storage">
            <div className="files-sidebar__storage-head">
              <span>Storage</span>
              <strong className="tabular">{usedPercent}%</strong>
            </div>
            <ProgressBar value={usedPercent} label="Pool storage used" />
            <p className="tabular">
              {formatBytes(totalUsed)} of {formatBytes(totalCapacity)}
            </p>
            <button type="button" className="text-button" onClick={() => navigate('storage')}>
              Manage pools
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </div>

          <div className="files-sidebar__tip">
            <Users size={14} aria-hidden="true" />
            <p>
              <strong>Shared with you</strong>
              Files in Shared respect per-user permissions.
            </p>
          </div>
        </aside>

        <div className="files-main">
          <div className="files-toolbar">
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <span>
                <button type="button" onClick={() => navigate('files', { path: '/' })}>
                  <HardDrive size={12} aria-hidden="true" />
                  Orion
                </button>
              </span>
              {trashOpen ? (
                <span>
                  <ChevronRight size={12} aria-hidden="true" />
                  <button type="button" aria-current="page">
                    Trash
                  </button>
                </span>
              ) : (
                breadcrumbs.slice(1).map((crumb, index) => (
                  <span key={crumb.path}>
                    <ChevronRight size={12} aria-hidden="true" />
                    <button
                      type="button"
                      aria-current={index === breadcrumbs.length - 2 ? 'page' : undefined}
                      onClick={() => navigate('files', { path: crumb.path })}
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))
              )}
            </nav>

            <div className="files-toolbar__actions">
              {trashOpen ? (
                <>
                  <span className="files-trash__summary">
                    {trashItems.length} {trashItems.length === 1 ? 'item' : 'items'} ·{' '}
                    {formatBytes(trashBytes)}
                  </span>
                  <button
                    type="button"
                    className="button button--sm button--danger"
                    disabled={trashBusy || trashItems.length === 0}
                    onClick={() => setEmptyTrashOpen(true)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Empty trash
                  </button>
                </>
              ) : (
                <>
              <label className="files-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search this folder"
                  aria-label="Search this folder"
                />
                {query ? (
                  <button
                    type="button"
                    className="files-search__clear"
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </label>

              <label className="files-sort">
                <span className="sr-only">Sort files</span>
                <select
                  className="select"
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as SortKey)}
                >
                  <option value="name">Name</option>
                  <option value="modified">Modified</option>
                  <option value="size">Size</option>
                </select>
                <button
                  type="button"
                  className="icon-button icon-button--sm"
                  aria-label={`Sort ${sortAsc ? 'descending' : 'ascending'}`}
                  onClick={() => setSortAsc((value) => !value)}
                >
                  {sortAsc ? (
                    <ChevronUp size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                </button>
              </label>

              <div className="segmented segmented--compact view-toggle" role="group" aria-label="View">
                <button
                  type="button"
                  className={classNames('segmented__item', view === 'list' && 'is-selected')}
                  aria-pressed={view === 'list'}
                  onClick={() => setView('list')}
                >
                  <List size={14} aria-hidden="true" />
                  <span className="view-toggle__label">List</span>
                </button>
                <button
                  type="button"
                  className={classNames('segmented__item', view === 'grid' && 'is-selected')}
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                >
                  <LayoutGrid size={14} aria-hidden="true" />
                  <span className="view-toggle__label">Grid</span>
                </button>
              </div>

              <button
                type="button"
                className="icon-button files-details-toggle"
                aria-label="Toggle details panel"
                aria-pressed={showDetails}
                onClick={() => setShowDetails((value) => !value)}
              >
                <PanelRight size={16} aria-hidden="true" />
              </button>
                </>
              )}
            </div>
          </div>

          {!trashOpen && selectedNodes.length > 0 ? (
            <div className="files-bulk" role="status">
              <span className="files-bulk__count">
                {selectedNodes.length} selected
                {selectedNodes.length === 1 ? ` · ${selectedNodes[0].name}` : ''}
              </span>
              <div className="files-bulk__actions">
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() =>
                    copyPath(
                      selectedNodes
                        .map((node) => joinPath(node.parent, node.name))
                        .join('\n'),
                    )
                  }
                >
                  <Copy size={13} aria-hidden="true" />
                  Copy path
                </button>
                <button
                  type="button"
                  className="button button--sm button--danger"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  Delete
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--sm"
                  aria-label="Clear selection"
                  onClick={() => setSelectedIds(new Set())}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}

          <div className="files-content">
            {trashOpen ? (
              trashItems.length === 0 ? (
                <EmptyState
                  icon={Trash2}
                  title="Trash is empty"
                  description="Anything you delete waits here until the trash is emptied, so a mistake can be put back."
                  action={
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => navigate('files', { path: '/' })}
                    >
                      Back to files
                    </button>
                  }
                />
              ) : (
                <div className="files-trash">
                  <p className="files-trash__hint">
                    Restore puts an item back in the folder it came from. Empty trash deletes it
                    from the disk for good.
                  </p>
                  <ul className="trash-list">
                    {trashItems.map((item) => (
                      <li key={item.name} className="trash-row">
                        <span className="trash-row__glyph" aria-hidden="true">
                          <Trash2 size={16} />
                        </span>
                        <div className="trash-row__copy">
                          <strong>{item.name}</strong>
                          <span>
                            {item.original
                              ? `from ${item.original}`
                              : 'the folder it came from was not recorded'}
                            {' · deleted '}
                            {relativeTime(item.deletedAt)}
                            {' · '}
                            {formatBytes(item.size)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="button button--sm button--ghost"
                          disabled={trashBusy}
                          onClick={() => void submitRestore(item.name)}
                        >
                          <Undo2 size={13} aria-hidden="true" />
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : entries.length === 0 ? (
              <EmptyState
                icon={query ? Search : FolderOpen}
                title={query ? 'No files match that search' : 'This folder is empty'}
                description={
                  query
                    ? `Nothing in ${currentPath} matches “${query}”. Try a different name.`
                    : 'Drop files here or create a folder to get started.'
                }
                action={
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => {
                      if (query) setQuery('')
                      else setNewFolderOpen(true)
                    }}
                  >
                    {query ? 'Clear search' : 'New folder'}
                  </button>
                }
              />
            ) : view === 'list' ? (
              <div className="file-table-wrap">
                <table className="file-table">
                  <thead>
                    <tr>
                      <th className="file-table__check">
                        <input
                          type="checkbox"
                          aria-label="Select all files in this folder"
                          checked={allSelected}
                          ref={(input) => {
                            if (input) input.indeterminate = someSelected && !allSelected
                          }}
                          onChange={() => {
                            if (allSelected) setSelectedIds(new Set())
                            else setSelectedIds(new Set(entries.map((entry) => entry.id)))
                          }}
                        />
                      </th>
                      <th>Name</th>
                      <th className="file-table__size">Size</th>
                      <th className="file-table__modified">Modified</th>
                      <th className="file-table__owner">Owner</th>
                      <th className="file-table__actions">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((node) => {
                      const Icon = FILE_ICONS[node.tone]
                      const owner = userFor(node.owner)
                      const isSelected = selectedIds.has(node.id)
                      return (
                        <tr
                          key={node.id}
                          data-file-id={node.id}
                          tabIndex={-1}
                          className={classNames(
                            isSelected && 'is-selected',
                            node.id === highlightId && 'is-highlighted',
                          )}
                          onClick={() => selectOnly(node.id)}
                          onDoubleClick={() => openEntry(node)}
                        >
                          <td className="file-table__check">
                            <input
                              type="checkbox"
                              aria-label={`Select ${node.name}`}
                              checked={isSelected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleSelected(node.id)}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="file-name"
                              onClick={(event) => {
                                event.stopPropagation()
                                openEntry(node)
                              }}
                            >
                              <span className={`file-glyph file-glyph--${node.tone}`} aria-hidden="true">
                                <Icon size={16} />
                              </span>
                              <span className="file-name__text">
                                <strong>
                                  {node.name}
                                  {node.starred ? (
                                    <Star
                                      size={10}
                                      className="file-name__star"
                                      fill="currentColor"
                                      aria-label="Starred"
                                    />
                                  ) : null}
                                </strong>
                                <small className="file-name__mobile-meta">
                                  {node.type === 'folder' ? 'Folder' : formatBytes(node.size)} ·{' '}
                                  {relativeTime(node.modifiedAt)}
                                </small>
                              </span>
                            </button>
                          </td>
                          <td className="file-table__size tabular">
                            {node.type === 'folder' ? '—' : formatBytes(node.size)}
                          </td>
                          <td className="file-table__modified">
                            <time dateTime={node.modifiedAt}>
                              {formatFullDateTime(node.modifiedAt, settings.timeFormat)}
                            </time>
                          </td>
                          <td className="file-table__owner">
                            {owner ? (
                              <span className="file-owner">
                                <Avatar name={owner.name} color={owner.color} size="sm" />
                                {owner.name.split(' ')[0]}
                              </span>
                            ) : (
                              <span className="dim">System</span>
                            )}
                          </td>
                          <td className="file-table__actions">
                            <button
                              type="button"
                              className="icon-button icon-button--sm"
                              aria-label={`Show details for ${node.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                selectOnly(node.id)
                              }}
                            >
                              <PanelRight size={14} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="file-grid">
                {entries.map((node) => {
                  const Icon = FILE_ICONS[node.tone]
                  const owner = userFor(node.owner)
                  const isSelected = selectedIds.has(node.id)
                  return (
                    <div
                      key={node.id}
                      data-file-id={node.id}
                      className={classNames(
                        'file-card',
                        isSelected && 'is-selected',
                        node.id === highlightId && 'is-highlighted',
                      )}
                    >
                      <input
                        className="file-card__check"
                        type="checkbox"
                        aria-label={`Select ${node.name}`}
                        checked={isSelected}
                        onChange={() => toggleSelected(node.id)}
                      />
                      <button
                        type="button"
                        className="file-card__open"
                        onClick={() => (node.type === 'folder' ? openEntry(node) : selectOnly(node.id))}
                      >
                        <span className={`file-glyph file-glyph--${node.tone} file-glyph--large`} aria-hidden="true">
                          <Icon size={22} />
                        </span>
                        <strong>{node.name}</strong>
                        <span className="file-card__meta">
                          {node.type === 'folder'
                            ? `${files.filter((file) => file.parent === joinPath(node.parent, node.name)).length} items`
                            : formatBytes(node.size)}
                        </span>
                        <span className="file-card__owner">
                          {owner ? (
                            <>
                              <Avatar name={owner.name} color={owner.color} size="sm" />
                              {owner.name.split(' ')[0]}
                            </>
                          ) : (
                            'System'
                          )}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <footer className="files-footer">
            <span>
              {trashOpen
                ? `${trashItems.length} ${trashItems.length === 1 ? 'item' : 'items'} in Trash`
                : `${entries.length} ${entries.length === 1 ? 'item' : 'items'}${
                    query ? ` matching “${query}”` : ''
                  }`}
            </span>
            <span className="dim">
              {trashOpen
                ? trashItems.length
                  ? `${formatBytes(trashBytes)} can still be put back`
                  : 'Nothing to recover'
                : folderSize > 0
                  ? `${formatBytes(folderSize)} in this folder`
                  : 'Folders · files'}
            </span>
            <span className="files-footer__path">{trashOpen ? 'Trash' : currentPath}</span>
          </footer>
        </div>

        <aside
          className={classNames('files-details', showDetails && !trashOpen && 'is-open')}
          aria-label="File details"
        >
          <header className="files-details__head">
            <h2>{selectedNodes.length > 1 ? 'Selection' : 'Details'}</h2>
            <button
              type="button"
              className="icon-button icon-button--sm files-details__close"
              aria-label="Close details"
              onClick={() => setShowDetails(false)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>

          {selectedNodes.length === 0 ? (
            <div className="files-details__empty">
              <span className="files-details__orb" aria-hidden="true">
                <FolderOpen size={24} />
              </span>
              <strong>Nothing selected</strong>
              <p>Choose a file to see its metadata, owner and quick actions.</p>
              <div className="files-details__summary">
                <div>
                  <span>Items</span>
                  <strong>{entries.length}</strong>
                </div>
                <div>
                  <span>Folder size</span>
                  <strong>{folderSize > 0 ? formatBytes(folderSize) : '—'}</strong>
                </div>
              </div>
            </div>
          ) : selectedNodes.length > 1 ? (
            <div className="files-details__empty">
              <span className="files-details__orb" aria-hidden="true">
                <List size={24} />
              </span>
              <strong>{selectedNodes.length} items selected</strong>
              <p>
                {formatBytes(selectedNodes.reduce((total, node) => total + (node.size ?? 0), 0))} across
                this selection.
              </p>
              <div className="files-details__actions">
                <button
                  type="button"
                  className="button button--sm button--danger button--block"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  Delete selection
                </button>
              </div>
            </div>
          ) : activeNode ? (
            <div className="files-details__content">
              <div className="files-details__preview">
                {activeNode.type === 'file' && activeNode.tone === 'image' ? (
                  <img
                    className="files-details__thumb"
                    src={downloadUrl(activeNode.id, true)}
                    alt=""
                  />
                ) : (
                  (() => {
                    const Icon = FILE_ICONS[activeNode.tone]
                    return (
                      <span
                        className={`file-glyph file-glyph--${activeNode.tone} file-glyph--xl`}
                        aria-hidden="true"
                      >
                        <Icon size={30} />
                      </span>
                    )
                  })()
                )}
                <div>
                  <strong>{activeNode.name}</strong>
                  <span>{TYPE_LABELS[activeNode.tone]}</span>
                </div>
              </div>

              <dl className="files-details__meta">
                <div>
                  <dt>Size</dt>
                  <dd>{activeNode.type === 'folder' ? '—' : formatBytes(activeNode.size)}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd title={currentPath}>{currentPath}</dd>
                </div>
                <div>
                  <dt>Modified</dt>
                  <dd>{formatFullDateTime(activeNode.modifiedAt, settings.timeFormat)}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{userFor(activeNode.owner)?.name ?? 'System'}</dd>
                </div>
                <div>
                  <dt>Starred</dt>
                  <dd>{activeNode.starred ? 'Yes' : 'No'}</dd>
                </div>
              </dl>

              <div className="files-details__actions">
                {activeNode.type === 'folder' ? (
                  <button
                    type="button"
                    className="button button--sm button--block button--primary"
                    onClick={() => openEntry(activeNode)}
                  >
                    <FolderOpen size={13} aria-hidden="true" />
                    Open folder
                  </button>
                ) : (
                  <a
                    className="button button--sm button--block button--primary"
                    href={downloadUrl(activeNode.id)}
                    download={activeNode.name}
                  >
                    <Download size={13} aria-hidden="true" />
                    Download
                  </a>
                )}
                <div className="files-details__action-row">
                  <button
                    type="button"
                    className="button button--sm"
                    onClick={() => toggleStar(activeNode.id)}
                  >
                    <Star
                      size={13}
                      aria-hidden="true"
                      fill={activeNode.starred ? 'currentColor' : 'none'}
                    />
                    {activeNode.starred ? 'Unstar' : 'Star'}
                  </button>
                  <button
                    type="button"
                    className="button button--sm"
                    onClick={() => {
                      setRenameTarget(activeNode)
                      setRenameValue(activeNode.name)
                      setRenameError(null)
                    }}
                  >
                    <Pencil size={13} aria-hidden="true" />
                    Rename
                  </button>
                </div>
                <div className="files-details__action-row">
                  <button
                    type="button"
                    className="button button--sm"
                    onClick={() => copyPath(joinPath(activeNode.parent, activeNode.name))}
                  >
                    <Copy size={13} aria-hidden="true" />
                    Copy path
                  </button>
                  <button
                    type="button"
                    className="button button--sm button--danger"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </aside>

        {dragging ? (
          <div className="files-drop-overlay" aria-hidden="true">
            <span>
              <ArrowDownToLine size={26} />
            </span>
            <strong>Drop to upload</strong>
            <p>Files will be added to {currentPath}</p>
          </div>
        ) : null}
      </div>

      <Modal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        title="New folder"
        description={`Create a folder inside ${currentPath}.`}
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              form="new-folder-form"
              className="button button--primary"
              disabled={!newFolderName.trim()}
            >
              Create folder
            </button>
          </>
        }
      >
        <form
          id="new-folder-form"
          onSubmit={(event) => {
            event.preventDefault()
            void createFolder()
          }}
        >
          <div className="field">
            <label htmlFor="new-folder-name">Folder name</label>
            <input
              id="new-folder-name"
              className="input"
              data-autofocus
              value={newFolderName}
              onChange={(event) => {
                setNewFolderName(event.target.value)
                setNewFolderError(null)
              }}
              placeholder="e.g. Design assets"
              aria-invalid={Boolean(newFolderError)}
              aria-describedby={newFolderError ? 'new-folder-error' : undefined}
            />
            {newFolderError ? (
              <span className="field__error" id="new-folder-error" role="alert">
                {newFolderError}
              </span>
            ) : (
              <span className="field__hint">Names can use letters, numbers, dashes and spaces.</span>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename item"
        description={renameTarget ? `Currently named ${renameTarget.name}.` : undefined}
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setRenameTarget(null)}>
              Cancel
            </button>
            <button
              type="submit"
              form="rename-form"
              className="button button--primary"
              disabled={!renameValue.trim()}
            >
              Save name
            </button>
          </>
        }
      >
        <form
          id="rename-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitRename()
          }}
        >
          <div className="field">
            <label htmlFor="rename-value">New name</label>
            <input
              id="rename-value"
              className="input"
              data-autofocus
              value={renameValue}
              onChange={(event) => {
                setRenameValue(event.target.value)
                setRenameError(null)
              }}
              aria-invalid={Boolean(renameError)}
            />
            {renameError ? (
              <span className="field__error" role="alert">
                {renameError}
              </span>
            ) : null}
          </div>
        </form>
      </Modal>

      <Modal
        open={emptyTrashOpen}
        onClose={() => setEmptyTrashOpen(false)}
        title="Empty the trash?"
        description="Every item in Trash is deleted from the disk. Nothing else is touched."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setEmptyTrashOpen(false)}>
              Keep them
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={trashBusy}
              onClick={() => void confirmEmptyTrash()}
            >
              <Trash2 size={14} aria-hidden="true" />
              Delete for good
            </button>
          </>
        }
      >
        <div className="danger-note">
          <Trash2 size={17} aria-hidden="true" />
          <span>
            {trashItems.length} {trashItems.length === 1 ? 'item' : 'items'} ·{' '}
            {formatBytes(trashBytes)}
          </span>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${selectedNodes.length} ${selectedNodes.length === 1 ? 'item' : 'items'}?`}
        description="Folders include everything inside them. This moves the selection to Trash."
        size="sm"
        footer={
          <>
            <button type="button" className="button" onClick={() => setDeleteOpen(false)}>
              Keep files
            </button>
            <button type="button" className="button button--danger" onClick={confirmDelete}>
              <Trash2 size={14} aria-hidden="true" />
              Move to Trash
            </button>
          </>
        }
      >
        <div className="danger-note">
          <Trash2 size={17} aria-hidden="true" />
          <span>
            {selectedNodes
              .slice(0, 4)
              .map((node) => node.name)
              .join(', ')}
            {selectedNodes.length > 4 ? ` and ${selectedNodes.length - 4} more` : ''}
          </span>
        </div>
      </Modal>
    </section>
  )
}
