#!/usr/bin/env bash
# Install Orion on a Linux server as a Docker container.
#
#   ./install.sh                    # data in /srv/orion, desktop on :8080
#   ./install.sh --sso              # same, plus oauth2-proxy in front
#   ORION_DATA=/mnt/tank/orion ORION_HTTP_PORT=9000 ./install.sh
#
# Re-running it is the upgrade path: it rebuilds the image and recreates the
# container, leaving the data volume alone.
set -euo pipefail

DATA_DIR="${ORION_DATA:-/srv/orion}"
HTTP_PORT="${ORION_HTTP_PORT:-8080}"
NAME="${ORION_NAME:-orion-nas}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSO=0

for arg in "$@"; do
  case "$arg" in
    --sso) SSO=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'install: unknown argument %s\n' "$arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }

say "Checking Docker"
command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon; run this as root or from a user in the docker group"
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die "the Docker Compose plugin is missing (docker compose version failed)"
fi

say "Preparing $DATA_DIR"
# Users holds one folder per space; media is the read-only share that every
# SMB account also mounts.
mkdir -p "$DATA_DIR/Users" "$DATA_DIR/media" "$DATA_DIR/.orion/trash"
chmod 755 "$DATA_DIR"

ENV_FILE="$HERE/.env"
if [ ! -f "$ENV_FILE" ]; then
  say "Writing .env"
  {
    echo "# This install. Keep it out of git."
    echo "ORION_DATA=$DATA_DIR"
    echo "ORION_HTTP_PORT=$HTTP_PORT"
    echo "ORION_NAME=$NAME"
    echo ""
    echo "# Sign-in (./install.sh --sso). Register ${ORION_PUBLIC_URL:-https://your.host}/oauth2/callback"
    echo "# as the redirect URI at your provider, then fill these in."
    echo "#ORION_PUBLIC_URL=https://nas.example.com"
    echo "#ORION_SSO_PORT=4180"
    echo "#ORION_SSO_BIND=127.0.0.1"
    echo "#OIDC_ISSUER_URL=https://auth.example.com/application/o/orion/"
    echo "#OIDC_CLIENT_ID="
    echo "#OIDC_CLIENT_SECRET="
  } > "$ENV_FILE"
fi

# Values in .env win over the environment, which is what an operator expects
# after editing it once.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
DATA_DIR="${ORION_DATA:-$DATA_DIR}"
HTTP_PORT="${ORION_HTTP_PORT:-$HTTP_PORT}"
NAME="${ORION_NAME:-$NAME}"

FILES=(-f "$HERE/docker-compose.yml")
if [ "$SSO" = "1" ]; then
  for key in ORION_PUBLIC_URL OIDC_ISSUER_URL OIDC_CLIENT_ID OIDC_CLIENT_SECRET; do
    if [ -z "${!key:-}" ]; then
      die "$key is empty in .env; a sign-in proxy cannot start without it"
    fi
  done
  if [ -z "${OIDC_COOKIE_SECRET:-}" ]; then
    say "Generating OIDC_COOKIE_SECRET"
    secret=$(openssl rand -base64 32 | tr -d '\n')
    printf '\nOIDC_COOKIE_SECRET=%s\n' "$secret" >> "$ENV_FILE"
    export OIDC_COOKIE_SECRET="$secret"
  fi
  FILES+=(-f "$HERE/docker-compose.sso.yml")
fi

say "Building the image"
"${COMPOSE[@]}" "${FILES[@]}" --project-directory "$HERE" build

say "Starting"
"${COMPOSE[@]}" "${FILES[@]}" --project-directory "$HERE" up -d

# With sign-in on, the app itself is only reachable on loopback behind the
# proxy; check the front door, not the locked one.
if [ "$SSO" = "1" ]; then
  PROBE="http://127.0.0.1:${ORION_SSO_PORT:-4180}/health"
  FRONT="http://127.0.0.1:${ORION_SSO_PORT:-4180}/"
else
  PROBE="http://127.0.0.1:${HTTP_PORT}/health"
  FRONT="http://127.0.0.1:${HTTP_PORT}/"
fi

say "Waiting for the front door"
for _ in $(seq 1 30); do
  if curl -fsS -m 2 "$PROBE" >/dev/null 2>&1; then
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
  say "Started, but nothing answered yet — check: docker logs orion"
fi

cat <<EOF

  Desktop     ${FRONT}
  Data        ${DATA_DIR}  (container path /srv/storage)
  Shares      \\\\${NAME^^}\\<space>   smb://${NAME}.local/<space>
  Discovery   ${NAME}.local over mDNS, ${NAME^^} over NetBIOS

EOF

if [ "$SSO" = "1" ]; then
  cat <<EOF
  Sign-in     ${ORION_PUBLIC_URL} → proxy on :${ORION_SSO_PORT:-4180} → app on :${HTTP_PORT}
              redirect URI to register: ${ORION_PUBLIC_URL}/oauth2/callback
              point your public vhost at the proxy, not at the app

EOF
else
  cat <<EOF
  Sign-in     off. Anyone who can reach :${HTTP_PORT} sees the desktop.
              Re-run with --sso (see .env) to put a proxy in front.

EOF
fi

cat <<EOF
  Logs        docker logs -f orion        (and: docker logs -f orion-sso)
  Update      ./install.sh$( [ "$SSO" = "1" ] && echo " --sso" )
  Stop        docker compose down
EOF
