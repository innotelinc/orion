import type { CSSProperties } from 'react'
import { classNames, initials } from '../../lib/format'

interface AvatarProps {
  name: string
  color: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Avatar({ name, color, size = 'md', className }: AvatarProps) {
  return (
    <span
      className={classNames('avatar', `avatar--${size}`, className)}
      style={{ '--avatar-color': color } as CSSProperties}
      aria-hidden="true"
      title={name}
    >
      {initials(name)}
    </span>
  )
}
