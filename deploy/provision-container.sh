#!/usr/bin/env bash
# provision-container.sh — one paid order, one personal NAS.
#
# Called by orion-api's provisioning worker with the order already validated:
#
#   provision-container.sh --name orion-general-1a2b3c4d \
#       --volume orion-general-1a2b3c4d --size-gb 25 --plan general \
#       --email person@example.com
#
# It runs wherever the `incus` client can reach the host (on nas that is a
# remote named by ORION_INCUS_REMOTE, with INCUS_CONF pointing at the client
# certificate). The container it creates gets:
#
#   * a custom volume of the requested size, attached at /srv/storage;
#   * memory and CPU limits, so one customer cannot starve the host;
#   * nginx + orion-api + the built desktop, copied from this machine;
#   * Samba and avahi, which is what makes it a NAS rather than a web page;
#   * a one-time sign-in link, because a brand-new container is not in the
#     identity provider yet.
#
# Diagnostics go to stderr; exactly one JSON object goes to stdout, which the
# API records against the order. Re-running it repairs an existing container
# instead of building a second one — that is what makes a retry safe.
set -euo pipefail

REMOTE=${ORION_INCUS_REMOTE:-i1}
POOL=${ORION_INCUS_POOL:-incus}
IMAGE=${ORION_PROVISION_IMAGE:-images:debian/12}
DESKTOP=${ORION_PROVISION_DESKTOP:-/var/www/orion}
LANDING=${ORION_PROVISION_LANDING:-/var/www/orion-landing}
API=${ORION_PROVISION_API:-/opt/orion/orion-api.py}
MEMORY=${ORION_PROVISION_MEMORY:-1GiB}
CPUS=${ORION_PROVISION_CPU:-1}
SIZE_MAX=${ORION_PROVISION_MAX_GB:-100}

NAME=""
VOLUME=""
SIZE_GB=""
PLAN=""
EMAIL=""

say() { printf '%s\n' "$*" >&2; }
die() { say "provision: $*"; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) NAME=${2:-}; shift 2 ;;
    --volume) VOLUME=${2:-}; shift 2 ;;
    --size-gb) SIZE_GB=${2:-}; shift 2 ;;
    --plan) PLAN=${2:-}; shift 2 ;;
    --email) EMAIL=${2:-}; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" >&2; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$NAME" ] || die "--name is required"
[ -n "$VOLUME" ] || VOLUME=$NAME
[ -n "$SIZE_GB" ] || die "--size-gb is required"
[ -n "$PLAN" ] || die "--plan is required"
[ -n "$EMAIL" ] || die "--email is required"

# The name reaches incus as an argument and as a device name; keep it to the
# alphabet the API already derived it from rather than trusting the caller.
case "$NAME" in
  orion-[a-z]*-[0-9a-f]*) ;;
  *) die "container name must look like orion-<plan>-<hex>" ;;
esac
case "$VOLUME" in
  *[!a-z0-9-]*) die "volume name must be lowercase letters, digits and dashes" ;;
esac
case "$SIZE_GB" in
  ''|*[!0-9]*) die "--size-gb must be a whole number" ;;
esac
[ "$SIZE_GB" -ge 1 ] && [ "$SIZE_GB" -le "$SIZE_MAX" ] \
  || die "--size-gb must be between 1 and $SIZE_MAX"
case "$EMAIL" in
  *[!A-Za-z0-9._%+@-]*) die "--email is not an address" ;;
  *@*.*) ;;
  *) die "--email is not an address" ;;
esac

command -v incus >/dev/null 2>&1 || die "no incus client on this machine"

say "provision: $NAME ($PLAN, ${SIZE_GB}GB) on $REMOTE:$POOL"
incus info "$REMOTE:" >/dev/null || die "cannot reach the incus host '$REMOTE'"

# -- the volume -------------------------------------------------------------
# zfs takes a size directly. Other drivers may not, so a failure to set the
# size is reported but does not lose an otherwise usable volume.
if incus storage volume show "$REMOTE:$POOL" "$VOLUME" >/dev/null 2>&1; then
  say "provision: volume $VOLUME exists; keeping its data"
  incus storage volume set "$REMOTE:$POOL" "$VOLUME" size="${SIZE_GB}GB" \
    || say "provision: could not restate $VOLUME's size (driver without quotas?)"
else
  # A custom volume is the default type. `size=` is a pool property: zfs
  # honours it, a dir pool does not, so a driver that refuses the quota still
  # gets a usable volume rather than a failed order.
  incus storage volume create "$REMOTE:$POOL" "$VOLUME" \
    size="${SIZE_GB}GB" >/dev/null 2>&1 \
    || incus storage volume create "$REMOTE:$POOL" "$VOLUME" >/dev/null
  say "provision: created volume $VOLUME (${SIZE_GB}GB)"
fi

# -- the container ----------------------------------------------------------
if incus info "$REMOTE:$NAME" >/dev/null 2>&1; then
  say "provision: container $NAME exists; repairing it"
  incus start "$REMOTE:$NAME" >/dev/null 2>&1 || true
else
  incus launch "$IMAGE" "$REMOTE:$NAME" \
    -c limits.memory="$MEMORY" -c limits.cpu="$CPUS" >/dev/null
  say "provision: launched $NAME"
fi

# Attach the data volume, exactly once. `config device list` is a name list, so
# a re-run does not stack a second disk on the same path.
if ! incus config device list "$REMOTE:$NAME" | grep -qx "data"; then
  incus config device add "$REMOTE:$NAME" data disk \
    pool="$POOL" source="$VOLUME" path=/srv/storage >/dev/null
  say "provision: attached $VOLUME at /srv/storage"
fi

# A fresh container's systemd is not up the instant launch returns.
booted=0
for _ in $(seq 1 90); do
  if incus exec "$REMOTE:$NAME" -- true >/dev/null 2>&1; then
    booted=1
    break
  fi
  sleep 2
done
[ "$booted" = "1" ] || die "$NAME never came up"

# -- the software -----------------------------------------------------------
# One apt run for everything the desktop needs. nginx serves it, python3 is the
# API, samba is the actual NAS, avahi is how the LAN finds it.
say "provision: installing nginx, python3, samba and avahi"
incus exec "$REMOTE:$NAME" -- env DEBIAN_FRONTEND=noninteractive \
  sh -c 'apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    nginx python3 samba avahi-daemon ca-certificates curl >/dev/null' \
  >/dev/null

incus exec "$REMOTE:$NAME" -- mkdir -p \
  /var/www/orion /var/www/orion-landing /opt/orion /etc/orion /srv/storage

[ -d "$DESKTOP" ] || die "no built desktop at $DESKTOP"
[ -f "$API" ] || die "no API at $API"
incus file push -r "$DESKTOP/." "$REMOTE:$NAME/var/www/orion/" >/dev/null
incus file push "$API" "$REMOTE:$NAME/opt/orion/orion-api.py" >/dev/null
incus exec "$REMOTE:$NAME" -- chmod 0755 /opt/orion/orion-api.py
if [ -f "$LANDING/index.html" ]; then
  incus file push "$LANDING/index.html" "$REMOTE:$NAME/var/www/orion-landing/index.html" >/dev/null
fi
if [ -f "$LANDING/subscribe.html" ]; then
  incus file push "$LANDING/subscribe.html" "$REMOTE:$NAME/var/www/orion-landing/subscribe.html" >/dev/null
fi

# Secrets for this container only. The session secret signs its cookies; the
# claim secret signs the one-time link its buyer was handed.
SESSION_SECRET=$(openssl rand -hex 32)
CLAIM_SECRET=$(openssl rand -hex 32)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/orion-api.service" <<UNIT
[Unit]
Description=Orion API — files, storage and system facts for this NAS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/orion/orion-api.py
Environment=ORION_ROOT=/srv/storage
Environment=ORION_BIND=127.0.0.1
Environment=ORION_PORT=8099
Environment=ORION_PLAN=$PLAN
Environment=ORION_STORAGE_GB=$SIZE_GB
Environment=ORION_SESSION_SECRET=$SESSION_SECRET
Environment=ORION_CLAIM_SECRET=$CLAIM_SECRET
# This server answers on plain HTTP on the LAN until Cerulean gives it a name
# and a certificate; a Secure cookie there is one the browser would discard.
Environment=ORION_COOKIE_SECURE=0
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
UNIT

cat > "$TMP/orion.conf" <<'VHOST'
# This container's own door. No edge proxy in front of a personal server: the
# LAN reaches it directly, and Orion's /auth/claim link is how its buyer signs
# in the first time.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/orion-landing;
    index index.html;
    charset utf-8;
    server_tokens off;
    client_max_body_size 2g;

    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location = /health {
        access_log off;
        proxy_pass http://127.0.0.1:8099/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 10s;
    }

    location = /app { return 301 /app/; }

    location = /app/ {
        root /var/www;
        try_files /orion/index.html =404;
        add_header Cache-Control "no-cache";
    }

    location /app/ {
        alias /var/www/orion/;
        try_files $uri =404;
    }

    location /assets/ {
        alias /var/www/orion/assets/;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    location = /subscribe {
        try_files /subscribe.html =404;
        add_header Cache-Control "no-cache";
    }

    location /auth/ {
        proxy_pass http://127.0.0.1:8099;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8099;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ /index.html;
    }
}
VHOST

incus file push "$TMP/orion-api.service" "$REMOTE:$NAME/etc/systemd/system/orion-api.service" >/dev/null
incus file push "$TMP/orion.conf" "$REMOTE:$NAME/etc/nginx/sites-available/orion.conf" >/dev/null
incus exec "$REMOTE:$NAME" -- sh -c '
  set -e
  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/orion.conf /etc/nginx/sites-enabled/orion.conf
  nginx -t
  systemctl daemon-reload
  systemctl enable --now orion-api nginx >/dev/null 2>&1
  systemctl restart orion-api nginx
' >/dev/null

# -- is it actually serving? ------------------------------------------------
serving=0
for _ in $(seq 1 30); do
  if incus exec "$REMOTE:$NAME" -- curl -fsS -m 5 http://127.0.0.1/health >/dev/null 2>&1; then
    serving=1
    break
  fi
  sleep 2
done
[ "$serving" = "1" ] || die "$NAME started but its desktop does not answer /health"

# `incus list <remote>:` takes a remote, not an instance, so ask it for the
# table and pick this container out of it; the instance's own answer is the
# fallback when the list has not caught up with the launch yet.
ADDRESS=$(incus list "$REMOTE:" --format csv -c n,4 2>/dev/null \
  | awk -F, -v want="$NAME" '$1 == want { print $2 }' | head -n 1 \
  | awk '{ print $1 }')
[ -n "$ADDRESS" ] || ADDRESS=$(incus exec "$REMOTE:$NAME" -- hostname -I | awk '{ print $1 }')
[ -n "$ADDRESS" ] || die "$NAME has no address to hand out"

# The claim command signs with the container's own secret, which lives in its
# unit rather than in this shell's environment.
SIGNIN=$(incus exec "$REMOTE:$NAME" -- env ORION_CLAIM_SECRET="$CLAIM_SECRET" \
  python3 /opt/orion/orion-api.py --claim "$EMAIL" "http://$ADDRESS")

# Exactly one JSON object on stdout; orion-api records it against the order.
NAME="$NAME" VOLUME="$VOLUME" SIZE_GB="$SIZE_GB" PLAN="$PLAN" EMAIL="$EMAIL" \
ADDRESS="$ADDRESS" REMOTE="$REMOTE" POOL="$POOL" SIGNIN="$SIGNIN" \
python3 - <<'JSON'
import json, os
env = os.environ
print(json.dumps({
    "container": env["NAME"],
    "volume": env["VOLUME"],
    "sizeGb": int(env["SIZE_GB"]),
    "plan": env["PLAN"],
    "email": env["EMAIL"],
    "address": env["ADDRESS"],
    "remote": env["REMOTE"],
    "pool": env["POOL"],
    "share": f"//{env['ADDRESS']}",
    "app": f"http://{env['ADDRESS']}/app/",
    "signIn": env["SIGNIN"],
}))
JSON
