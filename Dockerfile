# Ascent — self-hosting image.
#
#   docker compose --profile app up -d      # app + Postgres, http://localhost:3000
#   docker build -t ascent . && docker run -p 3000:3000 ascent
#
# Three stages so the runtime image carries neither the toolchain nor the dev dependencies. The
# build sets ASCENT_DOCKER_BUILD=1, which is the ONLY thing that flips next.config.ts to
# `output: "standalone"` — Vercel does its own tracing, so that mode is a container concern and
# must not change how cloud deploys are packaged.
#
# Ascent runs with no configuration at all (deterministic mock scoring, no database). To get real
# scores, pass an LLM provider; to get history and the org dashboards, pass DATABASE_URL. See
# docs/SELF-HOSTING.md and .env.example.

# NODE 24, not the older LTS: package-lock.json is a v3 lockfile written by npm 11, and npm 10
# (which node:22-alpine ships) resolves that tree differently — `npm ci` fails outright with a wall of
# "Missing: … from lock file". The image must match the toolchain the lockfile was generated with, so
# bumping this base image is a real decision, not a cosmetic one: change it and re-verify `npm ci`.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
# Prisma's engines need libc compatibility on Alpine.
RUN apk add --no-cache libc6-compat
# Copy the manifests and the schema together: `postinstall` runs `prisma generate`, which fails
# without prisma/schema.prisma present. `npm ci` needs the lockfile to be authoritative.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV ASCENT_DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
# The build must not need secrets. Every integration in Ascent degrades to a clean no-op when its
# env is absent, so an image built with nothing configured is a working image — the operator supplies
# configuration at `docker run` time, not at build time.
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# This image IS a self-hosted deployment: no plan tiers enforced, no scan metering, no retention
# floor, and the `claude-cli` provider permitted (NODE_ENV is production here, and the CLI gate would
# otherwise refuse). An operator running Ascent Cloud from this image would set ASCENT_SELF_HOSTED=0.
ENV ASCENT_SELF_HOSTED=1

# Run as a non-root user. `node` (uid 1000) already exists in the base image.
USER node

# The standalone bundle carries its own minimal node_modules; `static` and `public` are served from
# disk and are NOT included in it, so both are copied explicitly.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Kept so an operator can apply migrations from inside the container:
#   docker compose exec app npx prisma migrate deploy
COPY --from=build --chown=node:node /app/prisma ./prisma

EXPOSE 3000

# /api/health is the app's own readiness endpoint (it reports DB, autoscan and provider wiring), so
# the check exercises the real request path rather than just proving the port is open.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
