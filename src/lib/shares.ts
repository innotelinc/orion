import { relativeTime } from './format'
import type { Space } from '../types'

/**
 * What a share's connection looks like in one line.
 *
 * The API reports the machines Samba has open right now and the last one it
 * ever saw, so "connected", "used an hour ago" and "never mounted" are three
 * different answers and the first one is the only one that proves a path and a
 * password work. Keep the wording here so Files, the dashboard and Settings
 * cannot drift apart.
 */
export interface ShareState {
  live: boolean
  /** Short, for a badge: `Live`, `2 hr ago`, `Never`. */
  label: string
  /** The machine to name, when there is one. */
  machine: string
}

export interface ShareMachine {
  address: string
  /** The name to show: an admin's label, a resolved name, or the address. */
  machine: string
  /** The admin's own name for it, empty when it goes by what it is called. */
  label: string
  /** True while Samba reports a session; false for the remembered one. */
  live: boolean
  since: string
}

/**
 * Every machine on a share, live first.
 *
 * A live session and the remembered one are usually the same machine, so they
 * are merged by address: the dialog lists each machine once, and an admin naming
 * it names both halves at the same time.
 */
export function shareMachines(space: Space): ShareMachine[] {
  const machines: ShareMachine[] = []
  const seen = new Set<string>()
  for (const client of space.clients ?? []) {
    const address = client.address || client.machine
    if (!address || seen.has(address)) continue
    seen.add(address)
    machines.push({
      address,
      machine: client.machine || address,
      label: client.label ?? '',
      live: true,
      since: client.since,
    })
  }
  const last = space.lastClient
  const lastAddress = last?.address || last?.machine || ''
  if (last && lastAddress && !seen.has(lastAddress)) {
    machines.push({
      address: lastAddress,
      machine: last.machine || lastAddress,
      label: last.label ?? '',
      live: false,
      since: last.since,
    })
  }
  return machines
}

export function shareState(space: Space): ShareState {
  const clients = space.clients ?? []
  if (clients.length > 0) {
    const machines = clients.map((client) => client.machine || 'a client')
    return {
      live: true,
      label: clients.length === 1 ? 'Live' : `${clients.length} live`,
      machine: machines.join(', '),
    }
  }
  if (space.lastClient) {
    return {
      live: false,
      label: relativeTime(space.lastClient.since),
      machine: space.lastClient.machine || '',
    }
  }
  return { live: false, label: 'Never', machine: '' }
}
