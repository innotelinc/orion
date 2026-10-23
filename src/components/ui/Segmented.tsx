import type { LucideIcon } from 'lucide-react'
import { classNames } from '../../lib/format'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

interface SegmentedProps<T extends string> {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  label: string
  compact?: boolean
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  compact,
}: SegmentedProps<T>) {
  return (
    <div className={classNames('segmented', compact && 'segmented--compact')} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const Icon = option.icon
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={classNames('segmented__item', selected && 'is-selected')}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size={15} aria-hidden="true" /> : null}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
