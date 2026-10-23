import { classNames } from '../../lib/format'

interface ProgressBarProps {
  value: number
  label: string
  tone?: 'accent' | 'success' | 'warning' | 'danger'
  className?: string
}

export function ProgressBar({ value, label, tone = 'accent', className }: ProgressBarProps) {
  const safe = Math.min(100, Math.max(0, value))
  return (
    <div
      className={classNames('progress', `progress--${tone}`, className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safe)}
    >
      <span className="progress__fill" style={{ width: `${safe}%` }} />
    </div>
  )
}
