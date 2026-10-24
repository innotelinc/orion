import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NavRail } from './components/NavRail'
import { TitleBar } from './components/TitleBar'
import { ToastRegion } from './components/ToastRegion'
import { useApp } from './context/AppContext'
import { useMediaQuery } from './hooks/usePersistentState'
import { useRoute, type RouteName } from './hooks/useRoute'
import { Dashboard } from './views/Dashboard'
import { Files } from './views/Files'
import { AppStore } from './views/AppStore'
import { Storage } from './views/Storage'
import { Settings } from './views/Settings'

const PAGE_TITLES: Record<RouteName, string> = {
  dashboard: 'Dashboard',
  files: 'Files',
  apps: 'Apps',
  storage: 'Storage',
  settings: 'Settings',
}

export default function App() {
  const { settings, updateSettings, error, refresh } = useApp()
  const { route, navigate } = useRoute()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolvedTheme =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.dataset.accent = settings.accent
    root.dataset.wallpaper = settings.wallpaper
    root.dataset.density = settings.density
    root.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false'
    root.style.colorScheme = resolvedTheme
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = resolvedTheme === 'dark' ? '#07080c' : '#eef1f7'
  }, [resolvedTheme, settings.accent, settings.wallpaper, settings.density, settings.reduceMotion])

  useEffect(() => {
    document.title = `${PAGE_TITLES[route.name] ?? 'Dashboard'} · Orion NAS`
  }, [route.name])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === '/') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const toggleTheme = useCallback(() => {
    updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })
  }, [resolvedTheme, updateSettings])

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="wallpaper" aria-hidden="true">
        <span className="wallpaper__beam wallpaper__beam--one" />
        <span className="wallpaper__beam wallpaper__beam--two" />
        <span className="wallpaper__beam wallpaper__beam--three" />
        <span className="wallpaper__grain" />
      </div>

      <TitleBar
        resolvedTheme={resolvedTheme}
        onToggleTheme={toggleTheme}
        onOpenPalette={() => setPaletteOpen(true)}
        navigate={navigate}
      />

      <div className="shell">
        <NavRail route={route.name} navigate={navigate} />
        <main id="main-content" className="main" tabIndex={-1}>
          {error ? (
            <div className="api-banner" role="alert">
              <span>
                <strong>The API is not answering.</strong> {error}
              </span>
              <button type="button" className="text-button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          ) : null}
          <ErrorBoundary key={`${route.name}-${route.path ?? 'root'}`}>
            {route.name === 'dashboard' ? (
              <Dashboard navigate={navigate} onOpenPalette={() => setPaletteOpen(true)} />
            ) : null}
            {route.name === 'files' ? (
              <Files
                navigate={navigate}
                initialPath={route.path}
                highlightId={route.highlight}
              />
            ) : null}
            {route.name === 'apps' ? <AppStore navigate={navigate} /> : null}
            {route.name === 'storage' ? <Storage /> : null}
            {route.name === 'settings' ? (
              <Settings
                activeTab={route.tab ?? 'general'}
                onTabChange={(tab) => navigate('settings', { tab })}
              />
            ) : null}
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navigate={navigate}
        resolvedTheme={resolvedTheme}
      />
      <ToastRegion />
    </div>
  )
}
