import type { Settings } from '../types'

/** Browser preferences. The machine's identity is never stored here. */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'blue',
  wallpaper: 'aurora',
  density: 'comfortable',
  reduceMotion: false,
  timeFormat: '24',
  language: 'en-US',
  timezone: 'America/New_York',
}
