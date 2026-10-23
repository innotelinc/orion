import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div className="page-head__copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-head__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  )
}
