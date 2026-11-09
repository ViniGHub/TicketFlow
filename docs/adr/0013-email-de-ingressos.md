# 0013. E-mail de ingressos: um por pedido, emailed_at logo depois e Resend com Idempotency-Key

- **Status:** aceito
- **Data:** 2026-11-09
- **Etapa:** 5.2 (ROADMAP.md)

## Contexto

Quando o pedido vira `PAID`, o webhook grava `send-ticket-email` na outbox (ADR 0009), e o
relay publica o job (ADR 0012). Faltava o consumidor: gerar o QR de cada ingresso e mandar o
e-mail. O job é entregue _at-least-once_, então ele pode rodar de novo depois de já ter
enviado. O transporte muda conforme o ambiente: Mailpit (SMTP) em desenvolvimento, Resend em
produção.

## Decisão

1. **Um e-mail por pedido**, com todos os ingressos pendentes agrupados por evento. Cada QR vai
   como imagem PNG embutida no HTML (`cid:`), e por isso os clientes de e-mail também o mostram
   como anexo. O QR codifica só o `qr_token`, que é o que o check-in recebe.
2. **Pendente é `emailed_at IS NULL` e `voided_at IS NULL`.** Reprocessar o job não acha nada
   pendente e não reenvia; ingresso anulado por reembolso nunca sai.
3. **`emailed_at` logo depois do envio**, num `UPDATE ... WHERE emailed_at IS NULL` só dos
   ingressos enviados. Se o processo cair entre o envio e esse `UPDATE`, a próxima tentativa
   envia de novo: é o custo do _at-least-once_.
   - No Resend, o header `Idempotency-Key: send-ticket-email:<orderId>` faz o próprio Resend
     descartar a repetição por 24 h.
   - No SMTP do Mailpit, só em desenvolvimento, não há essa proteção.
   - Descartado: gravar `emailed_at` antes de enviar. Uma falha no envio deixaria o comprador
     sem os ingressos e o pedido marcado como enviado.
4. **Transporte atrás de uma porta (`EmailSender`).** Com `RESEND_API_KEY`, a API HTTP do
   Resend; sem ela, SMTP pelo nodemailer.
   - Descartado: o SDK do Resend. Seria uma dependência a mais para um único POST.
   - Descartado: o Resend por SMTP. Perderia o `Idempotency-Key`.
5. **Conteúdo:**
   - data e hora no fuso do evento, em pt-BR (`Intl`);
   - escape de HTML em tudo o que vem do organizador (título, local, lote) e do comprador
     (nome);
   - uma versão em texto puro, com o código no lugar da imagem.
6. **Falhas:**
   - payload que não passa no schema de `contracts` é `UnrecoverableError`: vai direto para
     `failed`, com log `error`, sem as 5 tentativas;
   - pedido inexistente termina o job com log `warn`;
   - falha do transporte sobe, nada é marcado, e o BullMQ tenta de novo com backoff.
7. **Conexão dos consumidores separada da do produtor.** O worker de um `@Processor` herdaria a
   conexão da fila registrada no BullModule, e a do relay não espera o Redis voltar
   (ADR 0012). As filas do relay passaram a ser privadas do publicador. Cada módulo consumidor
   registra a fila que consome (`BullModule.registerQueue`) sem conexão própria, então o worker
   usa a conexão compartilhada do `BullModule.forRoot`.
   - O registro é obrigatório: o `BullModule.forRoot` sozinho não traz o explorer do
     `@nestjs/bullmq`, que transforma o `@Processor` num worker. Sem ele, o consumidor não roda
     e nada avisa. O teste de subida do worker confere que o consumidor ganhou um worker.

## Consequências

- O e-mail sai alguns segundos depois do pagamento: relay (1 s) e fila.
- Os testes de integração conferem a entrega real pelo SMTP de um container do Mailpit, e a
  cadeia inteira, da linha na outbox ao e-mail enviado.
- O `LoggedProcessor` trata `UnrecoverableError` como falha final: os consumidores das
  próximas etapas (`refund-order`, 5.4) usam o mesmo caminho para payload inválido. Erros de
  conexão do worker também vão para o log, como aviso.
- Com o Redis fora no momento do `SIGTERM`, o fechamento gracioso do worker do BullMQ, que o
  `@nestjs/bullmq` chama no shutdown, não termina; o container só sai com o `SIGKILL` do
  orquestrador (`docker stop` espera 10 s). Um limite de tempo próprio para o shutdown fica
  para a fase 7 (produção).
