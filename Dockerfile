# syntax=docker/dockerfile:1
#
# Orion as one container: the built desktop, the API, nginx, Samba and avahi.
# The image has no systemd; docker/entrypoint.sh starts each daemon and keeps
# the container alive on the ones that matter.

FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    ORION_ROOT=/srv/storage \
    ORION_BIND=127.0.0.1 \
    ORION_PORT=8099 \
    ORION_HTTP_PORT=8080 \
    ORION_NAME=orion-nas

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      nginx python3 samba avahi-daemon dbus tini curl ca-certificates wsdd \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/nginx/sites-enabled/default

COPY --from=web /app/dist /var/www/orion
COPY server/orion-api.py /opt/orion/orion-api.py
COPY docker/nginx.conf /etc/nginx/sites-available/orion
COPY docker/entrypoint.sh /usr/local/bin/orion-entrypoint
RUN chmod +x /usr/local/bin/orion-entrypoint \
 && mkdir -p /srv/storage /var/www/orion

VOLUME ["/srv/storage"]
EXPOSE 8080 445 139 5353/udp 3702/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${ORION_HTTP_PORT}/api/state" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/orion-entrypoint"]
