#!/usr/bin/env bash
# Install Orion on a Linux server as a Docker container.
#
#   ./install.sh                  # data in /srv/orion, desktop on :8080
#   ORION_DATA=/mnt/tank/orion ORION_HTTP_PORT=9000 ./install.sh
#
# Re-running it is the upgrade path: it rebuilds the image and recreates the
# container, leaving the data volume alone.
set -euo pipefail

DATA_DIR="${ORION_DATA:-/srv/orion}"
HTTP_PORT="${ORION_HTTP_PORT:-8080}"
NAME="${ORION_NAME:-orion-nas}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }

say "Checking Docker"
command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon; run this with a user in the docker group (or as root)"
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die "the Docker Compose plugin is missing (docker compose version failed)"
fi

if [ "$(id -u)" -ne 0 ] && ! docker ps >/dev/null 2>&1; then
  die "this account cannot manage containers"
fi

say "Preparing $DATA_DIR"
# Users holds one folder per space; media is the read-only share every SMB
# account in orion-nas can also mount.
mkdir -p "$DATA_DIR/Users" "$DATA_DIR/media" "$DATA_DIR/.orion/trash"
# The container runs as root and owns the space registry; the folders inside
# are chowned per space by the API.
chmod 755 "$DATA_DIR"

if [ ! -f "$HERE/.env" ]; then
  say "Writing .env"
  {
    echo "# Paths and ports this install uses. Keep it out of git."
    echo "ORION_DATA=$DATA_DIR"
    echo "ORION_HTTP_PORT=$HTTP_PORT"
    echo "ORION_NAME=$NAME"
  } > "$HERE/.env"
fi

say "Building the image"
"${COMPOSE[@]}" -f "$HERE/docker-compose.yml" --project-directory "$HERE" build

say "Starting"
"${COMPOSE[@]}" -f "$HERE/docker-compose.yml" --project-directory "$HERE" up -d

say "Waiting for the API"
for _ in $(seq 1 30); do
  if curl -fsS -m 2 "http://127.0.0.1:${HTTP_PORT}/api/state" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
printf '\n'
if [ "${ready:-0}" = "1" ]; then
  say "Orion is up"
else
  say "Orion started but the API has not answered yet — check: docker logs orion"
fi
cat <<EOF

  Desktop     http://${IP:-<server>}:${HTTP_PORT}/
  API         http://${IP:-<server>}:${HTTP_PORT}/api/state
  Data        ${DATA_DIR}  (container path /srv/storage)
  Shares      \\\\${NAME^^}\\<space>   smb://${NAME}.local/<space>
  Discovery   ${NAME}.local over mDNS, ${NAME^^} over NetBIOS

  Logs        docker logs -f orion
  Update      ./install.sh   (rebuilds, keeps the data)
  Stop        docker compose down

Sign-in is not part of this container: put it behind your own reverse proxy
(oauth2-proxy in front of port ${HTTP_PORT}) and the identity arrives as
X-Auth-Request-Email. See deploy/sso/ for the configuration this project uses.
EOF
