import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div className={compact ? 'empty-state empty-state--compact' : 'empty-state'}>
      <span className="empty-state__icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}
