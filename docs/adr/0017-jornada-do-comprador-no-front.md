# 0017. Jornada do comprador: catálogo no servidor, chave de idempotência por tentativa e página do pedido que nunca assume pagamento

- **Status:** aceito
- **Data:** 2026-11-18
- **Etapa:** 6.2 (ROADMAP.md)

## Contexto

A etapa 6.2 leva o comprador do catálogo ao ingresso: escolher o evento e os lotes, criar o
pedido, pagar no Stripe Checkout, voltar ao site e ver os ingressos com o QR. A fonte da verdade
do pagamento é o webhook (CLAUDE.md, regra 4), e a criação do pedido aceita `Idempotency-Key`
(ADR 0006). O estoque muda a cada compra, e as datas de um evento valem no fuso dele.

## Decisão

1. **Catálogo e detalhe do evento renderizados no servidor, sem cache.** As duas páginas buscam
   a API direto do servidor do Next, pelo `API_URL`, só em rotas públicas, sem repassar cookies.
   - A primeira tela já vem com os dados, sem spinner e indexável.
   - As datas chegam formatadas do servidor, no fuso do evento (`Intl`, pt-BR). O ICU do Node e o
     do navegador podem diferir em detalhes, e formatar dos dois lados quebraria a hidratação.
   - A escolha de ingressos e a compra rodam no navegador. O "carregar mais" do catálogo também,
     pelo cursor.
2. **Uma `Idempotency-Key` por tentativa de compra.**
   - A chave nasce quando o comprador confirma a escolha (`crypto.randomUUID()`) e fica na
     memória da página.
   - Clicar de novo com a mesma seleção reusa a chave; mudar a seleção começa outra tentativa.
   - A chave só sobrevive a uma falha de rede, quando não se sabe se o pedido foi criado.
     Qualquer resposta da API encerra a tentativa. Por exemplo, depois de um 503 a API já
     cancelou o pedido daquela chave, e repeti-la devolveria o pedido cancelado.
   - Descartado: guardar a chave no `localStorage`. Uma tentativa não deve sobreviver ao
     recarregar a página, quando a seleção pode ter mudado.
3. **As páginas de retorno do Stripe são `/pedidos/<id>?checkout=success|cancel`,** no mesmo
   padrão em português do resto do front. A rota exige sessão no proxy.
4. **A página do pedido nunca dá o pedido como pago por conta própria.** Ela mostra o status
   que a API gravou e pergunta de novo a cada 2 s enquanto ele está `PENDING` ou `PROCESSING`,
   por até 2 minutos:
   - voltar pelo sucesso do Stripe com o pedido ainda `PENDING` mostra "confirmando o
     pagamento", porque o webhook ainda não chegou;
   - `PROCESSING` mostra "aguardando a confirmação do pagamento";
   - passados os 2 minutos, avisa que a confirmação chega por e-mail;
   - quem volta pelo cancelar pode liberar a reserva (`POST /orders/:id/cancel`).
5. **O QR é gerado no navegador** com o `qrcode`, a mesma biblioteca do e-mail do worker, como
   imagem SVG. Ele codifica só o `qr_token` e aparece só no ingresso válido, sobre fundo branco
   também no tema escuro, para o leitor da entrada.
6. **O que depende da sessão só muda a tela depois da hidratação** (`useHydrated`). No
   servidor a sessão não existe. Se outra parte da página já tiver buscado `/me` antes de um
   componente hidratar, o HTML dele sairia diferente do servidor e o React descartaria a árvore.

## Consequências

- O catálogo depende da API para renderizar: com ela fora, a página cai no erro global, com a
  opção de tentar de novo. Um cache curto pode entrar quando o volume justificar.
- Os erros da compra viram mensagens específicas (sem estoque, vendas fechadas, limite por
  pedido, pagamento indisponível), e os que mudam a disponibilidade recarregam a página do evento.
- A compra completa, com o Stripe de verdade, depende da stack inteira e da Stripe CLI. O E2E da
  etapa 6.4 a cobre.
