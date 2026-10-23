import {
  CircleHelp,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Settings,
  Store,
  type LucideIcon,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { classNames } from '../lib/format'
import type { NavigateOptions, RouteName } from '../hooks/useRoute'

const NAV_ITEMS: Array<{
  name: RouteName
  label: string
  icon: LucideIcon
}> = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { name: 'files', label: 'Files', icon: FolderOpen },
  { name: 'apps', label: 'App Store', icon: Store },
  { name: 'storage', label: 'Storage', icon: HardDrive },
  { name: 'settings', label: 'Settings', icon: Settings },
]

interface NavRailProps {
  route: RouteName
  navigate: (name: RouteName, options?: NavigateOptions) => void
}

export function NavRail({ route, navigate }: NavRailProps) {
  const { pushToast } = useApp()

  return (
    <nav className="rail" aria-label="Primary navigation">
      <div className="rail__group">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = route === item.name
          return (
            <button
              key={item.name}
              type="button"
              className={classNames('rail__item', active && 'is-active')}
              onClick={() => navigate(item.name)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="rail__tip" role="tooltip">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="rail__bottom">
        <button
          type="button"
          className="rail__item"
          aria-label="Help and documentation"
          onClick={() =>
            pushToast({
              title: 'Help is on the way',
              description: 'Docs would open at orion.local/help in the full build.',
              tone: 'info',
            })
          }
        >
          <CircleHelp size={20} aria-hidden="true" />
          <span className="rail__tip" role="tooltip">
            Help
          </span>
        </button>
        <span className="rail__version" aria-hidden="true">
          1.4
        </span>
      </div>
    </nav>
  )
}
