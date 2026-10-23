import type { ReactNode } from 'react'
import { classNames } from '../../lib/format'

interface StatusBadgeProps {
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  children: ReactNode
  dot?: boolean
  className?: string
}

export function StatusBadge({ tone = 'neutral', children, dot = true, className }: StatusBadgeProps) {
  return (
    <span className={classNames('status-badge', `status-badge--${tone}`, className)}>
      {dot ? <span className="status-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
