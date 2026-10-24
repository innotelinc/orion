#!/usr/bin/env node
// Orion's live backend.
//
// The browser build is a shell: every screen renders from the data this server
// reports. It reads the host it is installed on — the directories mounted into
// it, the filesystem those directories live on, the block devices the kernel
// exposes, /proc and /etc/passwd — and serves the SPA from dist/.
//
// Read-only by construction: no route here writes, renames or deletes anything.
// Pair that with `:ro` mounts in docker-compose.yml and the container cannot
// change the array even if the UI is compromised.

import { createReadStream, existsSync } from 'node:fs'
import { readdir, lstat, statfs, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { delimiter, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DIST = resolve(HERE, '..', 'dist')
const PORT = Number(process.env.ORION_PORT ?? 8080)
const HOST = process.env.ORION_HOST ?? '0.0.0.0'
const MAX_ENTRIES = 5000

// ---------------------------------------------------------------------------
// Storage roots
// ---------------------------------------------------------------------------

function configuredRoots() {
  const raw = (process.env.ORION_ROOTS ?? '').trim()
  if (raw) return raw.split(delimiter).filter(Boolean)
  // /data is the mount point the image declares, so a bare
  // `docker run -v /tank:/data` is live without any configuration.
  const mounted = ['/data', '/mnt', '/media'].filter((candidate) => existsSync(candidate))
  return mounted.length > 0 ? mounted : [process.cwd()]
}

/** Virtual name -> host directory. Names are what the UI shows and links to. */
function buildRoots() {
  const roots = []
  const used = new Set()
  for (const candidate of configuredRoots()) {
    const absolute = resolve(candidate)
    let name = absolute.split(sep).filter(Boolean).pop() ?? 'root'
    let unique = name
    let index = 2
    while (used.has(unique)) unique = `${name}-${index++}`
    used.add(unique)
    roots.push({ name: unique, path: absolute })
  }
  return roots
}

const ROOTS = buildRoots()
const ROOT_BY_NAME = new Map(ROOTS.map((root) => [root.name, root]))

class OutsideRoots extends Error {}

/** Map a virtual path (/Photos/2026) to a host path, refusing anything outside a root. */
function hostPath(virtualPath) {
  const clean = String(virtualPath ?? '/').replace(/\\/g, '/')
  if (clean.includes('\0')) throw new OutsideRoots('Invalid path')
  const segments = clean.split('/').filter(Boolean)
  if (segments.length === 0) return { real: null, root: null }

  const root = ROOT_BY_NAME.get(segments[0])
  if (!root) throw new OutsideRoots('Unknown root')

  const real = resolve(root.path, ...segments.slice(1))
  if (real !== root.path && !real.startsWith(root.path + sep)) {
    throw new OutsideRoots('Path escapes its root')
  }
  return { real, root }
}

const TONES = new Map([
  ['jpg', 'image'], ['jpeg', 'image'], ['png', 'image'], ['gif', 'image'], ['webp', 'image'],
  ['heic', 'image'], ['heif', 'image'], ['svg', 'image'], ['tiff', 'image'], ['raw', 'image'],
  ['mp4', 'video'], ['mkv', 'video'], ['mov', 'video'], ['avi', 'video'], ['webm', 'video'],
  ['mp3', 'audio'], ['flac', 'audio'], ['wav', 'audio'], ['aac', 'audio'], ['m4a', 'audio'],
  ['pdf', 'document'], ['doc', 'document'], ['docx', 'document'], ['txt', 'document'], ['md', 'document'],
  ['csv', 'sheet'], ['xls', 'sheet'], ['xlsx', 'sheet'], ['ods', 'sheet'],
  ['zip', 'archive'], ['tar', 'archive'], ['gz', 'archive'], ['7z', 'archive'], ['rar', 'archive'], ['zst', 'archive'],
  ['js', 'code'], ['mjs', 'code'], ['ts', 'code'], ['tsx', 'code'], ['jsx', 'code'], ['json', 'code'],
  ['py', 'code'], ['go', 'code'], ['rs', 'code'], ['sh', 'code'], ['yml', 'code'], ['yaml', 'code'],
])

function toneFor(name) {
  return TONES.get(extname(name).slice(1).toLowerCase()) ?? 'file'
}

function parentOf(virtualPath) {
  const index = virtualPath.lastIndexOf('/')
  return index <= 0 ? '/' : virtualPath.slice(0, index)
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

async function listVirtual(path) {
  const segments = String(path ?? '/').split('/').filter(Boolean)

  if (segments.length === 0) {
    // The virtual root is the set of mounted roots.
    const entries = await Promise.all(
      ROOTS.map(async (root) => {
        let modifiedAt = new Date(0).toISOString()
        try {
          const info = await lstat(root.path)
          modifiedAt = info.mtime.toISOString()
        } catch {
          // An unreadable root still belongs in the list so the UI can show it.
        }
        return {
          id: `/${root.name}`,
          name: root.name,
          parent: '/',
          type: 'folder',
          size: null,
          modifiedAt,
          owner: 'system',
          starred: false,
          tone: 'folder',
        }
      }),
    )
    return { path: '/', entries }
  }

  const { real } = hostPath(path)
  if (!real) throw new OutsideRoots('Unknown path')

  const directory = await readdir(real, { withFileTypes: true })
  const entries = []
  for (const entry of directory.slice(0, MAX_ENTRIES)) {
    const virtual = `${String(path).replace(/\/$/, '')}/${entry.name}`
    let info
    try {
      info = await lstat(join(real, entry.name))
    } catch {
      continue // Broken symlink or a file that vanished mid-listing.
    }
    const isFolder = info.isDirectory()
    entries.push({
      id: virtual,
      name: entry.name,
      parent: String(path).replace(/\/$/, '') || '/',
      type: isFolder ? 'folder' : 'file',
      size: isFolder ? null : info.size,
      modifiedAt: info.mtime.toISOString(),
      owner: 'system',
      starred: false,
      tone: isFolder ? 'folder' : toneFor(entry.name),
    })
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  return { path, entries }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const TB = 1e12

function tb(bytes) {
  return Math.round((bytes / TB) * 100) / 100
}

async function readDeviceAttribute(path) {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return null
  }
}

async function blockDevices() {
  let names
  try {
    names = await readdir('/sys/block')
  } catch {
    return []
  }
  const skip = /^(loop|ram|zram|dm-|sr|fd)/
  const disks = []
  for (const name of names) {
    if (skip.test(name)) continue
    const sectors = Number(await readDeviceAttribute(`/sys/block/${name}/size`))
    if (!Number.isFinite(sectors) || sectors <= 0) continue
    const model = (await readDeviceAttribute(`/sys/block/${name}/device/model`)) ?? name
    const rotational = await readDeviceAttribute(`/sys/block/${name}/queue/rotational`)
    const kind = name.startsWith('nvme') ? 'NVMe' : rotational === '1' ? 'HDD' : 'SSD'
    disks.push({
      id: `disk-${name}`,
      name: model || name,
      model: `/dev/${name} · ${(sectors * 512) / TB >= 1 ? `${tb(sectors * 512)} TB` : `${Math.round((sectors * 512) / 1e9)} GB`}`,
      capacityTb: tb(sectors * 512),
      pool: null,
      temperature: 0,
      health: 'Healthy',
      kind,
    })
  }
  return disks
}

async function storageState() {
  const pools = []
  for (const root of ROOTS) {
    try {
      const fs = await statfs(root.path)
      const total = fs.blocks * fs.bsize
      const free = fs.bavail * fs.bsize
      pools.push({
        id: `pool-${root.name}`,
        name: root.name,
        usedTb: tb(total - free),
        totalTb: tb(total),
        raid: 'Single',
        health: 'Healthy',
        mount: root.path,
      })
    } catch {
      // Root disappeared since startup; skip it rather than invent numbers.
    }
  }
  const disks = await blockDevices()
  for (const disk of disks) disk.pool = pools[0]?.name ?? null
  return { pools, disks }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

let cpuSample = os.cpus().map((cpu) => ({ ...cpu.times }))
let netSample = { at: 0, rx: 0, tx: 0 }

async function cpuModel() {
  try {
    const info = await readFile('/proc/cpuinfo', 'utf8')
    const model = /model name\s*:\s*(.+)/.exec(info)?.[1]?.trim()
    if (model) return model
  } catch {
    // Non-Linux or restricted /proc — fall through to what Node reports.
  }
  return os.cpus()[0]?.model ?? 'Unknown CPU'
}

function cpuUsage() {
  const now = os.cpus().map((cpu) => ({ ...cpu.times }))
  let idle = 0
  let total = 0
  now.forEach((times, index) => {
    const previous = cpuSample[index] ?? times
    const idleDelta = times.idle - previous.idle
    const totalDelta =
      times.user + times.nice + times.sys + times.idle + times.irq -
      (previous.user + previous.nice + previous.sys + previous.idle + previous.irq)
    idle += idleDelta
    total += totalDelta
  })
  cpuSample = now
  if (total <= 0) return 0
  return Math.round(((total - idle) / total) * 100)
}

async function cpuClockGhz() {
  try {
    const info = await readFile('/proc/cpuinfo', 'utf8')
    const speeds = [...info.matchAll(/cpu MHz\s*:\s*([\d.]+)/g)].map((match) => Number(match[1]))
    if (speeds.length > 0) {
      return Math.round((speeds.reduce((sum, value) => sum + value, 0) / speeds.length / 1000) * 10) / 10
    }
  } catch {
    // Fall through.
  }
  const speed = os.cpus()[0]?.speed
  return speed ? Math.round((speed / 1000) * 10) / 10 : 0
}

async function cpuTemperature() {
  try {
    const zones = await readdir('/sys/class/thermal').catch(() => [])
    const readings = []
    for (const zone of zones.filter((name) => name.startsWith('thermal_zone'))) {
      const value = Number(await readDeviceAttribute(`/sys/class/thermal/${zone}/temp`))
      if (Number.isFinite(value) && value > 0) readings.push(value / 1000)
    }
    if (readings.length > 0) return Math.round(Math.max(...readings))
  } catch {
    // No thermal zones (VMs, containers without /sys/class/thermal).
  }
  return null
}

async function networkRates() {
  let rx = 0
  let tx = 0
  try {
    const raw = await readFile('/proc/net/dev', 'utf8')
    for (const line of raw.split('\n').slice(2)) {
      const [name, rest] = line.split(':')
      if (!rest || name.trim() === 'lo') continue
      const fields = rest.trim().split(/\s+/)
      rx += Number(fields[0]) || 0
      tx += Number(fields[8]) || 0
    }
  } catch {
    return { down: 0, up: 0 }
  }
  const now = Date.now()
  const previous = netSample
  netSample = { at: now, rx, tx }
  if (!previous.at || now - previous.at < 250) return { down: 0, up: 0 }
  const seconds = (now - previous.at) / 1000
  const mb = (bytes) => Math.round((bytes / seconds / 1e6) * 10) / 10
  return { down: Math.max(0, mb(rx - previous.rx)), up: Math.max(0, mb(tx - previous.tx)) }
}

async function systemState() {
  const totalmem = os.totalmem()
  const freemem = os.freemem()
  const network = await networkRates()
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: {
      model: await cpuModel(),
      cores: os.cpus().length,
      usage: cpuUsage(),
      clockGhz: await cpuClockGhz(),
      load: Math.round((os.loadavg()[0] ?? 0) * 100) / 100,
    },
    memory: {
      totalGb: Math.round((totalmem / 1e9) * 10) / 10,
      usedGb: Math.round(((totalmem - freemem) / 1e9) * 10) / 10,
      percent: Math.round(((totalmem - freemem) / totalmem) * 100),
    },
    temperature: await cpuTemperature(),
    network,
    uptimeSeconds: Math.round(os.uptime()),
    uptimeDays: Math.floor(os.uptime() / 86_400),
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const USER_COLORS = ['#0a63ff', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4']

async function usersState() {
  const current = os.userInfo()
  const accounts = []
  try {
    const passwd = await readFile('/etc/passwd', 'utf8')
    for (const line of passwd.split('\n')) {
      const [name, , uid, gid, gecos, home, shell] = line.split(':')
      if (!name || !uid) continue
      const numericUid = Number(uid)
      const service = numericUid < 1000 && numericUid !== 0
      if (service || name === 'nobody') continue
      accounts.push({
        id: `u-${name}`,
        name: gecos?.split(',')[0] || name,
        email: `${name}@${os.hostname()}`,
        role: numericUid === 0 ? 'Owner' : shell?.includes('nologin') ? 'Guest' : 'Member',
        lastActive: '—',
        color: USER_COLORS[accounts.length % USER_COLORS.length],
        isCurrent: name === current.username,
        home,
      })
    }
  } catch {
    // Not a Unix host (or /etc/passwd unreadable): report the process owner only.
  }
  if (accounts.length === 0) {
    accounts.push({
      id: `u-${current.username}`,
      name: current.username,
      email: `${current.username}@${os.hostname()}`,
      role: 'Owner',
      lastActive: 'Now',
      color: USER_COLORS[0],
      isCurrent: true,
    })
  }
  return accounts
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ico', 'image/x-icon'],
  ['.map', 'application/json; charset=utf-8'],
])

function json(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

async function handleApi(request, response, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    json(response, 405, { error: 'Orion reports on this host; it does not modify it.' })
    return true
  }

  try {
    switch (url.pathname) {
      case '/api/health':
        json(response, 200, { ok: true, roots: ROOTS.map((root) => root.name), readOnly: true })
        return true
      case '/api/system':
        json(response, 200, await systemState())
        return true
      case '/api/storage':
        json(response, 200, await storageState())
        return true
      case '/api/users':
        json(response, 200, await usersState())
        return true
      case '/api/files':
        json(response, 200, await listVirtual(url.searchParams.get('path') ?? '/'))
        return true
      default:
        if (!url.pathname.startsWith('/api/')) return false
        json(response, 404, { error: 'Unknown endpoint' })
        return true
    }
  } catch (error) {
    if (error instanceof OutsideRoots) {
      json(response, 403, { error: 'That path is outside the mounted roots.' })
      return true
    }
    const code = error?.code
    if (code === 'ENOENT') json(response, 404, { error: 'No such directory.' })
    else if (code === 'EACCES' || code === 'EPERM') json(response, 403, { error: 'Permission denied.' })
    else json(response, 500, { error: String(error?.message ?? error) })
    return true
  }
}

async function serveStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = resolve(DIST, relative)
  const withinDist = file === DIST || file.startsWith(DIST + sep)

  let target = withinDist ? file : join(DIST, 'index.html')
  let info = await lstat(target).catch(() => null)
  if (!info?.isFile()) {
    // Hash routing means unknown paths are still the shell; real 404s are for
    // missing assets, which must not silently return HTML.
    if (extname(pathname)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }
    target = join(DIST, 'index.html')
    info = await lstat(target).catch(() => null)
    if (!info?.isFile()) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('dist/ is missing — run npm run build')
      return
    }
  }

  const headers = {
    'content-type': MIME.get(extname(target).toLowerCase()) ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': target.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  }
  response.writeHead(200, headers)
  createReadStream(target).pipe(response)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (await handleApi(request, response, url)) return

  try {
    await serveStatic(response, decodeURIComponent(url.pathname))
  } catch {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Internal error')
  }
})

server.listen(PORT, HOST, () => {
  const roots = ROOTS.map((root) => `${root.name} → ${root.path}`).join(', ') || 'none'
  console.log(`orion listening on http://${HOST}:${PORT}`)
  console.log(`reading ${roots}`)
  console.log('read-only: no endpoint writes to the host')
})
