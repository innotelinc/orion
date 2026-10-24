import { useEffect, useState } from 'react'
import { loadSystem, type LiveSystem } from '../lib/live'

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
  /** Present only while reading a real host. */
  hostname?: string
  platform?: string
  cpuModel?: string
  cores?: number
  load?: number
  ramUsedGb?: number
  ramTotalGb?: number
  isLive?: boolean
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

/** Fold one real sample from the host into the running series. */
function fromLive(previous: Telemetry, sample: LiveSystem): Telemetry {
  return {
    ...previous,
    cpu: sample.cpu.usage,
    ram: sample.memory.percent,
    temp: sample.temperature ?? 0,
    cpuClock: sample.cpu.clockGhz,
    uptimeDays: sample.uptimeDays,
    netDown: sample.network.down,
    netUp: sample.network.up,
    hostname: sample.hostname,
    platform: sample.platform,
    cpuModel: sample.cpu.model.trim(),
    cores: sample.cpu.cores,
    load: sample.cpu.load,
    ramUsedGb: sample.memory.usedGb,
    ramTotalGb: sample.memory.totalGb,
    isLive: true,
    cpuHistory: [...previous.cpuHistory.slice(1), sample.cpu.usage],
    ramHistory: [...previous.ramHistory.slice(1), sample.memory.percent],
    netDownHistory: [
      ...previous.netDownHistory.slice(1),
      Math.round(clamp(sample.network.down * 1.6, 2, 98)),
    ],
    netUpHistory: [
      ...previous.netUpHistory.slice(1),
      Math.round(clamp(sample.network.up * 3, 1, 92)),
    ],
  }
}

/**
 * Dashboard metrics.
 *
 * With a live host the numbers are the host's, sampled from /api/system; with no
 * backend (GitHub Pages, the demo build) they are the seeded series, animated as
 * before. Passing `null` keeps the demo behaviour exactly as it was.
 */
export function useTelemetry(live: LiveSystem | null = null) {
  const [telemetry, setTelemetry] = useState<Telemetry>(seed)

  useEffect(() => {
    if (live) setTelemetry((previous) => fromLive(previous, live))
  }, [live])

  useEffect(() => {
    if (live) {
      const interval = window.setInterval(async () => {
        if (document.visibilityState === 'hidden') return
        const sample = await loadSystem()
        if (sample) setTelemetry((previous) => fromLive(previous, sample))
      }, 4000)
      return () => window.clearInterval(interval)
    }

    const interval = window.setInterval(() => {
      // Pause updates in background tabs: no wasted work, no jumpy charts on return.
      if (document.visibilityState === 'hidden') return
      setTelemetry((previous) => next(previous))
    }, 2200)
    return () => window.clearInterval(interval)
  }, [live])

  return telemetry
}
