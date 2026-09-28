# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# corepack runs the pnpm version pinned by packageManager in the root package.json
RUN corepack enable

# ---------------- deps: install full workspace graph ----------------
FROM base AS deps
# Copy root manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy the package.json of each workspace package the image installs, so pnpm
# "sees" that part of the graph. The dashboard's JS and CSS come from unpkg at
# runtime, so @queuedash/ui and @queuedash/client aren't part of it.
COPY packages/docker/package.json packages/docker/package.json
COPY packages/api/package.json    packages/api/package.json

RUN pnpm i --frozen-lockfile

# ---------------- builder: bring sources and build ----------------
# Build on top of deps instead of copying its root node_modules across: pnpm
# also installs a node_modules into each workspace package (that is where tsc
# and vite live), and deploy below reuses the store this install filled.
FROM deps AS builder
# Bring *all* sources now that deps are installed
COPY . .

# Build the workspace @queuedash/docker needs at runtime: the API's dist/. A
# failed build must fail the image: without dist/ the server cannot start.
# No -w: it adds the root project, whose build is `turbo run build` over every
# package, including ones whose dependencies this image doesn't install.
RUN pnpm --filter @queuedash/api build

# Deploy ONLY the docker runtime workspace into /repo/out
# Exclude root to keep "exactly one project" for deploy
RUN mkdir -p /repo/out \
 && pnpm -w deploy --filter @queuedash/docker --filter '!@queuedash/root' --prod /repo/out

# (Optional) debug what's inside the deploy
# RUN ls -la /repo/out && ls -la /repo/out/packages/docker || true

# ---------------- runner: tiny runtime ----------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000

# Install tini
RUN apt-get update && apt-get install -y --no-install-recommends tini && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# copy the pruned, deploy output
COPY --from=builder /repo/out/ ./

USER node
EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "main.mjs"]