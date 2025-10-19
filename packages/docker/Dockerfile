# syntax=docker/dockerfile:1

# -------------------------------------------------
# Base image shared by stages
# -------------------------------------------------
FROM node:20-bookworm-slim AS base
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

# -------------------------------------------------
# deps: install workspace deps at the repo root
# -------------------------------------------------
FROM base AS deps
RUN corepack enable pnpm
# copy only what's needed for a cached, deterministic install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# copy all workspace package.json files so pnpm can resolve the workspace graph
COPY packages/docker/package.json packages/docker/
COPY packages/api/package.json packages/api/
COPY packages/ui/package.json packages/ui/
RUN pnpm i --frozen-lockfile -r

# -------------------------------------------------
# builder: build just the docker workspace (and its deps)
# -------------------------------------------------
FROM base AS builder
RUN corepack enable pnpm
# bring the full repo now (so build has sources)
COPY . .
# reuse node_modules from deps layer to speed things up
COPY --from=deps /repo/node_modules ./node_modules

# Build dependencies first (api, ui)
RUN pnpm --filter @queuedash/api build
RUN pnpm --filter @queuedash/ui build

# Build the docker package
RUN pnpm --filter @queuedash/docker build

# -------------------------------------------------
# runner: minimal runtime image
# -------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# copy Next.js standalone server + static assets
COPY --from=builder --chown=nextjs:nodejs /repo/packages/docker/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/packages/docker/.next/static ./packages/docker/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "packages/docker/server.js"]