# 0001. Monorepo com pnpm workspaces e Turborepo

- **Status:** aceito
- **Data:** 2026-10-09
- **Etapa:** 1.1 (ROADMAP.md)

## Contexto

O TicketFlow tem três aplicações (web, api, worker) que compartilham regras de domínio,
schemas de validação e o client do banco. Duplicar essas regras entre api e worker é o tipo
de erro que este projeto quer evitar (CLAUDE.md, regra 9).

## Decisão

1. **Um monorepo com pnpm workspaces.** Apps em `apps/*`, código compartilhado em
   `packages/*` (`domain`, `contracts`, `db`, `config`).
2. **Turborepo** orquestra as tasks (`build`, `lint`, `typecheck`, `test`, `dev`), respeitando
   a ordem de dependência (`^build`) e com cache local. O client do Prisma é gerado por uma
   task `generate` da qual as demais dependem.
3. **Pacotes internos são ESM e compilados com `tsc`** para `dist/`. Os apps consomem o
   `dist`, igual a um pacote publicado.
4. **api e worker são CommonJS.** O NestJS e seu CLI têm suporte maduro a CommonJS; com ESM
   seria preciso abrir mão do `nest start --watch` com SWC ou conviver com arestas no
   ecossistema. O Node 24 carrega pacotes ESM a partir de CommonJS (`require(esm)`), então
   os apps continuam consumindo `domain`, `contracts` e `db` sem build duplo.
5. **TypeScript 6.0**, não 7.0: o typescript-eslint ainda não aceita o TS 7. Revisar quando
   houver suporte.
6. **Prisma 7.10** (estável). A tag `latest` do npm apontava para um release candidate da 8.0.

## Consequências

- `pnpm dev` sobe tudo: os pacotes rodam `tsc --watch` e os apps recarregam ao detectar o
  novo `dist`.
- Um `pnpm install` na raiz instala tudo; scripts de build de dependências precisam ser
  liberados explicitamente em `allowBuilds` (`pnpm-workspace.yaml`), o que reduz o risco
  de scripts maliciosos em dependências.
- Se no futuro a api migrar para ESM, a mudança é local ao `package.json` e ao `tsconfig`
  dela; os pacotes compartilhados já são ESM.
