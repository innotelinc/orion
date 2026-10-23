import { useEffect, useRef, useState } from 'react'

function read<T>(key: string, fallback: T, revive?: (value: unknown) => T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return revive ? revive(parsed) : (parsed as T)
  } catch {
    return fallback
  }
}

export function usePersistentState<T>(
  key: string,
  initial: T,
  revive?: (value: unknown) => T,
) {
  const reviveRef = useRef(revive)
  reviveRef.current = revive

  const [value, setValue] = useState<T>(() => read(key, initial, revive))

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Storage can be unavailable (private mode, quota). The app keeps working in memory.
    }
  }, [key, value])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key || !event.newValue) return
      try {
        const parsed: unknown = JSON.parse(event.newValue)
        setValue(reviveRef.current ? reviveRef.current(parsed) : (parsed as T))
      } catch {
        // Ignore malformed writes from another tab.
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [key])

  return [value, setValue] as const
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}
