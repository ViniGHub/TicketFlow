# syntax=docker/dockerfile:1
#
# Imagem da API. O contexto de build é a raiz do monorepo:
#   docker build -f apps/api/Dockerfile -t ticketflow-api .

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

# ---- prune: recorta o monorepo só com a API e os pacotes de que ela depende ----
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.7 prune @ticketflow/api --docker

# ---- build: instala (camada cacheada enquanto o lockfile não muda), compila e empacota ----
FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@ticketflow/api
# `pnpm deploy` gera uma pasta autônoma: dist + node_modules só de produção,
# com os pacotes do workspace (contracts...) copiados já compilados.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@ticketflow/api deploy --prod --store-dir /pnpm/store /out

# ---- runtime: só o necessário para rodar, como usuário não-root ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    API_PORT=3000
WORKDIR /app
# Arquivos ficam com dono root (somente leitura para o processo).
COPY --from=build /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.API_PORT + '/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
