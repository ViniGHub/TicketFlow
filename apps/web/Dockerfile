# syntax=docker/dockerfile:1
#
# Imagem do front-end (Next.js standalone). O contexto de build é a raiz do monorepo:
#   docker build -f apps/web/Dockerfile -t ticketflow-web .

ARG NODE_IMAGE=node:24-alpine

# ---- base: Node + pnpm (versão do campo packageManager, via corepack) ----
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    HUSKY=0
RUN corepack enable
WORKDIR /repo

# ---- prune: recorta o monorepo só com a web e os pacotes de que ela depende ----
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.7 prune @ticketflow/web --docker

# ---- build: instala (camada cacheada enquanto o lockfile não muda) e gera o standalone ----
FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@ticketflow/web

# ---- runtime: o servidor standalone do Next já traz só as dependências usadas ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/web/server.js"]
