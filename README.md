# Orion

A NAS desktop for one Incus container: the files on its data volume, its
filesystems, the host's devices and the systemd units that serve it — read and
written through a small API, not invented in the browser.

The design is reconstructed from the ZimaOS web UI captured over the Chrome
DevTools Protocol at `127.0.0.1:9222`; the data is this machine's.

## What's here

- **Dashboard** — CPU, memory and interface rates sampled from `/proc` every two
  seconds by the API, uptime, volume capacity, running units and the files that
  changed most recently.
- **Files** — deep-linkable folders (`#/files?path=/files`), upload, new folder,
  rename, star, download, image preview and trash. Every action is a real
  filesystem call on `/srv/storage`.
- **Services** — the container's systemd units with live state. Start, stop and
  restart call `systemctl`; nothing here pretends to install anything.
- **Storage** — mounted filesystems with `statvfs` capacity and the block devices
  visible in `/sys/block`, labelled as host devices rather than pool members.
- **Settings** — host facts, network facts, Unix accounts, the forwarded SSO
  identity, and the build. Theme/accent/wallpaper/density are the only settings
  that persist, and they persist in this browser.
- **Command palette** (`⌘K` / `Ctrl+K`) — jump to a view, a file or an action.

## Run it

```bash
npm install
npm run dev      # http://127.0.0.1:5173, proxying /api to ORION_API
npm run build    # typecheck + production bundle
```

The dev server proxies `/api` to `http://127.0.0.1:8099` by default; set
`ORION_API` for another target and run `server/orion-api.py` alongside it.

### The API

`server/orion-api.py` is a stdlib-only HTTP service on `127.0.0.1:8099`:

| Route | Does |
| --- | --- |
| `GET /api/system` | hostname, kernel, runtime, CPU, memory, network, version, SSO identity |
| `GET /api/metrics` | latest sample plus 60 points of CPU/RAM/interface history |
| `GET /api/state` | file tree, volumes, devices, accounts, units, notices |
| `POST /api/files/{mkdir,rename,delete,star}` | filesystem mutations; deletes move to `.orion/trash` |
| `POST /api/files/content?path=&name=` | upload, streamed to disk |
| `GET /api/files/content?path=` | download, or `&inline=1` for previews |
| `POST /api/services` | start/stop/restart a unit |

It runs as `orion-api.service` and is only reachable through nginx.

## Deployment

The live copy is the `nas` Incus container (192.168.1.89) at
https://nas.innotel.us.

| Path | Serves |
| --- | --- |
| `/` | `web/landing/index.html` |
| `/app/` | the built desktop (`/var/www/orion`) |
| `/assets/` | fingerprinted bundles, cached for a year |
| `/api/` | `orion-api` on `127.0.0.1:8099` |
| `/health` | `ok` |

`deploy/nas.innotel.us.conf` is the vhost. It accepts only the edge proxy
(192.168.1.71) and localhost, so the container's port 80 is not a second way in.

### Publishing

```bash
npm run build
tar -C dist -cf - . | incus exec i1move:nas -- tar -C /var/www/orion -xf -
incus file push web/landing/index.html i1move:nas/var/www/orion-landing/index.html
incus file push server/orion-api.py i1move:nas/opt/orion/orion-api.py
incus file push deploy/orion-api.service i1move:nas/etc/systemd/system/orion-api.service
incus file push deploy/nas.innotel.us.conf i1move:nas/etc/nginx/sites-enabled/orion.conf
incus exec i1move:nas -- systemctl restart orion-api
```

Write `/opt/orion/version.json` (`{"version","build","builtAt"}`) during the
deploy; Settings → About reads it.

### Sign-in

`deploy/sso/` holds the edge pieces, run on the proxy host:

- `provision-authentik.py` — creates the `Orion NAS` OIDC provider and `orion`
  application in Authentik, and writes `/root/orion-sso/orion-sso.env` (0600).
- `docker-compose.yml` — oauth2-proxy on `192.168.1.71:14016`, allowed groups
  `Incus`, `Cerulean` and `authentik Admins`, upstream `http://192.168.1.89:80`,
  `/health` skipped.
- `point-npm.py` — repoints the NPM proxy host at the sign-in proxy, keeping its
  certificate.

The proxy forwards the signed-in address as `X-Auth-Request-Email`, which the API
shows as the current session. Settings → Users offers **Sign out**, and the landing
page's title bar carries the same link, so signing out never requires opening the
desktop. Both go to `/oauth2/sign_out` with Authentik's `end-session` flow as the
redirect: clearing only the proxy cookie signs the browser straight back in,
because the provider still remembers it.

Three things about that chain fail quietly, so they are part of the deploy rather
than something to rediscover:

- **The provider must allow `authorization_code`.** Authentik's API creates an
  OAuth2 provider with an empty `grant_types` when the field is omitted, and an empty
  list allows nothing: every authorize request comes back `error=invalid_request`
  before a login form is shown, and the proxy renders it as a 403. `provision-authentik.py`
  sets `authorization_code` and `refresh_token` and repairs a provider that has neither.
- **The id_token's email must be verified.** Authentik's stock `email` mapping returns
  `"email_verified": False`, which `oauth2-proxy` refuses; the callback dies with HTTP
  500 ("email in id_token … isn't verified"). The provider uses the estate's own `email`
  mapping — the one that says True — instead.
- **NPM needs bigger response-header buffers.** The callback's `Set-Cookie` carries the
  whole encrypted session, several kilobytes against nginx's 4k default. NPM logs
  `upstream sent too big header` and answers 502 *after* the sign-in worked.
  `point-npm.py` writes `proxy_buffer_size 16k` / `proxy_buffers 4 16k` into the host's
  Advanced config.

`deploy/sso/point-npm.py` and `provision-authentik.py` set all three, so a rebuilt host
is not signed-in-blind. Sign-in was verified end to end on 2026-10-24 — the public
hostname redirects to Authentik, the callback sets a session, and `/` and `/api/system`
both return 200 — using the break-glass account rather than a temporary one.

### Who can administer what

Authentik decides both who gets through the gate and who can administer the
directory, and those are deliberately two different lists:

- **The gate.** `oauth2-proxy` allows `Incus`, `Cerulean` and `authentik Admins`, so
  any Authentik administrator opens the NAS without also joining a host group.
- **The directory.** `authentik Admins` is the **only** group that may carry
  Authentik's superuser flag. A tenant group flagged that way makes its membership a
  global administrator grant in disguise — `plutus-admins` and `signara-admins` were
  until 2026-10-23, and the flag is cleared on both.
- **Break-glass.** The `akadmin` bootstrap account keeps its superuser rights and its
  single group, but its password was rotated on 2026-10-23 and the only copy is
  `/root/orion-sso/akadmin.pw` (0600) on the edge. It is not a daily-use login.
- **No machine with admin rights.** Every account that can administer the directory is
  a normal Authentik login (`type: internal`); outpost and client credentials hold no
  admin groups.

Two things watch that. `deploy/sso/authentik-audit.py` is the read-only human audit: who
is privileged, who is dormant, which group is the widest, and whether any non-human
account can administer the directory. The half-hourly `authentik_privilege` estate check
(`check-authentik-privilege.py` in the platform-stack repo, run by the Cerulean edge's
`estate-checks.timer`) turns the same rules into a failure: a superuser group other than
`authentik Admins`, a service account with admin rights, or a superuser unused for 90
days. A sign-in was verified end to end through Authentik's own flow on 2026-10-23; the
temporary account it used has been deleted.

## Verification

```bash
npm run typecheck
npm run build
node scripts/smoke-dom.mjs   # renders the bundle in jsdom against the live API
```

The smoke script reads `/api/system|state|metrics` from the container and checks
that the dashboard, files, services, storage and settings routes mount with no
runtime errors and no API banner.

## Stack

React 19, TypeScript, Vite, `lucide-react` icons, Space Grotesk (self-hosted via
`@fontsource-variable`). No UI framework — the design system is hand-rolled CSS in
`src/styles`, using the ZimaOS design DNA: 48px glass title bar, 310px widget rail,
5-column app grid, `rgba(53,54,58,.4)` frosted cards, blue `#0A63FF` accent.

## Structure

```
server/          orion-api.py — the machine's JSON surface
src/
  components/    shell (TitleBar, NavRail), palette, primitives in ui/
  context/       fetches the API, owns mutations, toasts and notification state
  data/          the four built-in pages, preference defaults, path helpers
  hooks/         hash router, persistence, click-outside
  views/         Dashboard, Files, AppStore (Services), Storage, Settings
deploy/          systemd unit, vhost, SSO provisioning
web/landing/     the landing page at /
```
