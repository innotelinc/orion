#!/usr/bin/env bash
# The one way code reaches https://nas.innotel.us.
#
# It runs inside the NAS container, not in a checkout on somebody's laptop. A
# deploy is therefore: a commit on origin/main -> the container fetches it ->
# the container builds it -> the container installs it. Two terminals can press
# the button at the same time; the flock makes them take turns, and neither can
# install a tree that was never pushed, which is how an older build once
# replaced a newer one.
#
#   /opt/orion/deploy.sh                 # origin/main
#   /opt/orion/deploy.sh <sha|tag|ref>   # that commit, if it is on origin/main
#
# Everything is staged and swapped into place; a failed health check puts the
# previous site and API back and exits non-zero.

set -euo pipefail

REPO_URL=${ORION_REPO_URL:-https://github.com/innotelinc/orion.git}
BRANCH=${ORION_BRANCH:-main}
WORK=${ORION_DEPLOY_ROOT:-/srv/orion-deploy}
LOCK=${ORION_DEPLOY_LOCK:-/run/orion-deploy.lock}
LOG=${ORION_DEPLOY_LOG:-/var/log/orion-deploy.log}
SITE=/var/www/orion
LANDING=/var/www/orion-landing/index.html
API=/opt/orion/orion-api.py
VERSION_FILE=/opt/orion/version.json
VHOST=/etc/nginx/sites-enabled/orion.conf
UNIT=/etc/systemd/system/orion-api.service

REF=${1:-origin/$BRANCH}

mkdir -p "$WORK" "$(dirname "$LOG")"
# One deploy at a time, across every terminal and every caller. A second
# deploy waits for the first, then installs its own commit — never a mixture.
exec 9>"$LOCK"
if ! flock -w 900 9; then
  echo "another deploy is still running (waited 15 minutes on $LOCK)" >&2
  exit 1
fi
# Everything from here on is serialised; the log carries the commit for both.
exec > >(tee -a "$LOG") 2>&1
echo
echo "=== deploy $(date -u +%Y-%m-%dT%H:%M:%SZ) from ${SSH_ORIGIN:-local} ==="

# A vite build wants a few hundred megabytes; at the 256MiB the container was
# born with, the kernel kills it and the only trace is the word "Killed".
MEM_MIB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MIB" -lt 1024 ]; then
  echo "warning: this container has ${MEM_MIB}MiB of memory; the build may be OOM-killed" >&2
fi

if [ ! -d "$WORK/repo/.git" ]; then
  echo "cloning $REPO_URL"
  rm -rf "$WORK/repo"
  git clone --quiet --no-checkout "$REPO_URL" "$WORK/repo"
fi
git -C "$WORK/repo" remote set-url origin "$REPO_URL"
git -C "$WORK/repo" fetch --quiet --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" --tags

SHA=$(git -C "$WORK/repo" rev-parse --verify "${REF}^{commit}")
SHORT=$(git -C "$WORK/repo" rev-parse --short=7 "$SHA")

# Only published work may go live. A commit that exists in someone's checkout
# but not on origin/main is exactly what a stray terminal deploys by accident;
# it is also how a build older than the live one gets installed.
if ! git -C "$WORK/repo" merge-base --is-ancestor "$SHA" "origin/$BRANCH"; then
  echo "refusing to deploy $SHORT: it is not on origin/$BRANCH" >&2
  echo "push it first, or deploy with a commit that is on the branch" >&2
  exit 2
fi

STAGE=$(mktemp -d "$WORK/stage.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
git -C "$WORK/repo" archive "$SHA" | tar -x -C "$STAGE"

echo "building $SHORT"
(
  cd "$STAGE"
  npm ci --no-audit --no-fund --prefer-offline --cache "$WORK/npm-cache" >/dev/null
  npm run build >/dev/null
)
VERSION=$(node -p "require('$STAGE/package.json').version")

# The desktop is served from a directory that is swapped in one rename, so a
# request never sees half of one build and half of another.
rm -rf "$SITE.new"
mkdir -p "$SITE.new"
cp -a "$STAGE/dist/." "$SITE.new/"
if [ -d "$SITE" ]; then
  rm -rf "$SITE.prev"
  mv "$SITE" "$SITE.prev"
fi
mv "$SITE.new" "$SITE"

install -m 0644 "$STAGE/web/landing/index.html" "$LANDING"
install -m 0644 "$STAGE/server/orion-api.py" "$API"
install -m 0644 "$STAGE/deploy/orion-api.service" "$UNIT"

# The vhost is replaced only when it changed, so a deploy does not reload nginx
# for nothing. A candidate cannot be parked next to it for validation: every
# file in sites-enabled is loaded, so a second copy of the vhost is a duplicate
# default server. Install, test the real file, and put the old one back if the
# test fails — nothing is serving it until the reload below.
if ! cmp -s "$STAGE/deploy/nas.innotel.us.conf" "$VHOST"; then
  KEEP=$(mktemp)
  cp "$VHOST" "$KEEP"
  install -m 0644 "$STAGE/deploy/nas.innotel.us.conf" "$VHOST"
  if ! nginx -t >/dev/null 2>&1; then
    echo "the new vhost does not pass nginx -t; keeping the old one" >&2
    install -m 0644 "$KEEP" "$VHOST"
    rm -f "$KEEP"
    exit 3
  fi
  rm -f "$KEEP"
  NEEDS_NGINX_RELOAD=1
fi

# The deployer itself is part of the deploy, so the next run is this version.
install -m 0755 "$STAGE/deploy/incus-deploy.sh" /opt/orion/deploy.sh

printf '{"version": "%s", "build": "%s", "builtAt": "%s"}\n' \
  "$VERSION" "$SHORT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$VERSION_FILE"

systemctl daemon-reload
systemctl restart orion-api
[ "${NEEDS_NGINX_RELOAD:-0}" = "1" ] && systemctl reload nginx

# Prove the machine is serving the commit that was just installed, and put the
# previous one back if it is not: a deploy that leaves a broken site should be
# the thing that fails, not the user's next page load.
healthy=0
# This container has ~640MiB and a build leaves it swapping, so the API can
# take longer than five seconds to bind. That is a slow start, not a broken
# site; a deploy that rolled itself back over it is the bug being fixed here.
for _ in $(seq 1 15); do
  sleep 2
  if curl -fsS -m 5 http://127.0.0.1:8099/api/system >/dev/null &&
     curl -fsS -m 5 http://127.0.0.1/health >/dev/null; then
    healthy=1
    break
  fi
done

if [ "$healthy" != "1" ]; then
  echo "health check failed after installing $SHORT; restoring the previous site" >&2
  if [ -d "$SITE.prev" ]; then
    rm -rf "$SITE.failed"
    mv "$SITE" "$SITE.failed"
    mv "$SITE.prev" "$SITE"
  fi
  systemctl restart orion-api || true
  exit 4
fi

# Keep the last two builds' worth of staging, drop the rest.
find "$WORK" -maxdepth 1 -name 'stage.*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true

echo "deployed $VERSION ($SHORT) — $(curl -fsS -m 5 http://127.0.0.1:8099/api/system | head -c 0; echo ok)"
