import { useEffect, useState } from 'react'

export interface Telemetry {
  cpu: number
  ram: number
  temp: number
  cpuClock: number
  uptimeDays: number
  netDown: number
  netUp: number
  cpuHistory: number[]
  ramHistory: number[]
  netDownHistory: number[]
  netUpHistory: number[]
}

const HISTORY_LENGTH = 34

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function seedHistory(base: number, spread: number) {
  return Array.from({ length: HISTORY_LENGTH }, (_, index) => {
    const wave = Math.sin(index / 2.7) * spread + Math.sin(index / 1.3) * spread * 0.38
    return Math.round(clamp(base + wave + (Math.random() * spread - spread / 2), 1, 99))
  })
}

function seed(): Telemetry {
  return {
    cpu: 24,
    ram: 62,
    temp: 43,
    cpuClock: 3.4,
    uptimeDays: 47,
    netDown: 8.4,
    netUp: 1.2,
    cpuHistory: seedHistory(26, 13),
    ramHistory: seedHistory(61, 5),
    netDownHistory: seedHistory(38, 26),
    netUpHistory: seedHistory(12, 9),
  }
}

function next(previous: Telemetry): Telemetry {
  const cpu = Math.round(clamp(previous.cpu + (Math.random() * 16 - 8), 6, 74))
  const ram = Math.round(clamp(previous.ram + (Math.random() * 4 - 2), 48, 82))
  const netDown = Math.max(0.2, previous.netDown + (Math.random() * 26 - 13))
  const netUp = Math.max(0.1, previous.netUp + (Math.random() * 9 - 4.5))
  return {
    ...previous,
    cpu,
    ram,
    temp: Math.round(34 + cpu * 0.32),
    cpuClock: Math.round((3.1 + (cpu / 100) * 0.9) * 10) / 10,
    netDown: Math.round(netDown * 10) / 10,
    netUp: Math.round(netUp * 10) / 10,
    cpuHistory: [...previous.cpuHistory.slice(1), cpu],
    ramHistory: [...previous.ramHistory.slice(1), ram],
    netDownHistory: [
      ...previous.netDownHistory.slice(1),
      Math.round(clamp(netDown * 1.6, 2, 98)),
    ],
    netUpHistory: [...previous.netUpHistory.slice(1), Math.round(clamp(netUp * 3, 1, 92))],
  }
}

export function useTelemetry() {
  const [telemetry, setTelemetry] = useState<Telemetry>(seed)

  useEffect(() => {
    const interval = window.setInterval(() => {
      // Pause updates in background tabs: no wasted work, no jumpy charts on return.
      if (document.visibilityState === 'hidden') return
      setTelemetry((previous) => next(previous))
    }, 2200)
    return () => window.clearInterval(interval)
  }, [])

  return telemetry
}
