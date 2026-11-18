# 0016. BFF no proxy do Next, sessão lida sem o segredo e tipos gerados do OpenAPI

- **Status:** aceito
- **Data:** 2026-11-18
- **Etapa:** 6.1 (ROADMAP.md)

## Contexto

O front precisa falar com a API no mesmo site, para os cookies httpOnly da sessão serem
first-party (ARCHITECTURE.md, seção 10; ADR 0003). Precisa também proteger as páginas por
papel, renovar a sessão quando o access token vence (15 min) e usar os tipos da API sem
escrevê-los à mão. Três restrições moldam a solução:

- A imagem Docker do front é construída uma vez, e o endereço da API (`API_URL`) só chega na
  execução: no compose ele é `http://api:3000`. Com `output: 'standalone'`, a configuração do
  `next.config` (inclusive os `rewrites`) fica fixada no build.
- O cookie de refresh tem `Path=/api/auth` atrás do BFF: o navegador só o envia para as rotas
  de autenticação, nunca na navegação entre páginas.
- O front não deve guardar o `JWT_SECRET`: ele vale para assinar tokens.

## Decisão

1. **O BFF é um rewrite no `proxy.ts`**, o arquivo que substituiu o `middleware.ts` no
   Next 16 e roda em Node a cada requisição.
   - `/api/*` vai para `<API_URL>/*`, com o `API_URL` lido na requisição. Sem ele, só fora de
     produção, vale `http://localhost:3000`.
   - O proxy do Next repassa os headers e os cookies e devolve o `Set-Cookie` da API.
   - Descartado: os `rewrites` do `next.config`, fixados no build da imagem.
   - Descartado: um route handler que refaz a requisição com `fetch`. Seria mais código para
     o mesmo resultado.
2. **O proxy protege as páginas lendo o access token sem conferir a assinatura.** Ele
   decodifica o payload do `tf_access` (papéis e validade, com o schema de `contracts`):
   - `/conta` exige sessão;
   - `/organizador` exige o papel `ORGANIZER`;
   - sem sessão, redireciona para `/entrar?next=<página>`; sem o papel, para `/sem-acesso`.

   Quem autoriza é a API, a cada chamada. Um token adulterado mostraria no máximo a casca
   vazia de uma página: os dados não vêm. O `next` só aceita caminhos do próprio site
   (open redirect).

3. **A renovação acontece no navegador, mantendo o caminho restrito do cookie de refresh.**
   - O login tenta antes `POST /api/auth/refresh`. Quem ainda tem sessão volta direto para a
     página pedida.
   - O cliente da API, num 401 fora de `/api/auth/*`, renova uma vez e repete a chamada.
     Chamadas simultâneas esperam a mesma renovação: o refresh token é rotacionado a cada uso,
     e duas renovações em paralelo fariam a segunda reutilizar um token trocado, o que revoga
     a sessão inteira (ADR 0003).
   - Descartado: renovar no proxy. Ele nunca recebe o cookie de refresh, e alargar o caminho
     do cookie para `/` o mandaria em toda requisição de página.
4. **A sessão do front é a resposta de `/me`**, guardada no cache do TanStack Query. Nada vai
   para `localStorage`.
5. **Os tipos vêm do OpenAPI, versionados e conferidos no CI:**
   - `pnpm api:types` monta a API sem subir o servidor, grava `apps/api/openapi.json` e gera
     `apps/web/src/lib/api/schema.ts` com o `openapi-typescript`, os dois formatados pelo
     Prettier;
   - o cliente `openapi-fetch` usa esses tipos;
   - o CI regera e falha se algo mudar. Mudar a API sem regerar quebra o CI, e regerar com
     incompatibilidade quebra o typecheck do front.
   - Descartado: gerar a partir do `/docs-json` de uma API rodando. Exigiria banco e Redis
     só para gerar tipos.

## Consequências

- **Rate limit por IP atrás do BFF:** o proxy do Next não acrescenta o IP do cliente no
  `X-Forwarded-For`; só repassa o que recebeu. Em produção, quem põe esse header é o
  balanceador da plataforma, e a API precisa de `TRUST_PROXY` com o número certo de saltos,
  ou o rate limit do login vira um só para todos. A etapa 7.2 confere isso no deploy.
- **Swagger direto na API:** com `REFRESH_COOKIE_PATH=/api/auth`, a renovação pelo Swagger
  (`localhost:3000/auth/refresh`) não recebe o cookie. O login e as chamadas continuam
  funcionando pelos 15 minutos do access token.
- **Formulários:** validam com os mesmos schemas zod da API (`contracts`), com mensagens em
  português do próprio formulário.
