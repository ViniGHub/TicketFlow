# syntax=docker/dockerfile:1
#
# Imagem do worker. O contexto de build é a raiz do monorepo:
#   docker build -f apps/worker/Dockerfile -t ticketflow-worker .

ARG NODE_IMAGE=node:24-alpine

# ---- base: Node + pnpm (versão do campo packageManager, via corepack) ----
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    HUSKY=0
RUN corepack enable
WORKDIR /repo

# ---- prune: recorta o monorepo só com o worker e os pacotes de que ele depende ----
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.7 prune @ticketflow/worker --docker

# ---- build: instala (camada cacheada enquanto o lockfile não muda), compila e empacota ----
FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@ticketflow/worker
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@ticketflow/worker deploy --prod --store-dir /pnpm/store /out

# ---- runtime: só o necessário para rodar, como usuário não-root ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    WORKER_HEARTBEAT_FILE=/tmp/worker.heartbeat
WORKDIR /app
# Arquivos ficam com dono root (somente leitura para o processo).
COPY --from=build /out ./
USER node
# O worker não expõe HTTP: o healthcheck confere a idade do arquivo de heartbeat.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/main.js"]
