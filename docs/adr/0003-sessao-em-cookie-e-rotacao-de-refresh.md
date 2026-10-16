# 0003. Sessão em cookie httpOnly e rotação do refresh token

- **Status:** aceito
- **Data:** 2026-10-16
- **Etapa:** 1.4 (ROADMAP.md)

## Contexto

A seção 10 do ARCHITECTURE.md define sessão em cookies httpOnly, access token curto e refresh
token rotacionado com detecção de reuso. A etapa 1.4 precisou decidir os detalhes: onde guardar
cada token, como detectar o reuso sem condição de corrida, qual hash de senha usar e como
aplicar rate limit com várias instâncias da API.

## Decisão

1. **Dois cookies httpOnly, Secure, SameSite=Lax.** `tf_access` (JWT HS256, 15 min, `Path=/`)
   e `tf_refresh` (opaco, 7 dias). O refresh só vai para as rotas de refresh e logout:
   `Path=/auth`, configurável em `REFRESH_COOKIE_PATH` porque atrás do BFF (etapa 6.1) o
   navegador vê a API em `/api/auth`.
2. **Refresh token opaco de 256 bits, guardado como SHA-256.** Para um valor aleatório desse
   tamanho, um hash rápido basta; argon2 só faz sentido para senhas, que têm pouca entropia.
3. **Rotação numa transação com `SELECT ... FOR UPDATE`.** O token apresentado é revogado e
   aponta para o novo (`replaced_by`), da mesma `family_id`. Um token já revogado indica roubo
   ou replay: a família inteira é revogada com um único `UPDATE`, gravado antes de responder 401.
4. **Sem janela de tolerância.** Duas abas que pedem refresh ao mesmo tempo com o mesmo token
   derrubam a sessão (a segunda é tratada como reuso). Aceito por ora: é raro e seguro.
   Alternativa descartada: aceitar o token anterior por alguns segundos, que complica a regra e
   abre uma janela de replay.
5. **argon2id do `node:crypto`** (Node 24.7+), no formato PHC. Sem dependência nativa nova.
   Login de e-mail inexistente também calcula um hash, para o tempo de resposta não revelar
   quais e-mails existem. Os parâmetros lidos de um hash gravado têm teto.
6. **CSRF:** SameSite=Lax mais checagem de `Origin` em métodos que alteram estado. Sem `Origin`
   passa (navegadores sempre o enviam em requisições cross-site); `Origin: null` é recusado.
7. **Rate limit com storage em Redis escrito no projeto** (script Lua atômico, janela fixa). A
   biblioteca pronta `@nest-lab/throttler-storage-redis` não suporta o NestJS 12. Com o Redis
   fora, as rotas limitadas respondem 503 em vez de liberar tentativas ilimitadas.
8. **Validação com zod e um pipe próprio**; os schemas do Swagger saem de `z.toJSONSchema()`.
   A `nestjs-zod` também não suporta o NestJS 12, e os schemas já vivem em
   `packages/contracts`, compartilhados com o front.

## Consequências

- O papel (`roles`) no access token vale até ele expirar: mudar o papel de alguém leva até
  15 minutos para refletir nas rotas protegidas por `RolesGuard`. `GET /me` lê do banco.
- O storage de rate limit e o pipe de validação são código próprio, com testes; podem ser
  trocados por bibliotecas quando elas suportarem o NestJS 12.
- O argon2 do `node:crypto` é recente. Se surgir um problema, o formato PHC permite trocar
  pela biblioteca `argon2` sem invalidar as senhas já gravadas.
