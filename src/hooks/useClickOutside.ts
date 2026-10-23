import { useEffect, type RefObject } from 'react'

export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!ref.current?.contains(target)) handler()
    }
    document.addEventListener('pointerdown', handlePointer)
    return () => document.removeEventListener('pointerdown', handlePointer)
  }, [ref, handler, enabled])
}
