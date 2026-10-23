import type { CSSProperties } from 'react'
import { iconFor } from '../../lib/icons'
import { classNames } from '../../lib/format'

interface AppIconProps {
  icon: string
  accent: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function AppIcon({ icon, accent, size = 'md', className }: AppIconProps) {
  const Icon = iconFor(icon)
  return (
    <span
      className={classNames('app-icon', `app-icon--${size}`, className)}
      style={{ '--app-accent': accent } as CSSProperties}
      aria-hidden="true"
    >
      <Icon strokeWidth={1.7} />
    </span>
  )
}
