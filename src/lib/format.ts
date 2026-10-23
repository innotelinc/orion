export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function formatBytes(bytes: number | null, decimals = 1) {
  if (bytes === null || Number.isNaN(bytes)) return '—'
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(index === 0 ? 0 : decimals)} ${units[index]}`
}

export function formatTb(value: number, decimals = 1) {
  return `${value.toFixed(decimals)} TB`
}

export function formatPercent(value: number, total: number) {
  if (!total) return 0
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)))
}

export function relativeTime(iso: string) {
  const timestamp = new Date(iso).getTime()
  if (Number.isNaN(timestamp)) return 'Unknown'
  const diff = Date.now() - timestamp
  if (diff < 45_000) return 'Just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: days > 320 ? 'numeric' : undefined,
  }).format(timestamp)
}

export function formatDate(iso: string) {
  const timestamp = new Date(iso).getTime()
  if (Number.isNaN(timestamp)) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp)
}

export function formatFullDateTime(iso: string) {
  const timestamp = new Date(iso).getTime()
  if (Number.isNaN(timestamp)) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

export function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatDay(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function greeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function truncateMiddle(value: string, max = 42) {
  if (value.length <= max) return value
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}
