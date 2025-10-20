# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# ---------------- deps: install full workspace graph ----------------
FROM base AS deps
# Copy root manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy ALL workspace package.json files so pnpm "sees" the graph
COPY packages/docker/package.json packages/docker/package.json
COPY packages/api/package.json    packages/api/package.json
COPY packages/ui/package.json     packages/ui/package.json

RUN pnpm i --frozen-lockfile

# ---------------- builder: bring sources and build ----------------
FROM base AS builder
# Bring *all* sources now that deps are installed
COPY . .
# Reuse node_modules from deps for speed
COPY --from=deps /repo/node_modules ./node_modules

# Build any workspaces that @queuedash/docker needs at runtime
# (e.g., compiling TS to dist/)
RUN pnpm -w --filter @queuedash/api build || true
RUN pnpm -w --filter @queuedash/ui  build || true

# Deploy ONLY the docker runtime workspace into /repo/out
# Exclude root to keep "exactly one project" for deploy
RUN mkdir -p /repo/out \
 && pnpm -w deploy --filter @queuedash/docker --filter '!@queuedash/root' --prod /repo/out

# (Optional) debug what's inside the deploy
# RUN ls -la /repo/out && ls -la /repo/out/packages/docker || true

# ---------------- runner: tiny runtime ----------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000

# copy the pruned, deploy output
COPY --from=builder /repo/out/ ./

USER node
EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "main.mjs"]