// Renders the production bundle in a DOM against real API payloads.
//
//   node scripts/smoke-dom.mjs
//
// jsdom has no browser engine, so this proves the app mounts, the provider's
// fetches resolve and real numbers reach the page — not how it looks. The API
// payloads are read from the container itself, or from scripts/fixtures when
// there is no incus to ask (CI); the bundle and those three documents are
// served from a local port so the page stays same-origin.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
// Payloads come from the live container when `incus` can reach it, or from a
// directory of committed JSON (scripts/fixtures, with system.json /
// state.json / metrics.json) on a machine that has no incus — which is every
// CI runner. ORION_SMOKE_FIXTURES points at a different directory when the
// payloads need to be re-captured.
const hasIncus = (() => {
  try {
    execFileSync('incus', ['version'], { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
})()
const fixtureDir =
  process.env.ORION_SMOKE_FIXTURES ??
  (hasIncus ? null : fileURLToPath(new URL('./fixtures/', import.meta.url)))
const fixtures = {}
for (const [name, path] of [
  ['system', '/api/system'],
  ['state', '/api/state'],
  ['metrics', '/api/metrics'],
]) {
  fixtures[path] = fixtureDir
    ? await readFile(join(fixtureDir, `${name}.json`), 'utf8')
    : execFileSync(
        'incus',
        ['exec', 'i1move:nas', '--', 'curl', '-s', `http://127.0.0.1:8099${path}`],
        { encoding: 'utf8', timeout: 20_000 },
      )
}

const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname.startsWith('/api/')) {
    const body = fixtures[url.pathname]
    if (!body) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(body)
    return
  }
  // The bundle is built with a base of `/<repo>/` when GITHUB_REPOSITORY is set
  // (GitHub Pages), so index.html asks for `/orion/assets/…` on CI and for
  // `/assets/…` locally. Serving from dist means trying the path with its first
  // segment removed as well.
  const [, , ...rest] = url.pathname.split('/')
  const files = url.pathname === '/' || url.pathname === '/app/' ? ['index.html'] : [url.pathname.slice(1)]
  if (rest.length > 0) files.push(rest.join('/'))
  for (const file of files) {
    try {
      let body = await readFile(join(dist, file))
      if (file === 'index.html') {
        // jsdom does not execute module scripts; the bundle has no top-level
        // import/export, so a classic deferred script is equivalent here.
        body = Buffer.from(body.toString().replace('type="module"', 'defer'))
      }
      response
        .writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
        .end(body)
      return
    } catch {
      continue
    }
  }
  response.writeHead(404).end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const errors = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', (error) => errors.push(error.message))
virtualConsole.on('error', (message) => errors.push(String(message)))

const dom = await JSDOM.fromURL(`${origin}/app/`, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole,
  // jsdom exposes no fetch or observers; the bundle needs them before it runs.
  beforeParse(window) {
    window.fetch = (input, init) => {
      const url = typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input
      return fetch(url, init)
    }
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
    // jsdom 30 has no modal dialog; the app opens every dialog this way.
    window.HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true
    }
    window.HTMLDialogElement.prototype.close = function close() {
      this.open = false
      this.dispatchEvent(new window.Event('close'))
    }
  },
})
const { window } = dom

await new Promise((resolve) => setTimeout(resolve, 3500))

async function at(hash) {
  window.location.hash = hash
  window.dispatchEvent(new window.HashChangeEvent('hashchange'))
  await new Promise((resolve) => setTimeout(resolve, 700))
  return window.document.body.textContent.replace(/\s+/g, ' ')
}

const filesText = await at('#/files')
const fileRows = window.document.querySelectorAll('.file-table tbody tr').length
// The sidebar is where a mounted share should be visible without opening
// Settings; the fixture's space has a live session on DESKTOP-7Q4.
const filesShares = {
  rows: window.document.querySelectorAll('.files-sidebar .share-dot').length,
  live: window.document.querySelectorAll('.files-sidebar .share-dot--live').length,
}
const appsText = await at('#/apps')
const unitCards = window.document.querySelectorAll('.store-card').length
const storageText = await at('#/storage')
const poolCards = window.document.querySelectorAll('.pool-card').length
// Every Settings tab, not just the ones with assertions below: the crash this
// check exists for (a value read before its declaration) took Settings down on
// render, and any tab can grow that mistake.
const tabs = ['general', 'appearance', 'network', 'users', 'security', 'about']
const tabText = {}
for (const tab of tabs) tabText[tab] = await at(`#/settings?tab=${tab}`)
const settingsTabs = Object.fromEntries(
  Object.entries(tabText).map(([tab, value]) => [
    tab,
    { crashed: value.includes('Something went wrong'), chars: value.length },
  ]),
)
const generalText = tabText.general
const usersText = tabText.users
const aboutText = tabText.about
const settingsText = Object.values(tabText).join(' ')

// The share dialog is where a person learns whether a client ever connected, so
// it is opened here and read: the fixture's space has a session on DESKTOP-7Q4.
await at('#/settings?tab=users')
const shareButton = window.document.querySelector('button[title^="Change the SMB password"]')
shareButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const shareText = window.document.body.textContent.replace(/\s+/g, ' ')
// Naming a machine is the way out of an address Samba cannot resolve, so the
// control has to be reachable from the same dialog that reports the connection.
const shareRows = window.document.querySelectorAll('.share-clients__row').length
const renameButton = window.document.querySelector('.share-clients__row button')
renameButton?.click()
await new Promise((resolve) => setTimeout(resolve, 400))
const nameInput = window.document.querySelector('.share-clients__form input')
const shareDialog = {
  opened: Boolean(shareButton),
  namesTheClient: shareText.includes('DESKTOP-7Q4'),
  claimsConnected: /is connected/.test(shareText),
  shareRows,
  showsAddress: shareText.includes('192.168.1.20'),
  offersName: Boolean(renameButton) && Boolean(nameInput),
}
await at('#/')

// The way out lives in the shell. jsdom's fixture forwards no identity, so this
// also proves the control is not conditional on one being present.
const signOutButton = window.document.querySelector('.titlebar button[aria-label^="Sign out"]')
const version = JSON.parse(fixtures['/api/system']).version.version
const dashboardShares = {
  card: Boolean(window.document.querySelector('.shares-card')),
  rows: window.document.querySelectorAll('.shares-card .share-row').length,
  live: window.document.querySelectorAll('.shares-card .share-dot--live').length,
  namesTheClient: window.document.body.textContent.includes('DESKTOP-7Q4'),
}
// A machine arriving is a server notification, so it has to reach both the
// notice card and the bell's unread count.
const shareNotice = {
  cards: window.document.querySelectorAll('.notice-card').length,
  namesMachine: [...window.document.querySelectorAll('.notice-card')].some((node) =>
    node.textContent.includes('DESKTOP-7Q4'),
  ),
  unread: window.document.querySelector('.titlebar .notif-dot')?.textContent ?? null,
}

const text = window.document.body.textContent.replace(/\s+/g, ' ')
const summary = {
  title: window.document.title,
  hostnameShown: text.includes('nas'),
  filesPage: Boolean(window.document.querySelector('.app-tile')),
  tiles: window.document.querySelectorAll('.app-tile').length,
  apiErrorBanner: text.includes('The API is not answering'),
  crash: text.includes('Something went wrong'),
  signOutOffered: Boolean(signOutButton),
  signOutLabel: signOutButton?.getAttribute('aria-label') ?? null,
  uptimeShown: /Up \d+[dhm]/.test(text),
  bodyChars: text.length,
  routes: {
    filesRows: fileRows,
    filesShowsVolume: filesText.includes('backups') && filesText.includes('media'),
    serviceCards: unitCards,
    servicesShowNginx: appsText.includes('nginx'),
    poolCards,
    storageShowsDevices: storageText.includes('Devices'),
    generalShowsRuntime: generalText.includes('Incus'),
    usersShowsRoot: usersText.includes('root'),
    usersOwnSpacePrompt:
      usersText.includes('space yet') || usersText.includes('not shared yet'),
    aboutShowsBuild: aboutText.includes(version),
    settingsTabs,
    shareDialog,
    filesShares,
    dashboardShares,
    shareNotice,
  },
  headings: [...window.document.querySelectorAll('h1, h2')].map((node) => node.textContent.trim()).slice(0, 8),
  errors: errors.slice(0, 3),
}
console.log(JSON.stringify(summary, null, 2))

dom.window.close()
server.close()
const broken =
  summary.apiErrorBanner ||
  summary.crash ||
  summary.errors.length > 0 ||
  summary.routes.filesRows === 0 ||
  summary.routes.serviceCards === 0 ||
  summary.routes.poolCards === 0 ||
  !summary.routes.servicesShowNginx ||
  !summary.routes.generalShowsRuntime ||
  !summary.routes.aboutShowsBuild ||
  !summary.signOutOffered ||
  // A Settings tab that crashed, or one that rendered nothing worth reading.
  Object.values(summary.routes.settingsTabs).some((tab) => tab.crashed || tab.chars < 200) ||
  !summary.routes.shareDialog.namesTheClient ||
  !summary.routes.shareDialog.claimsConnected ||
  summary.routes.shareDialog.shareRows === 0 ||
  !summary.routes.shareDialog.showsAddress ||
  !summary.routes.shareDialog.offersName ||
  summary.routes.filesShares.live === 0 ||
  !summary.routes.dashboardShares.card ||
  !summary.routes.dashboardShares.namesTheClient ||
  summary.routes.dashboardShares.live === 0 ||
  !summary.routes.shareNotice.namesMachine ||
  !summary.routes.shareNotice.unread
process.exit(broken ? 1 : 0)
