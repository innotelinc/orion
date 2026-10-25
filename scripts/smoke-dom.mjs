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
  ['trash', '/api/trash'],
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
// The path bar is meant to be one click from editable, with the whole path
// selected so the next keystroke replaces it rather than appending to it. The
// state is read before the typing test, which replaces the field.
const currentCrumb =
  window.document.querySelector('.breadcrumbs button[aria-current="page"]') ??
  window.document.querySelector('.breadcrumbs button')
currentCrumb?.click()
await new Promise((resolve) => setTimeout(resolve, 60))
const addressInput = window.document.querySelector('.files-address__input')
const openedPath = addressInput?.value ?? null
const focused = Boolean(addressInput) && window.document.activeElement === addressInput
const allSelected = Boolean(addressInput)
  ? addressInput.selectionStart === 0 &&
    addressInput.selectionEnd === (addressInput.value ?? '').length
  : false
// Typing over the selection and pressing Enter is the whole point of the field,
// so the check types a real path and looks for the folder it navigated to.
let typedPath = false
if (addressInput) {
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  setValue?.call(addressInput, '/media')
  addressInput.dispatchEvent(new window.Event('input', { bubbles: true }))
  addressInput.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  )
  await new Promise((resolve) => setTimeout(resolve, 700))
  typedPath = [...window.document.querySelectorAll('.breadcrumbs button')].some(
    (node) => node.textContent.trim() === 'media',
  )
}
// Ctrl+L and Cmd+L are the keyboard half of the same bar: they must open it on
// the folder in view, with everything selected, and Escape must give the crumbs
// back so the shortcut cannot trap the toolbar in edit mode.
const pressKey = async (init) => {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init }))
  await new Promise((resolve) => setTimeout(resolve, 60))
  return window.document.querySelector('.files-address__input')
}
const ctrlL = await pressKey({ key: 'l', ctrlKey: true })
const ctrlLCheck = {
  opens: Boolean(ctrlL),
  path: ctrlL?.value ?? null,
  allSelected: Boolean(ctrlL)
    ? ctrlL.selectionStart === 0 && ctrlL.selectionEnd === (ctrlL.value ?? '').length
    : false,
}
ctrlL?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 60))
const cmdL = await pressKey({ key: 'l', metaKey: true })
const cmdLCheck = { opens: Boolean(cmdL), path: cmdL?.value ?? null }
cmdL?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 60))
// Completion is shell-like: a partial folder name plus Tab fills it and leaves a
// trailing slash, one level at a time. The caret check is the guard against
// re-selecting the whole path on every keystroke, which would eat the typing.
const fieldValue = () => window.document.querySelector('.files-address__input')
const setField = async (value) => {
  const field = fieldValue()
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  setValue?.call(field, value)
  field.dispatchEvent(new window.Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 60))
  return fieldValue()
}
const pressOn = async (node, init) => {
  node.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init }))
  await new Promise((resolve) => setTimeout(resolve, 60))
}
await pressKey({ key: 'l', ctrlKey: true })
const typed = await setField('/Us')
const caretCollapsed =
  Boolean(typed) && typed.selectionStart === typed.selectionEnd
typed?.dispatchEvent(
  new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
)
await new Promise((resolve) => setTimeout(resolve, 60))
const afterFirstTab = fieldValue()?.value ?? null
const offeredChildren = [...window.document.querySelectorAll('.files-address__option')].map(
  (node) => node.textContent.trim(),
)
await pressOn(fieldValue(), { key: 'Tab' })
const afterSecondTab = fieldValue()?.value ?? null
await pressOn(fieldValue(), { key: 'Enter' })
const completions = {
  caretCollapsed,
  afterFirstTab,
  afterSecondTab,
  offeredChildren,
  navigated: [...window.document.querySelectorAll('.breadcrumbs button')].some(
    (node) => node.textContent.trim() === 'ada',
  ),
}
// The field has to say whether what is typed is a folder while it is being
// typed, not only when Enter fails.
await pressKey({ key: 'l', ctrlKey: true })
await setField('/Users')
const stateForFolder =
  window.document.querySelector('.files-address__state')?.textContent?.trim() ?? null
await setField('/nope')
const stateForMissing =
  window.document.querySelector('.files-address__state')?.textContent?.trim() ?? null
fieldValue()?.dispatchEvent(
  new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
)
await new Promise((resolve) => setTimeout(resolve, 60))
const pathState = { stateForFolder, stateForMissing }
const addressBar = {
  opens: Boolean(addressInput),
  openedPath,
  focused,
  allSelected,
  typedPath,
  ctrlL: ctrlLCheck,
  cmdL: cmdLCheck,
  escapeRestoresCrumbs: Boolean(window.document.querySelector('.breadcrumbs button')),
  completions,
  pathState,
}
// Deletes are recoverable, so the pane that proves it has to open and list what
// was deleted, with the folder each item came from and a way back.
const trashText = await at('#/files?trash=1')
const trashPane = {
  rows: window.document.querySelectorAll('.trash-row').length,
  showsOriginal: trashText.includes('/media/old-notes.txt'),
  showsWhen: /deleted /.test(trashText),
  offersRestore: [...window.document.querySelectorAll('.trash-row button')].some((node) =>
    node.textContent.includes('Restore'),
  ),
  offersEmpty: [...window.document.querySelectorAll('button')].some((node) =>
    node.textContent.includes('Empty trash'),
  ),
  sidebar: [...window.document.querySelectorAll('.files-sidebar__item')].some((node) =>
    node.textContent.includes('Trash'),
  ),
}
const appsText = await at('#/apps')
const unitCards = window.document.querySelectorAll('.store-card').length
// NFS is exported by the host, not refused by it: the card has to say so, name
// where the export lives, and must not offer an Install that can only fail.
const nfsCard = [...window.document.querySelectorAll('.store-card')].find((card) =>
  card.textContent.includes('NFS server'),
)
const appsCatalogue = {
  saysOnTheHost: Boolean(nfsCard) && nfsCard.textContent.includes('on the host'),
  notCalledUnavailable:
    Boolean(nfsCard) && !nfsCard.textContent.includes('unavailable'),
  noInstall: nfsCard
    ? ![...nfsCard.querySelectorAll('button')].some(
        (button) => button.textContent.trim() === 'Install',
      )
    : false,
  namesTheHost: Boolean(nfsCard) && nfsCard.textContent.includes('orion.exports'),
}
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
// Who may mount the share, and the address it is filed under, are decided in
// this dialog too; the fixture's space is a household one, opened to everyone.
const accessSwitch = window.document.querySelector('.share-access [role="switch"]')
const addressField = window.document.querySelector('#space-address')
const shareDialog = {
  opened: Boolean(shareButton),
  namesTheClient: shareText.includes('DESKTOP-7Q4'),
  claimsConnected: /is connected/.test(shareText),
  shareRows,
  showsAddress: shareText.includes('192.168.1.20'),
  offersName: Boolean(renameButton) && Boolean(nameInput),
  whoCanMount: Boolean(accessSwitch),
  openToEveryone: accessSwitch?.getAttribute('aria-checked') === 'true',
  addressValue: addressField?.value ?? '',
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
    appsCatalogue,
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
    addressBar,
    dashboardShares,
    shareNotice,
    trashPane,
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
  !summary.routes.appsCatalogue.saysOnTheHost ||
  !summary.routes.appsCatalogue.notCalledUnavailable ||
  !summary.routes.appsCatalogue.noInstall ||
  !summary.routes.appsCatalogue.namesTheHost ||
  !summary.routes.generalShowsRuntime ||
  !summary.routes.aboutShowsBuild ||
  !summary.signOutOffered ||
  // A Settings tab that crashed, or one that rendered nothing worth reading.
  Object.values(summary.routes.settingsTabs).some((tab) => tab.crashed || tab.chars < 200) ||
  !summary.routes.shareDialog.namesTheClient ||
  !summary.routes.shareDialog.claimsConnected ||
  !summary.routes.shareDialog.whoCanMount ||
  !summary.routes.shareDialog.openToEveryone ||
  summary.routes.shareDialog.addressValue !== 'ada@example.test' ||
  summary.routes.shareDialog.shareRows === 0 ||
  !summary.routes.shareDialog.showsAddress ||
  !summary.routes.shareDialog.offersName ||
  summary.routes.filesShares.live === 0 ||
  !summary.routes.addressBar.opens ||
  !summary.routes.addressBar.allSelected ||
  !summary.routes.addressBar.typedPath ||
  !summary.routes.addressBar.ctrlL.opens ||
  !summary.routes.addressBar.ctrlL.allSelected ||
  summary.routes.addressBar.ctrlL.path !== '/media' ||
  !summary.routes.addressBar.cmdL.opens ||
  summary.routes.addressBar.cmdL.path !== '/media' ||
  !summary.routes.addressBar.escapeRestoresCrumbs ||
  !summary.routes.addressBar.completions.caretCollapsed ||
  summary.routes.addressBar.completions.afterFirstTab !== '/Users/' ||
  summary.routes.addressBar.completions.afterSecondTab !== '/Users/ada/' ||
  !summary.routes.addressBar.completions.navigated ||
  summary.routes.addressBar.pathState.stateForFolder !== 'folder' ||
  summary.routes.addressBar.pathState.stateForMissing !== 'no such folder' ||
  !summary.routes.dashboardShares.card ||
  !summary.routes.dashboardShares.namesTheClient ||
  summary.routes.dashboardShares.live === 0 ||
  !summary.routes.shareNotice.namesMachine ||
  !summary.routes.shareNotice.unread ||
  summary.routes.trashPane.rows === 0 ||
  !summary.routes.trashPane.showsOriginal ||
  !summary.routes.trashPane.offersRestore ||
  !summary.routes.trashPane.offersEmpty ||
  !summary.routes.trashPane.sidebar
process.exit(broken ? 1 : 0)
