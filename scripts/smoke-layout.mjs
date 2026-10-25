// Fails when a control cannot be reached because the floating navigation bar is
// over it.
//
//   node scripts/smoke-layout.mjs
//
// jsdom (scripts/smoke-dom.mjs) proves the app renders; it lays nothing out, so
// it cannot see a fixed bar sitting on top of a button. Below 900px the rail
// becomes a floating bar and the Files pane sizes itself to the viewport, which
// is exactly where the last row and the footer ended up behind it — the bug this
// check exists to catch. It drives a real Chromium against the built bundle and
// the committed fixtures, at the widths where the bar exists.
//
// The question is not "is this control under the bar right now" — everything
// scrolls under a floating bar — but "can the page be scrolled far enough to put
// it above the bar". A pane that cannot scroll, or a page whose bottom padding
// is too small, is what fails.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

// The bar only exists at or below this width; above it the rail is a column.
const VIEWPORTS = [
  { width: 660, height: 900 },
  { width: 440, height: 600 },
  { width: 660, height: 420 },
]

const ROUTES = [
  ['#/dashboard', 'Dashboard'],
  ['#/files', 'Files'],
  ['#/files?trash=1', 'Trash'],
  ['#/apps', 'Apps'],
  ['#/storage', 'Storage'],
  ['#/settings?tab=general', 'Settings · general'],
  ['#/settings?tab=appearance', 'Settings · appearance'],
  ['#/settings?tab=network', 'Settings · network'],
  ['#/settings?tab=users', 'Settings · users'],
  ['#/settings?tab=security', 'Settings · security'],
  ['#/settings?tab=about', 'Settings · about'],
]

// Every route is served from one document with the committed payloads, so no
// container and no sign-in is involved.
const payloads = {}
for (const [name, path] of [
  ['system', '/api/system'],
  ['state', '/api/state'],
  ['metrics', '/api/metrics'],
  ['trash', '/api/trash'],
]) {
  payloads[path] = await readFile(join(fixtures, `${name}.json`), 'utf8')
}

const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname.startsWith('/api/')) {
    const body = payloads[url.pathname]
    if (!body) {
      response.writeHead(404).end('{}')
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(body)
    return
  }
  // The bundle is built with a base of `/<repo>/` when GITHUB_REPOSITORY is set,
  // so try the path as given and with its first segment dropped.
  const [, , ...rest] = url.pathname.split('/')
  const shell = url.pathname === '/' || url.pathname === '/app/'
  const candidates = shell ? ['index.html'] : [url.pathname.slice(1)]
  if (rest.length > 0) candidates.push(rest.join('/'))
  for (const file of candidates) {
    try {
      const body = await readFile(join(dist, file))
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

// A system browser first — CI's runner and this desktop both have Chrome — so
// the check needs no 170MB browser download. `npx playwright-core install
// chromium` puts the bundled one in place for a machine that has neither.
async function launch() {
  const attempts = [
    ['the installed Google Chrome', { channel: 'chrome' }],
    ['the installed Microsoft Edge', { channel: 'msedge' }],
    ['the bundled Chromium', {}],
  ]
  const failures = []
  for (const [description, options] of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, ...options })
      return { browser, description }
    } catch (error) {
      failures.push(`${description}: ${String(error.message ?? error).split('\n')[0]}`)
    }
  }
  throw new Error(
    `no browser could be started for the layout check\n  ${failures.join('\n  ')}\n` +
      'Install one with: npx playwright-core install chromium',
  )
}

const { browser, description } = await launch()
// Clipboard permission so the Copy button produces its real toast rather than a
// failure toast; either way a toast is what gets measured.
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
const violations = []
let tested = 0

// Runs in the page. Everything is measured in document coordinates: an element
// can be clicked when some scroll offset puts its bottom above the bar's top edge
// without pushing its top out of the window. Scrolling inside the list that holds
// it counts too, so a table with its own scrollbar is not mistaken for a loss.
function audit() {
  const rail = document.querySelector('.rail')
  if (!rail) return { tested: 0, violations: [], error: 'the navigation rail is missing' }
  const bar = rail.getBoundingClientRect()
  const scrolling = document.scrollingElement
  const pageScroll = Math.max(0, scrolling.scrollHeight - window.innerHeight)
  const found = []
  const describe = (node) =>
    (
      (node.textContent || '').replace(/\s+/g, ' ').trim() ||
      node.getAttribute('aria-label') ||
      node.getAttribute('placeholder') ||
      node.tagName.toLowerCase()
    ).slice(0, 40)
  const scrollLeftIn = (node) => {
    let room = 0
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
        room += parent.scrollHeight - parent.clientHeight - parent.scrollTop
      }
    }
    return room
  }

  let counted = 0
  for (const node of document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="button"]',
  )) {
    if (node.closest('.rail') || node.closest('dialog:not([open])')) continue
    if (node.disabled || node.getAttribute('aria-disabled') === 'true') continue
    const style = getComputedStyle(node)
    if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue
    const rect = node.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    // Off-screen to the side is a closed drawer, not the bar's doing.
    if (rect.right <= 0 || rect.left >= innerWidth) continue
    if (rect.top >= innerHeight && rect.bottom <= 0) continue
    counted += 1
    if (rect.bottom <= bar.top) continue
    const bottomInPage = rect.bottom + window.scrollY
    const room = pageScroll + scrollLeftIn(node)
    if (bottomInPage - bar.top > room + 0.5) {
      found.push({ label: describe(node), why: 'cannot be scrolled clear of the bottom bar' })
    }
  }

  // A pane pinned to the viewport bottom has to end above the bar; its last row
  // and its footer hold nothing clickable often enough to hide it from the sweep
  // above, and that was the reported bug.
  for (const selector of ['.files-layout', '.files-footer']) {
    const panel = document.querySelector(selector)
    if (!panel) continue
    const rect = panel.getBoundingClientRect()
    if (rect.height === 0) continue
    if (rect.bottom + window.scrollY - bar.top > pageScroll + 0.5) {
      found.push({ label: selector, why: 'does not end above the bottom bar' })
    }
  }

  // Toasts are fixed to the window, so they cannot be scrolled anywhere: they
  // either sit above the bar or they are hidden.
  const toasts = document.querySelector('.toast-region')
  if (toasts) {
    const rect = toasts.getBoundingClientRect()
    if (rect.height > 0 && rect.bottom > bar.top + 0.5) {
      found.push({ label: '.toast-region', why: 'sits under the bottom bar' })
    }
  }

  return { tested: counted, violations: found }
}

// A toast is fixed to the window, so unlike page content it cannot be scrolled
// out from under the bar — it either sits above it or is lost. The reported bug
// was exactly this: 22px from the floor, inside the bar's 74px.
async function atToast(viewport) {
  await page.setViewportSize(viewport)
  await page.goto(`${origin}/app/#/apps`)
  await page.waitForSelector('.store-card__command button')
  await page.locator('.store-card__command button').first().click()
  await page.waitForSelector('.toast', { timeout: 5000 })
  const result = await page.evaluate(() => {
    const bar = document.querySelector('.rail').getBoundingClientRect()
    const found = []
    for (const toast of document.querySelectorAll('.toast')) {
      const rect = toast.getBoundingClientRect()
      if (rect.height === 0) continue
      if (rect.bottom > bar.top + 0.5) {
        found.push({ label: 'the toast', why: 'sits under the bottom bar' })
      }
      if (rect.top < -0.5 || rect.bottom > innerHeight + 0.5) {
        found.push({ label: 'the toast', why: 'does not fit in the window' })
      }
      const close = toast.querySelector('.toast__close')
      if (close) {
        const box = close.getBoundingClientRect()
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        )
        if (hit && hit.closest('.rail')) {
          found.push({ label: 'the toast close button', why: 'is underneath the bottom bar' })
        }
      }
    }
    return found
  })
  for (const violation of result) {
    violations.push({ viewport, screen: 'Toast', ...violation })
  }
}

async function atRoute(hash, viewport, label) {
  await page.goto(`${origin}/app/${hash}`)
  await page.waitForSelector('.rail')
  // A fresh page can restore the previous scroll position; start from the top.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  const result = await page.evaluate(audit)
  tested += result.tested
  for (const violation of result.violations ?? []) {
    violations.push({ viewport, screen: label, ...violation })
  }
  if (result.error) {
    violations.push({ viewport, screen: label, label: result.error, why: result.error })
  }
}

// Dialogs live in the browser's top layer, above any z-index, so the bar cannot
// intercept them — but a panel taller than the window would still lose its
// footer off the bottom edge.
async function atDialog(viewport, label, open) {
  await page.setViewportSize(viewport)
  await open()
  if (!(await page.$('dialog[open]'))) {
    violations.push({ viewport, screen: label, label, why: 'did not open' })
    return
  }
  const found = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    const panel = dialog.querySelector('.modal__panel, .palette') ?? dialog
    const box = panel.getBoundingClientRect()
    const issues = []
    if (box.bottom > innerHeight + 0.5 || box.top < -0.5) {
      issues.push({ label: 'the dialog panel', why: 'does not fit in the window' })
    }
    for (const node of dialog.querySelectorAll('button, a[href], input, select, textarea')) {
      const rect = node.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      // Rows scrolled out of the dialog's own list are not the bar's concern.
      if (rect.top < box.top - 1 || rect.bottom > box.bottom + 1) continue
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        Math.min(rect.bottom - 3, innerHeight - 3),
      )
      if (hit && !dialog.contains(hit)) {
        issues.push({
          label: (node.textContent || '').trim().slice(0, 40) || node.tagName.toLowerCase(),
          why: 'is not what a click would hit',
        })
      }
    }
    return issues
  })
  for (const violation of found) violations.push({ viewport, screen: label, ...violation })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
}

for (const viewport of VIEWPORTS) {
  await page.setViewportSize(viewport)
  for (const [hash, label] of ROUTES) {
    await atRoute(hash, viewport, label)
  }
  await atDialog(viewport, 'Command palette', async () => {
    await page.goto(`${origin}/app/#/dashboard`)
    await page.waitForSelector('.rail')
    await page.keyboard.press('Control+k')
    await page.waitForSelector('dialog[open]')
  })
  await atDialog(viewport, 'Add a person', async () => {
    await page.goto(`${origin}/app/#/settings?tab=users`)
    await page.waitForSelector('.rail')
    await page.getByRole('button', { name: 'New space' }).click()
    await page.waitForSelector('dialog[open]')
  })
  await atToast(viewport)
  process.stdout.write(
    `${viewport.width}×${viewport.height}: ${ROUTES.length} screens, 2 dialogs and a toast\n`,
  )
}

await browser.close()
server.close()

if (violations.length) {
  console.error(`\n${violations.length} control(s) not reachable at narrow widths:`)
  for (const violation of violations) {
    console.error(
      `  ${violation.viewport.width}×${violation.viewport.height} · ${violation.screen} · ` +
        `"${violation.label}" ${violation.why}`,
    )
  }
  process.exit(1)
}

console.log(
  `\nlayout ok · ${tested} controls measured across ${VIEWPORTS.length} viewports, ` +
    `browser: ${description}`,
)
