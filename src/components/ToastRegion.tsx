import { useEffect, useState } from 'react'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import type { Toast } from '../types'

const TOAST_ICONS = {
  success: CheckCircle2,
  error: TriangleAlert,
  info: Info,
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: string) => void }) {
  const [paused, setPaused] = useState(false)
  const Icon = TOAST_ICONS[toast.tone]

  useEffect(() => {
    if (paused) return
    const timer = window.setTimeout(() => onClose(toast.id), 5200)
    return () => window.clearTimeout(timer)
  }, [paused, toast.id, onClose])

  return (
    <div
      className={`toast toast--${toast.tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="toast__copy">
        <strong>{toast.title}</strong>
        {toast.description ? <span>{toast.description}</span> : null}
      </div>
      <button
        className="toast__close"
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label={`Dismiss ${toast.title}`}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}

export function ToastRegion() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={dismissToast} />
      ))}
    </div>
  )
}
