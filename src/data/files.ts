import type { FileNode, FileTone } from '../types'

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

type Seed = {
  name: string
  parent: string
  type: 'folder' | 'file'
  size?: number
  modifiedAt: string
  owner?: string
  tone?: FileTone
  starred?: boolean
}

const seeds: Seed[] = [
  // Root
  { name: 'Photos', parent: '/', type: 'folder', modifiedAt: '2026-10-23T14:12:00.000Z',  owner: 'u-alex' },
  { name: 'Media', parent: '/', type: 'folder', modifiedAt: '2026-10-22T20:44:00.000Z',  owner: 'u-alex' },
  { name: 'Documents', parent: '/', type: 'folder', modifiedAt: '2026-10-21T09:16:00.000Z',  owner: 'u-alex' },
  { name: 'Projects', parent: '/', type: 'folder', modifiedAt: '2026-10-23T16:05:00.000Z', owner: 'u-sam' },
  { name: 'Backups', parent: '/', type: 'folder', modifiedAt: '2026-10-23T03:00:00.000Z', owner: 'system' },
  { name: 'Downloads', parent: '/', type: 'folder', modifiedAt: '2026-10-22T18:30:00.000Z',  owner: 'u-alex' },
  { name: 'Shared', parent: '/', type: 'folder', modifiedAt: '2026-10-20T11:47:00.000Z', owner: 'u-priya', starred: true },

  // Photos
  { name: 'Camera Roll', parent: '/Photos', type: 'folder', modifiedAt: '2026-10-23T14:12:00.000Z' },
  { name: 'Screenshots', parent: '/Photos', type: 'folder', modifiedAt: '2026-10-19T10:20:00.000Z' },
  { name: '2026', parent: '/Photos', type: 'folder', modifiedAt: '2026-10-18T19:05:00.000Z', starred: true },
  { name: 'Family Album', parent: '/Photos', type: 'folder', modifiedAt: '2026-09-01T08:00:00.000Z' },
  { name: 'cover-lake.jpg', parent: '/Photos', type: 'file', size: 8.4 * MB, modifiedAt: '2026-10-17T17:32:00.000Z', tone: 'image' },
  { name: 'IMG_4821.HEIC', parent: '/Photos/Camera Roll', type: 'file', size: 4.2 * MB, modifiedAt: '2026-10-23T14:12:00.000Z', tone: 'image' },
  { name: 'IMG_4820.HEIC', parent: '/Photos/Camera Roll', type: 'file', size: 4.8 * MB, modifiedAt: '2026-10-23T14:09:00.000Z', tone: 'image' },
  { name: 'IMG_4819.JPG', parent: '/Photos/Camera Roll', type: 'file', size: 6.1 * MB, modifiedAt: '2026-10-23T13:58:00.000Z', tone: 'image' },
  { name: 'IMG_4817.HEIC', parent: '/Photos/Camera Roll', type: 'file', size: 3.9 * MB, modifiedAt: '2026-10-23T13:51:00.000Z', tone: 'image' },
  { name: 'dashboard-export.png', parent: '/Photos/Screenshots', type: 'file', size: 2.8 * MB, modifiedAt: '2026-10-19T10:20:00.000Z', tone: 'image' },
  { name: 'receipt-october.png', parent: '/Photos/Screenshots', type: 'file', size: 860 * KB, modifiedAt: '2026-10-16T12:11:00.000Z', tone: 'image' },
  { name: '2026-10-12-aurora.jpg', parent: '/Photos/2026', type: 'file', size: 12.4 * MB, modifiedAt: '2026-10-12T22:46:00.000Z', tone: 'image', starred: true },
  { name: '2026-09-21-coast.jpg', parent: '/Photos/2026', type: 'file', size: 10.1 * MB, modifiedAt: '2026-09-21T18:03:00.000Z', tone: 'image' },
  { name: '2026-08-02-hike.jpg', parent: '/Photos/2026', type: 'file', size: 9.7 * MB, modifiedAt: '2026-08-02T09:12:00.000Z', tone: 'image' },
  { name: 'scanned-1998-001.jpg', parent: '/Photos/Family Album', type: 'file', size: 5.2 * MB, modifiedAt: '2026-09-01T08:00:00.000Z', tone: 'image' },
  { name: 'scanned-1998-002.jpg', parent: '/Photos/Family Album', type: 'file', size: 4.7 * MB, modifiedAt: '2026-09-01T08:00:00.000Z', tone: 'image' },

  // Media
  { name: 'Movies', parent: '/Media', type: 'folder', modifiedAt: '2026-10-22T20:44:00.000Z' },
  { name: 'TV Shows', parent: '/Media', type: 'folder', modifiedAt: '2026-10-18T21:10:00.000Z' },
  { name: 'Music', parent: '/Media', type: 'folder', modifiedAt: '2026-10-10T19:22:00.000Z' },
  { name: 'Audiobooks', parent: '/Media', type: 'folder', modifiedAt: '2026-10-05T07:30:00.000Z' },
  { name: 'Dune Part Two (2024).mkv', parent: '/Media/Movies', type: 'file', size: 42.1 * GB, modifiedAt: '2026-10-22T20:44:00.000Z', tone: 'video' },
  { name: 'Everything Everywhere All at Once.mkv', parent: '/Media/Movies', type: 'file', size: 18.4 * GB, modifiedAt: '2026-10-20T21:03:00.000Z', tone: 'video' },
  { name: 'The Wild Robot.mkv', parent: '/Media/Movies', type: 'file', size: 12.7 * GB, modifiedAt: '2026-10-18T19:12:00.000Z', tone: 'video' },
  { name: 'Severance S02E01.mkv', parent: '/Media/TV Shows', type: 'file', size: 3.2 * GB, modifiedAt: '2026-10-18T21:10:00.000Z', tone: 'video' },
  { name: 'Shogun S01E03.mkv', parent: '/Media/TV Shows', type: 'file', size: 2.8 * GB, modifiedAt: '2026-10-12T22:00:00.000Z', tone: 'video' },
  { name: 'Midnight City.flac', parent: '/Media/Music', type: 'file', size: 48 * MB, modifiedAt: '2026-10-10T19:22:00.000Z', tone: 'audio' },
  { name: 'Random Access Memories.flac', parent: '/Media/Music', type: 'file', size: 512 * MB, modifiedAt: '2026-10-09T18:04:00.000Z', tone: 'audio' },
  { name: 'Project Hail Mary.m4b', parent: '/Media/Audiobooks', type: 'file', size: 1.4 * GB, modifiedAt: '2026-10-05T07:30:00.000Z', tone: 'audio' },

  // Documents
  { name: 'House Insurance.pdf', parent: '/Documents', type: 'file', size: 2.1 * MB, modifiedAt: '2026-10-21T09:16:00.000Z', tone: 'document' },
  { name: '2026 Tax Return.pdf', parent: '/Documents', type: 'file', size: 4.8 * MB, modifiedAt: '2026-10-11T15:40:00.000Z', tone: 'document' },
  { name: 'Orion Manual.md', parent: '/Documents', type: 'file', size: 84 * KB, modifiedAt: '2026-10-02T10:00:00.000Z', tone: 'code' },
  { name: 'Recipes', parent: '/Documents', type: 'folder', modifiedAt: '2026-09-28T17:15:00.000Z' },
  { name: 'Contracts', parent: '/Documents', type: 'folder', modifiedAt: '2026-09-14T11:00:00.000Z' },
  { name: 'Sourdough.md', parent: '/Documents/Recipes', type: 'file', size: 32 * KB, modifiedAt: '2026-09-28T17:15:00.000Z', tone: 'document' },
  { name: 'Miso Ramen.md', parent: '/Documents/Recipes', type: 'file', size: 28 * KB, modifiedAt: '2026-09-20T12:34:00.000Z', tone: 'document' },
  { name: 'Studio Lease.pdf', parent: '/Documents/Contracts', type: 'file', size: 1.2 * MB, modifiedAt: '2026-09-14T11:00:00.000Z', tone: 'document' },

  // Projects
  { name: 'Orion UI', parent: '/Projects', type: 'folder', modifiedAt: '2026-10-23T16:05:00.000Z', starred: true },
  { name: 'Home Lab Notes.md', parent: '/Projects', type: 'file', size: 220 * KB, modifiedAt: '2026-10-22T08:12:00.000Z', tone: 'code' },
  { name: 'design-tokens.json', parent: '/Projects', type: 'file', size: 64 * KB, modifiedAt: '2026-10-21T18:50:00.000Z', tone: 'code' },
  { name: 'README.md', parent: '/Projects/Orion UI', type: 'file', size: 18 * KB, modifiedAt: '2026-10-23T16:05:00.000Z', tone: 'code' },
  { name: 'wireframes.fig', parent: '/Projects/Orion UI', type: 'file', size: 28.4 * MB, modifiedAt: '2026-10-22T11:30:00.000Z', tone: 'file' },
  { name: 'screenshots', parent: '/Projects/Orion UI', type: 'folder', modifiedAt: '2026-10-22T15:44:00.000Z' },
  { name: 'dashboard-dark.png', parent: '/Projects/Orion UI/screenshots', type: 'file', size: 2.3 * MB, modifiedAt: '2026-10-22T15:44:00.000Z', tone: 'image' },

  // Backups
  { name: 'Nightly', parent: '/Backups', type: 'folder', modifiedAt: '2026-10-23T03:00:00.000Z' },
  { name: 'Snapshots', parent: '/Backups', type: 'folder', modifiedAt: '2026-10-22T03:00:00.000Z' },
  { name: 'backup-log.txt', parent: '/Backups', type: 'file', size: 1.8 * MB, modifiedAt: '2026-10-23T03:01:00.000Z', tone: 'document' },
  { name: '2026-10-23.tar.zst', parent: '/Backups/Nightly', type: 'file', size: 82.4 * GB, modifiedAt: '2026-10-23T03:00:00.000Z', tone: 'archive' },
  { name: '2026-10-22.tar.zst', parent: '/Backups/Nightly', type: 'file', size: 81.9 * GB, modifiedAt: '2026-10-22T03:00:00.000Z', tone: 'archive' },
  { name: '2026-10-21.tar.zst', parent: '/Backups/Nightly', type: 'file', size: 81.2 * GB, modifiedAt: '2026-10-21T03:00:00.000Z', tone: 'archive' },
  { name: 'main-pool-0042.snap', parent: '/Backups/Snapshots', type: 'file', size: 2.4 * GB, modifiedAt: '2026-10-22T03:00:00.000Z', tone: 'archive' },
  { name: 'main-pool-0041.snap', parent: '/Backups/Snapshots', type: 'file', size: 2.3 * GB, modifiedAt: '2026-10-15T03:00:00.000Z', tone: 'archive' },

  // Downloads
  { name: 'ubuntu-26.04-live-server.iso', parent: '/Downloads', type: 'file', size: 5.8 * GB, modifiedAt: '2026-10-22T18:30:00.000Z', tone: 'archive' },
  { name: 'Orion-1.4.0.pkg', parent: '/Downloads', type: 'file', size: 184 * MB, modifiedAt: '2026-10-19T20:12:00.000Z', tone: 'file' },
  { name: 'invoice-october.pdf', parent: '/Downloads', type: 'file', size: 340 * KB, modifiedAt: '2026-10-16T09:05:00.000Z', tone: 'document' },

  // Shared
  { name: 'Team Share', parent: '/Shared', type: 'folder', modifiedAt: '2026-10-20T11:47:00.000Z' },
  { name: 'Public', parent: '/Shared', type: 'folder', modifiedAt: '2026-10-15T14:20:00.000Z' },
  { name: 'Guest Drop', parent: '/Shared', type: 'folder', modifiedAt: '2026-10-08T16:00:00.000Z' },
  { name: 'Q4 Roadmap.xlsx', parent: '/Shared/Team Share', type: 'file', size: 1.7 * MB, modifiedAt: '2026-10-20T11:47:00.000Z', tone: 'sheet' },
  { name: 'Brand Kit.zip', parent: '/Shared/Team Share', type: 'file', size: 248 * MB, modifiedAt: '2026-10-18T10:00:00.000Z', tone: 'archive' },
  { name: 'welcome.txt', parent: '/Shared/Public', type: 'file', size: 4 * KB, modifiedAt: '2026-10-15T14:20:00.000Z', tone: 'document' },
]

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export const INITIAL_FILES: FileNode[] = seeds.map((seed, index) => ({
  id: `seed-${index}-${slug(seed.parent)}-${slug(seed.name)}`,
  name: seed.name,
  parent: seed.parent,
  type: seed.type,
  size: seed.type === 'folder' ? null : (seed.size ?? 0),
  modifiedAt: seed.modifiedAt,
  owner: seed.owner ?? 'u-alex',
  starred: seed.starred,
  tone: seed.type === 'folder' ? 'folder' : (seed.tone ?? 'file'),
}))

export const FILE_ROOTS = [
  { label: 'Photos', path: '/Photos', icon: 'Images' },
  { label: 'Media', path: '/Media', icon: 'PlayCircle' },
  { label: 'Documents', path: '/Documents', icon: 'FileText' },
  { label: 'Projects', path: '/Projects', icon: 'FolderOpen' },
  { label: 'Backups', path: '/Backups', icon: 'ArchiveRestore' },
  { label: 'Downloads', path: '/Downloads', icon: 'ArrowDownToLine' },
  { label: 'Shared', path: '/Shared', icon: 'Users' },
]

export function joinPath(parent: string, name: string) {
  return parent === '/' ? `/${name}` : `${parent}/${name}`
}
