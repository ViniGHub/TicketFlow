# Prompts para construir o TicketFlow

Prompts para colar no seu assistente no VS Code (Claude Code, Copilot Chat, Cursor etc.).
O plano de construção, com o escopo, os testes obrigatórios e os critérios de aceite de
cada etapa, está no [ROADMAP.md](ROADMAP.md). Cada etapa vira **uma branch e um pull request**.

## Como usar

1. `CLAUDE.md`, `ARCHITECTURE.md` e `ROADMAP.md` ficam na raiz do repositório.
   Se usar Copilot, copie o `CLAUDE.md` para `.github/copilot-instructions.md`.
2. Siga as etapas na ordem do ROADMAP, respeitando as dependências. Não pule etapas.
3. Para cada etapa: crie a branch indicada, cole o **prompt de etapa** trocando `X.Y` pelo
   número, revise o plano e só então deixe implementar.
4. Ao final, use o **prompt de fechamento**, confira o "Pronto quando" e abra o PR.
5. Leia o código gerado. Em entrevista você precisa saber explicar cada decisão.

> Dica: se o assistente se perder, comece uma conversa nova e cole o prompt de etapa de novo,
> acrescentando: "Parte da etapa já foi feita; confira o estado atual da branch antes de continuar."

---

## Prompt de etapa

```
Leia CLAUDE.md, ARCHITECTURE.md e a etapa X.Y do ROADMAP.md.

Implemente somente a etapa X.Y. Antes de editar arquivos, mostre o plano:
- arquivos que vai criar ou alterar;
- decisões relevantes e alternativas descartadas;
- testes que vai escrever, cobrindo todos os "Testes obrigatórios" da etapa.
Espere minha aprovação antes de implementar.

Implemente em passos pequenos, rodando os testes a cada passo. Se algo do escopo
contradisser o ARCHITECTURE.md, pare e me pergunte em vez de escolher sozinho.
```

## Prompt de fechamento

```
Feche a etapa X.Y do ROADMAP.md:
1. Rode pnpm lint, pnpm typecheck, pnpm test e, se a etapa toca em banco ou Redis,
   pnpm test:integration. Corrija o que falhar (sem pular nem desabilitar testes).
2. Confira cada item de "Pronto quando" e diga como verificou cada um.
3. Se uma decisão de arquitetura foi tomada, crie um ADR curto em docs/adr/.
4. Atualize README, .env.example e ARCHITECTURE.md se algo mudou.
5. Proponha os commits (Conventional Commits) e a descrição do PR: o quê, por quê,
   como testar e o que ficou pendente.
```

---

## Prompts avulsos úteis

**Revisão de código antes do PR**
```
Faça uma revisão crítica do diff desta branch como um engenheiro sênior. Procure bugs,
race conditions, falhas de autorização, falta de validação, N+1 queries, chamadas externas
dentro de transação, enqueue fora da outbox, testes ausentes e violações do CLAUDE.md.
Liste por severidade, com arquivo e linha.
```

**Quando um teste está instável**
```
O teste X falha de forma intermitente. Não aumente timeouts nem adicione retries como
solução. Investigue a causa raiz (ordem de execução, estado compartilhado, race
condition) e proponha a correção.
```

**Para estudar o que foi gerado**
```
Explique o código desta pasta como se eu fosse apresentá-lo numa entrevista: qual problema
resolve, por que foi feito assim, quais alternativas existiam e quais são os trade-offs.
```

**Segurança** (usado na etapa 7.3)
```
Audite o projeto contra o OWASP Top 10: autenticação, autorização por recurso, injeção,
exposição de dados, configuração de CORS/Helmet/cookies, validação do webhook e tratamento
de segredos. Liste achados e corrija os de baixo risco.
```

**Nova funcionalidade da fase 9**
```
Leia CLAUDE.md, ARCHITECTURE.md e a fase 9 do ROADMAP.md. Quero implementar <item>.
Escreva primeiro a etapa no formato do ROADMAP (branch, dependências, escopo, testes
obrigatórios, pronto quando) e atualize o ARCHITECTURE.md se o modelo ou os fluxos mudarem.
Só implemente depois da minha aprovação.
```
