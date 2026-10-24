// Renders the production bundle in a DOM against real API payloads.
//
//   node scripts/smoke-dom.mjs
//
// jsdom has no browser engine, so this proves the app mounts, the provider's
// fetches resolve and real numbers reach the page — not how it looks. The API
// payloads are read from the container itself; the bundle and those three
// documents are served from a local port so the page stays same-origin.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const fixtures = {}
for (const [route, path] of [
  ['system', '/api/system'],
  ['state', '/api/state'],
  ['metrics', '/api/metrics'],
]) {
  fixtures[path] = execFileSync(
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
  const file = url.pathname === '/' || url.pathname === '/app/' ? 'index.html' : url.pathname.slice(1)
  try {
    let body = await readFile(join(dist, file))
    if (file === 'index.html') {
      // jsdom does not execute module scripts; the bundle has no top-level
      // import/export, so a classic deferred script is equivalent here.
      body = Buffer.from(body.toString().replace('type="module"', 'defer'))
    }
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(body)
  } catch {
    response.writeHead(404).end()
  }
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
const appsText = await at('#/apps')
const unitCards = window.document.querySelectorAll('.store-card').length
const storageText = await at('#/storage')
const poolCards = window.document.querySelectorAll('.pool-card').length
const generalText = await at('#/settings?tab=general')
const usersText = await at('#/settings?tab=users')
const aboutText = await at('#/settings?tab=about')
const settingsText = [generalText, usersText, aboutText].join(' ')
await at('#/')

const text = window.document.body.textContent.replace(/\s+/g, ' ')
const summary = {
  title: window.document.title,
  hostnameShown: text.includes('nas'),
  filesPage: Boolean(window.document.querySelector('.app-tile')),
  tiles: window.document.querySelectorAll('.app-tile').length,
  apiErrorBanner: text.includes('The API is not answering'),
  crash: text.includes('Something went wrong'),
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
    aboutShowsBuild: aboutText.includes('1.5.0'),
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
  !summary.routes.aboutShowsBuild
process.exit(broken ? 1 : 0)
