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
