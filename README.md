# Orion

A clean, robust, plug-and-play NAS desktop — reconstructed from the ZimaOS web UI captured over the Chrome DevTools Protocol at `127.0.0.1:9222`.

## What's here

- **Dashboard** — live CPU / memory / network telemetry, app grid, notices, recent activity, drop-to-upload.
- **Files** — deep-linkable folders (`#/files?path=/Documents`), instant search, multi-select, upload, rename, delete, star, details drawer.
- **App Store** — one-click installs with real progress, category filters, installed/updating states, container details, uninstall confirmation.
- **Storage** — pool capacity, disk health and SMART scans, plus a validated add-disk / expand-pool wizard.
- **Settings** — appearance (theme, accent, wallpaper, density, motion), network, users, security, and a reset-safe About tab.
- **Command palette** (`⌘K` / `Ctrl+K`) — jump to any view, folder, app or action.

Everything persists to `localStorage` and every mutation runs through one reducer-style context, so reloads, deep links and error boundaries behave predictably.

## Run it

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # typecheck + production bundle
```

## Stack

React 19, TypeScript, Vite, `lucide-react` icons, Space Grotesk (self-hosted via `@fontsource-variable`). No UI framework — the design system is hand-rolled CSS in `src/styles`, using the ZimaOS design DNA: 48px glass title bar, 310px widget rail, 5-column app grid, `rgba(53,54,58,.4)` frosted cards, blue `#0A63FF` accent.

## Structure

```
src/
  components/    shell (TitleBar, NavRail), palette, app panel, primitives in ui/
  context/       single app store: settings, files, apps, users, storage, notifications
  data/          seed data for apps, files, users, disks, pools, notices
  hooks/         route (hash router), telemetry, persistence, click-outside
  styles/        global design system + one stylesheet per view
  views/         Dashboard, Files, AppStore, Storage, Settings
```
