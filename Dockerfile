# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app

# Dependencies are copied first so source-only edits reuse the npm layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --quiet --spider http://127.0.0.1/ || exit 1
