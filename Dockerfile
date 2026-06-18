# syntax=docker/dockerfile:1

# Multi-stage build for the CS Demo Analyzer SPA.
#   1. deps  -> restore the pnpm store (cached, rarely invalidated)
#   2. build -> compile the Vue/Vite app into static assets
#   3. final -> serve those assets with a tiny Node static server on $PORT
# The Rust/WASM parser is already committed, so no Rust toolchain is needed here.

# ---- 1. Dependencies ---------------------------------------------------------
# Isolated so this layer only rebuilds when manifests or the lockfile change.
FROM node:24-slim AS deps
WORKDIR /app

# corepack ships with Node and pins pnpm from the root "packageManager" field.
RUN corepack enable

# Copy only what affects dependency resolution to maximize layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/app/package.json apps/app/

# A persistent BuildKit cache mount keeps the pnpm store warm across builds.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- 2. Build ----------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable

# Reuse the already-installed node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/app/node_modules ./apps/app/node_modules
COPY . .

# Turbo runs the app build; the prebuild hook syncs the zstd .wasm into public/.
# Output lands in apps/app/dist.
RUN pnpm build

# ---- 3. Runtime --------------------------------------------------------------
# Minimal Node image: a tiny dependency-free server (server.mjs) serves ./dist
# with SPA history fallback and the correct application/wasm MIME type. No npm
# install needed at runtime, so the Alpine base keeps the image small.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Port Traefik/Dokploy routes to. Override with -e PORT=... if needed.
ENV PORT=5174

COPY server.mjs ./
COPY --from=build /app/apps/app/dist ./dist

EXPOSE 5174
CMD ["node", "server.mjs"]
