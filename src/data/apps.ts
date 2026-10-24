import type { AppDefinition } from '../types'

/**
 * The desktop's own pages. Everything else the machine runs is a systemd
 * service, read live from the API — there is no catalogue of installable
 * software here because nothing on this host can install one.
 */
export const BUILTIN_APPS: AppDefinition[] = [
  {
    id: 'files',
    name: 'Files',
    tagline: 'The storage volume',
    description: 'Browse, upload and organise everything in /srv/storage.',
    icon: 'FolderOpen',
    accent: '#3b82f6',
    internalRoute: 'files',
  },
  {
    id: 'storage',
    name: 'Storage',
    tagline: 'Volumes and devices',
    description: 'Capacity, filesystems and the host devices they sit on.',
    icon: 'Boxes',
    accent: '#10b981',
    internalRoute: 'storage',
  },
  {
    id: 'apps',
    name: 'App Store',
    tagline: 'Apps and units',
    description: 'Install services, see what runs, restart units.',
    icon: 'Store',
    accent: '#0a63ff',
    internalRoute: 'apps',
  },
  {
    id: 'settings',
    name: 'Settings',
    tagline: 'This machine',
    description: 'Appearance, network facts, accounts and the build.',
    icon: 'Settings',
    accent: '#8b5cf6',
    internalRoute: 'settings',
  },
]

export const BUILTIN_BY_ID = new Map(BUILTIN_APPS.map((app) => [app.id, app]))
