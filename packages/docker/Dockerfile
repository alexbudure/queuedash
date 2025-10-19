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
# also copy the app's package.json so pnpm can resolve that workspace graph
COPY packages/ui/package.json packages/ui/
# (add others if needed, e.g. packages/api/package.json)
RUN pnpm i --frozen-lockfile

# -------------------------------------------------
# builder: build just the UI workspace (and its deps)
# -------------------------------------------------
FROM base AS builder
RUN corepack enable pnpm
# bring the full repo now (so build has sources)
COPY . .
# reuse node_modules from deps layer to speed things up
COPY --from=deps /repo/node_modules ./node_modules
# (Optional) Prisma: RUN pnpm -w -r exec prisma generate

# Ensure your packages/ui/next.config.js sets:  module.exports = { output: 'standalone' }
RUN pnpm -w --filter ./packages/ui... build

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
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# copy Next.js standalone server + static assets + public
COPY --from=builder /repo/packages/ui/.next/standalone ./
COPY --from=builder /repo/packages/ui/.next/static ./.next/static
COPY --from=builder /repo/packages/ui/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]