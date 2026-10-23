import { classNames } from '../../lib/format'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? 'Toggle'}
      disabled={disabled}
      className={classNames('switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  )

  if (!label) return control

  return (
    <div className="switch-row">
      <div className="switch-row__copy">
        <span className="switch-row__label">{label}</span>
        {description ? <span className="switch-row__description">{description}</span> : null}
      </div>
      {control}
    </div>
  )
}
