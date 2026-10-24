#!/usr/bin/env bash
# Start what this container is for, then stay attached to the processes that
# matter. There is no systemd here, so nothing is "enabled": everything this
# image ships is started once, every time the container starts.
set -uo pipefail

log() { printf '[orion] %s\n' "$*" >&2; }

export ORION_ROOT="${ORION_ROOT:-/srv/storage}"
export ORION_BIND="${ORION_BIND:-127.0.0.1}"
export ORION_PORT="${ORION_PORT:-8099}"
HTTP_PORT="${ORION_HTTP_PORT:-8080}"
NAME="${ORION_NAME:-orion-nas}"

mkdir -p "$ORION_ROOT/Users" "$ORION_ROOT/.orion/trash"

# dbus is what avahi talks to, and avahi is what publishes orion-nas.local.
mkdir -p /run/dbus
if command -v dbus-daemon >/dev/null 2>&1; then
  dbus-daemon --system --fork >/dev/null 2>&1 || log "dbus did not start"
fi

if command -v avahi-daemon >/dev/null 2>&1; then
  sed -i "s/^#*host-name=.*/host-name=${NAME}/" /etc/avahi/avahi-daemon.conf 2>/dev/null || true
  grep -q "^host-name=${NAME}" /etc/avahi/avahi-daemon.conf 2>/dev/null \
    || sed -i "/^\[server\]/a host-name=${NAME}" /etc/avahi/avahi-daemon.conf 2>/dev/null || true
  avahi-daemon --daemonize --no-drop-root >/dev/null 2>&1 || log "avahi did not start"
fi

# Samba first writes its shares from the registry, which the API does on start;
# both daemons are started here so a fresh container serves as soon as it is up.
if command -v smbd >/dev/null 2>&1; then
  mkdir -p /var/lib/samba/private /var/log/samba /run/samba
  smbd --daemon >/dev/null 2>&1 || log "smbd did not start"
  nmbd --daemon >/dev/null 2>&1 || log "nmbd did not start"
fi

sed -i "s/__ORION_HTTP_PORT__/${HTTP_PORT}/; s/__ORION_PORT__/${ORION_PORT}/" \
  /etc/nginx/sites-available/orion 2>/dev/null
ln -sf /etc/nginx/sites-available/orion /etc/nginx/sites-enabled/orion

python3 /opt/orion/orion-api.py &
API=$!

nginx -g 'daemon off;' &
WEB=$!

shutdown() {
  log "stopping"
  kill -TERM "$WEB" "$API" 2>/dev/null
  smbcontrol smbd shutdown >/dev/null 2>&1 || pkill -TERM -x smbd 2>/dev/null
  pkill -TERM -x nmbd 2>/dev/null
  pkill -TERM -x avahi-daemon 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap shutdown INT TERM

# If either of the two processes this container exists for dies, the container
# dies with it and the restart policy takes over.
wait -n "$API" "$WEB"
log "a core process exited; stopping"
shutdown
