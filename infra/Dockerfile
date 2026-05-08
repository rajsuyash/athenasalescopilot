# Single shared image for all Athena Node services + admin-web.
#
# Building each service into its own image would multiply build time by 8x
# (each service depends on the same workspace). One image, picked at run time
# by the container's CMD, keeps the deploy story simple.
#
# Build context: repo root.
#   docker build -f infra/Dockerfile -t athena:latest .

FROM node:20-bookworm-slim AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Workspace manifests first — better layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages packages
COPY services services
COPY apps apps

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build stage ----
FROM deps AS build

# Generate prisma client + build all workspace TS to dist/
RUN pnpm --filter @athena/db prisma generate
RUN pnpm -r --filter '!@athena/chrome-extension' --filter '!@athena/admin-web' build || true
# admin-web has its own next build target
RUN pnpm --filter @athena/admin-web build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Non-root user. Container escape + RCE blast radius is reduced because no
# Athena service needs root at runtime — pnpm + node bind only the service
# port (4000-4070) which is well above the privileged-port range.
RUN addgroup --system --gid 1001 athena \
    && adduser --system --uid 1001 --ingroup athena --home /app --no-create-home athena

ENV NODE_ENV=production

COPY --from=build --chown=athena:athena /app /app

USER athena

# Default to api; override via the platform's CMD/process group.
EXPOSE 4000
CMD ["pnpm", "--filter", "@athena/api", "start"]
