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
- **Spaces** — every person gets a folder under `/srv/storage/Users`, created or
  removed in Settings → Users and browsable like any other folder. A space is a
  folder, not a session: there is no sign-in or logout attached to it.
- **App Store** — the NAS stack at the top (nginx, orion-api, smbd), the apps
  this container can really install with apt, and the systemd units behind them
  with start, stop and restart. Nothing is simulated: dpkg decides whether an app
  is present and systemd decides whether it answers.
- **SMB** — one authenticated Samba share per space plus the media library
  read-only. Accounts are the spaces; the password lives in Samba, never in
  Orion.
- **Storage** — mounted filesystems with `statvfs` capacity and the block devices
  visible in `/sys/block`, labelled as host devices rather than pool members.
- **Settings** — host facts, network facts, user spaces, Unix accounts, the
  forwarded SSO identity, and the build. Theme/accent/wallpaper/density are the
  only settings that persist, and they persist in this browser.
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
| `GET /api/state` | file tree, volumes, devices, accounts, spaces, units, notices |
| `POST /api/files/{mkdir,rename,delete,star}` | filesystem mutations; deletes move to `.orion/trash` |
| `POST /api/files/content?path=&name=` | upload, streamed to disk |
| `GET /api/files/content?path=` | download, or `&inline=1` for previews |
| `POST /api/services` | start/stop/restart a unit |
| `POST /api/apps` | install or remove a catalogue app with apt |
| `POST /api/users/{slug}/password` | create or reset that space's Samba account |
| `POST /api/users` | create a person's folder and record it in `.orion/spaces.json` |
| `DELETE /api/users/{slug}` | move that folder to `.orion/trash` and forget it |

A space is a directory: `/srv/storage/Users/<slug>`, named from the person with a
numeric suffix when two people share a name. Removing one goes through Trash like
any other delete, so a mistaken removal is recoverable. Deleting the folder in
Files instead leaves the registry entry behind, and the API drops the stale entry
the next time it builds `/api/state`.

It runs as `orion-api.service` and is only reachable through nginx.

### Apps and SMB

`POST /api/apps` installs one of three catalogue entries with apt: **SMB sharing**
(`samba`), **NFS server** (`nfs-kernel-server`) and **network discovery**
(`avahi-daemon`). Only catalogue ids are accepted — the endpoint does not take a
package name from the browser.

The service is `ProtectSystem=strict`, which is what keeps a bug here out of
`/etc`. apt, `useradd` and `smbpasswd` genuinely need that access, so each change
runs in a transient unit via `systemd-run`: the daemon's privileges, none of its
sandbox, and a unit name (`orion-provision-*`) that shows up in the journal if a
change is ever reviewed.

SMB shares come from the spaces list, so adding a person with a password creates
their Unix account (no shell, home set to their folder), adds it to the
`orion-nas` group, sets the Samba password and rewrites `/etc/samba/smb.conf`
from the registry. The original file is kept once as
`/etc/samba/smb.conf.orion-backup`. Each share is fixed to its owner and the media
library is exported read-only to the group. Removing a space removes its account
and share; removing the SMB app takes every account with it, and files stay.

### The name on the LAN

Mounting by address works, but the box answers to a name too. Samba registers
`ORION-NAS` over NetBIOS (`netbios aliases = nas` keeps the old name working),
so Windows reaches `\\ORION-NAS\<space>`. Installing **network discovery**
publishes `_smb._tcp` through avahi and pins `host-name=orion-nas` in
`/etc/avahi/avahi-daemon.conf`, so Finder, GNOME and macOS mount
`smb://orion-nas.local/<space>`. Both come from the app rather than a hand edit,
so a rebuilt container gets them back by installing the app again.

## Deployment

Two shapes are supported: a Docker container on a plain Linux server, and the
Incus container that serves https://nas.innotel.us today.

### Docker on a Linux server

```bash
./install.sh                                  # /srv/orion on :8080
ORION_DATA=/mnt/tank/orion ORION_HTTP_PORT=9000 ./install.sh
```

The image is built from `Dockerfile` (the desktop compiled in a Node stage, then
nginx, the API, Samba and avahi on Ubuntu). `docker/entrypoint.sh` starts those
daemons because the container has no systemd, and the API runs its privileged
steps directly when `/run/systemd/system` is absent — the same code paths serve
both shapes. `docker-compose.yml` uses `network_mode: host` so mDNS has a real
LAN and SMB is reachable; only the HTTP port needs to be free.

### Sign-in

The image itself has no login. `docker-compose.sso.yml` adds oauth2-proxy in
front of it, which is the same shape the live estate runs:

```
browser → your vhost (TLS) → orion-sso :4180 → orion :8080 → /api → orion-api
```

The proxy authenticates against your OIDC provider and passes the identity as
`X-Auth-Request-Email` / `-User` / `-Groups`; nginx hands those to the API, which
is what Settings → Security shows and what the desktop greets you by. Nothing in
the app reads a password or a token.

```bash
./install.sh --sso
```

Register `https://<your host>/oauth2/callback` at the provider first. Then fill
in `.env`:

| Key | Meaning |
| --- | --- |
| `ORION_PUBLIC_URL` | the public origin, e.g. `https://nas.example.com` |
| `OIDC_ISSUER_URL` | the provider's discovery URL, e.g. `https://auth.example.com/application/o/orion/` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | the confidential client |
| `ORION_SSO_PORT` | where the proxy listens (default 4180) |
| `ORION_SSO_BIND` | `127.0.0.1` by default; set `0.0.0.0` only if the public vhost is another machine |
| `OIDC_ALLOWED_GROUP` | optional: refuse anyone outside this provider group |

With sign-in on, point the public vhost at the proxy port and leave the app's
`:8080` on loopback. Two details cost an afternoon if missed:

- The proxy sends `prompt=login` on every authorize request. A provider session
  outlives the proxy cookie, so without it a signed-out browser is let straight
  back in and sign-out appears to do nothing.
- The id_token's `email` must be marked verified, or oauth2-proxy refuses the
  callback with a 500 while the log says the address is unverified. Authentik's
  stock mapping says false; `deploy/sso/provision-authentik.py` names the mapping
  that says true.

Authentik specifics are in `deploy/sso/`: the provider is OAuth2/OpenID with
client type *confidential*, the grant types are `authorization_code` and
`refresh_token`, and the groups claim is `groups`. Other providers work the same
way — the only thing Orion requires is a group or email claim it can display.

### Incus (the live instance)

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

The proxy forwards the signed-in address as `X-Auth-Request-Email`. The API shows
it as the current session, and the landing page's title bar prints it once
`/api/system` answers. Settings → Users offers **Sign out**, and the
landing page carries the same link in that bar, so signing out never requires
opening the desktop. Both go to `/oauth2/sign_out` with Authentik's `end-session`
flow as the redirect: clearing only the proxy cookie signs the browser straight
back in, because the provider still remembers it.

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

Every signed-in visitor sees the same desktop and every space in it. A space groups
one person's files; it does not hide them from the others. Removing a space from
Settings does not end anyone's session either — sign out at the edge does that.

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
  views/         Dashboard, Files, AppStore (apps and units), Storage, Settings
deploy/          systemd unit, vhost, SSO provisioning
web/landing/     the landing page at /
```
