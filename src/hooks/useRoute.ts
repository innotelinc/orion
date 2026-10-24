import { useCallback, useEffect, useState } from 'react'
import type { RouteName, SettingsTab } from '../types'

export type { RouteName } from '../types'

const ROUTE_NAMES: RouteName[] = ['dashboard', 'files', 'apps', 'storage', 'settings']
const SETTINGS_TABS: SettingsTab[] = [
  'general',
  'appearance',
  'network',
  'users',
  'security',
  'about',
]

export interface RouteState {
  name: RouteName
  path?: string
  tab?: SettingsTab
  highlight?: string
  /** Files opens on its Trash pane instead of a folder. */
  trash?: boolean
}

export interface NavigateOptions {
  path?: string
  tab?: SettingsTab
  highlight?: string
  trash?: boolean
  replace?: boolean
}

function parseHash(hash: string): RouteState {
  const raw = hash.replace(/^#\/?/, '')
  const [rawName = '', rawQuery = ''] = raw.split('?')
  const name = ROUTE_NAMES.includes(rawName as RouteName)
    ? (rawName as RouteName)
    : 'dashboard'
  const params = new URLSearchParams(rawQuery)
  const tabParam = params.get('tab')
  const tab = SETTINGS_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : undefined
  return {
    name,
    path: params.get('path') ?? undefined,
    tab,
    highlight: params.get('highlight') ?? undefined,
    trash: params.get('trash') === '1' ? true : undefined,
  }
}

export function buildHash(name: RouteName, options: NavigateOptions = {}) {
  const params = new URLSearchParams()
  if (options.path) params.set('path', options.path)
  if (options.tab) params.set('tab', options.tab)
  if (options.highlight) params.set('highlight', options.highlight)
  if (options.trash) params.set('trash', '1')
  const query = params.toString()
  return `#/${name}${query ? `?${query}` : ''}`
}

export function useRoute() {
  const [route, setRoute] = useState<RouteState>(() => parseHash(window.location.hash))

  useEffect(() => {
    // Normalise the initial URL so reloads and deep links behave consistently.
    if (!window.location.hash) {
      window.history.replaceState(null, '', buildHash('dashboard'))
    }
    const handleHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  const navigate = useCallback((name: RouteName, options: NavigateOptions = {}) => {
    const nextHash = buildHash(name, options)
    if (window.location.hash === nextHash) {
      setRoute(parseHash(nextHash))
      return
    }
    if (options.replace) {
      window.history.replaceState(null, '', nextHash)
      setRoute(parseHash(nextHash))
    } else {
      window.location.hash = nextHash
    }
  }, [])

  return { route, navigate }
}
