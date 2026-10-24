#!/usr/bin/env bash
# Deploy Orion from any machine by handing the job to the container.
#
# The container is the only thing that builds and installs the site, so what is
# live is always a commit on origin/main — never a working tree. Run this after
# `git push`:
#
#   scripts/deploy.sh            # origin/main
#   scripts/deploy.sh <sha>      # a specific published commit
#
# It needs a way to reach the incus host: either `incus` itself on this machine,
# or ORION_DEPLOY_SSH naming an ssh target that has it, for example
#   ORION_DEPLOY_SSH=root@192.168.1.51 scripts/deploy.sh

set -euo pipefail

REMOTE=${ORION_CONTAINER:-nas}
ENTRY=/opt/orion/deploy.sh

args=$(printf ' %q' "$@")

if command -v incus >/dev/null 2>&1; then
  exec incus exec "$REMOTE" -- "$ENTRY" "$@"
fi

if [ -n "${ORION_DEPLOY_SSH:-}" ]; then
  exec ssh "$ORION_DEPLOY_SSH" "incus exec $REMOTE -- $ENTRY$args"
fi

cat >&2 <<'EOF'
No route to the NAS container from this machine.

  * on the incus host:            scripts/deploy.sh
  * from a laptop, over ssh:      ORION_DEPLOY_SSH=root@<incus-host> scripts/deploy.sh

This box has no incus CLI and ORION_DEPLOY_SSH is unset.
EOF
exit 1
