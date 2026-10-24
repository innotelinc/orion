# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app

# Dependencies are copied first so source-only edits reuse the npm layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# No nginx and no npm install here: the runtime is one dependency-free Node
# process that serves dist/ and reports on the host it is mounted into.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    ORION_PORT=8080 \
    ORION_ROOTS=/data

COPY --from=build /app/dist ./dist
COPY server ./server

# The declared mount point: `docker run -v /tank:/data:ro` is live with no config.
VOLUME ["/data"]
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --quiet --spider http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "server/index.mjs"]
