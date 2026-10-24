# Orion

A clean, robust, plug-and-play NAS desktop — reconstructed from the ZimaOS web UI captured over the Chrome DevTools Protocol at `127.0.0.1:9222`.

## What's here

- **Dashboard** — live CPU / memory / network telemetry, app grid, notices, recent activity, drop-to-upload.
- **Files** — deep-linkable folders (`#/files?path=/Documents`), instant search, multi-select, upload, rename, delete, star, details drawer.
- **App Store** — one-click installs with real progress, category filters, installed/updating states, container details, uninstall confirmation.
- **Storage** — pool capacity, disk health and SMART scans, plus a validated add-disk / expand-pool wizard.
- **Settings** — appearance (theme, accent, wallpaper, density, motion), network, users, security, and a reset-safe About tab.
- **Command palette** (`⌘K` / `Ctrl+K`) — jump to any view, folder, app or action.

Every mutation runs through one reducer-style context, so reloads, deep links and error boundaries behave predictably.

## Live on an install, demo on Pages

Orion has two data sources and says which one it is using in the title bar
(`Live host` or `Demo data`):

| | GitHub Pages | A container / bare install |
| --- | --- | --- |
| Data | the seed dataset in `src/data` | the machine it runs on |
| Persistence | `localStorage` | none — the host is the record |
| Files | simulated tree | `readdir` on the mounted roots |
| Storage | example pools and disks | `statfs` per root, `/sys/block` devices |
| Metrics / users | animated samples | `/proc`, `os`, `/etc/passwd` |
| Writes | yes (local only) | refused — see below |

There is no build flag for this. The shell fetches `/api/system` at startup; a
JSON answer means live, anything else (including Pages' HTML fallback for that
path) means demo. The two never mix: live data is kept out of `localStorage` so a
host snapshot cannot masquerade as demo state after a reload.

### Read-only by construction

The served surface is a reporting API. It has no endpoint that writes, renames or
deletes, so the UI's file actions return a "read-only live mount" notice instead
of pretending to move bytes. Mount volumes `:ro` as well — then even a bug in the
server cannot touch the array.

## Run it

```bash
npm install
npm run dev      # http://127.0.0.1:5173 (proxies /api to the server below)
```

In another terminal, point the API at a real directory:

```bash
ORION_ROOTS=/mnt/media ORION_PORT=8080 node server/index.mjs
open http://127.0.0.1:8080
```

`ORION_ROOTS` takes a `:`-separated list (`;` on Windows); each root appears in the
sidebar under its own directory name. With no value set it uses `/data`, then
`/mnt`, `/media`, and finally the current directory.

```bash
npm run build    # typecheck + production bundle
```

### Container

```bash
docker build -t orion .
docker run --rm -p 8080:8080 -v /mnt/media:/data:ro orion
```

Or edit the mounts in [docker-compose.yml](docker-compose.yml) and run
`docker compose up --build`. The image is a two-stage Node 24 build: the bundle is
compiled, then a single dependency-free `server/index.mjs` serves `dist/` and the
API on port 8080, with a `/api/health` healthcheck. No nginx, no runtime install.

### Pages

Every push to `main` deploys the static build to https://innotelinc.github.io/orion/. Pages has no
server, so that deployment is the demo — by design, from the same commit.

## Stack

React 19, TypeScript, Vite, `lucide-react` icons, Space Grotesk (self-hosted via `@fontsource-variable`). No UI framework — the design system is hand-rolled CSS in `src/styles`, using the ZimaOS design DNA: 48px glass title bar, 310px widget rail, 5-column app grid, `rgba(53,54,58,.4)` frosted cards, blue `#0A63FF` accent.

## Structure

```
src/
  components/    shell (TitleBar, NavRail), palette, app panel, primitives in ui/
  context/       single app store: settings, files, apps, users, storage, notifications
  data/          seed data for apps, files, users, disks, pools, notices
  hooks/         route (hash router), telemetry, persistence, click-outside
  lib/live.ts    client for /api/* with the demo fallback
server/          the live API: files, storage, system, users (node:http, no deps)
  styles/        global design system + one stylesheet per view
  views/         Dashboard, Files, AppStore, Storage, Settings
```
