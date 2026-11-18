# 0018. Área do organizador: datas no fuso do evento, PATCH só com o que mudou e check-in pela câmera

- **Status:** aceito
- **Data:** 2026-11-18
- **Etapa:** 6.3 (ROADMAP.md)

## Contexto

A etapa 6.3 dá ao organizador a interface que a API já tinha:

- criar e editar eventos e lotes;
- publicar, excluir o rascunho e cancelar o evento;
- ver as vendas;
- fazer o check-in na porta.

As datas de um evento valem no fuso dele, e o dinheiro anda em centavos (CLAUDE.md, regra 2).
As regras do catálogo (janela de vendas, total abaixo do vendido, data no futuro) ficam no
domínio, e a API é quem as aplica.

## Decisão

1. **Datas digitadas no fuso do evento.**
   - O formulário usa o campo `datetime-local` do navegador e um seletor com os fusos do Brasil.
   - O campo não tem fuso. "20/12 às 20h" num evento de Manaus vale 20h em Manaus, e não no
     computador de quem digita.
   - A conversão para UTC usa só o `Intl`, em duas passadas, para acertar a diferença perto de
     uma troca de horário de verão. Fuso que o `Intl` não conhece é recusado.
   - Para editar, a data volta ao campo no fuso do evento.
   - Descartado: uma biblioteca de fusos, para uma conversão que o `Intl` já resolve.
2. **Preço digitado em reais e enviado em centavos.**
   - O texto é lido como texto ("80", "80,50", "1.234,56", "R$ 80,00") e vira inteiro sem
     passar por `float`.
   - "80.5" é recusado, porque é ambíguo em pt-BR.
3. **Os formulários validam com os schemas do `packages/contracts`, e a API dá a palavra final.**
   - O 400 da API marca os campos com as mesmas mensagens do formulário.
   - Um erro de domínio que diz respeito a um campo só aparece nesse campo, com a mensagem da
     API: `EVENT_IN_PAST` na data do evento, `INVALID_SALES_WINDOW` no fim das vendas e
     `TICKET_TYPE_TOTAL_BELOW_SOLD` na quantidade.
   - Os outros 4xx sem mensagem própria no front mostram a mensagem da API, que já vem em
     português.
   - O front não repete as regras do domínio.
4. **O PATCH leva só o que mudou.**
   - Reenviar um campo igual não é neutro: a data de um evento que já passou seria validada de
     novo e recusada, e o organizador não conseguiria corrigir nem o título.
   - As datas são comparadas pelo instante, não pelo texto.
   - Sem mudança nenhuma, não há requisição.
5. **Ações irreversíveis são confirmadas na própria página.**
   - Excluir o rascunho e cancelar o evento pedem um segundo clique.
   - O painel de confirmação diz o que vai acontecer. No cancelamento: reembolso dos pedidos
     pagos, ingressos anulados, reservas encerradas e e-mail aos compradores.
   - O foco vai para "Voltar".
   - Descartado: o `confirm()` do navegador, que não explica nada e não segue o visual.
6. **O painel de vendas é lido de relance.**
   - Três indicadores no topo: receita, vendidos e reservados.
   - Por lote, uma barra fina com vendidos, reservados e disponíveis, com os números ao lado e
     uma legenda única para a lista.
   - Os pedidos aparecem por status, todos, mesmo com zero.
   - As cores das barras são tokens próprios, validados para daltonismo e contraste no tema
     claro e no escuro.
   - Os números atualizam no botão "Atualizar" e ao voltar à aba, sem polling contínuo. Uma
     falha ao atualizar mantém os números na tela.
7. **O check-in aceita o código digitado, um leitor USB ou a câmera.**
   - O campo valida no Enter, que é o que um leitor USB tecla no fim.
   - A câmera traseira (`getUserMedia`) é lida pelo jsQR, que só carrega quando o leitor abre.
   - O quadro é reduzido a 640 px e analisado a cada 150 ms.
   - O mesmo QR é ignorado por 3 s, para não ser validado várias vezes enquanto está na frente
     da câmera.
   - A câmera desliga ao fechar o leitor ou sair da página.
   - O resultado sai grande, com ícone e texto: entrada liberada com o lote, já usado, cancelado
     (reembolsado), de outro evento, não encontrado ou código inválido.
   - Falha de rede ou da API não é recusa: a tela pede para tentar de novo.

## Consequências

- A câmera exige HTTPS. Pelo endereço da rede local, em `http`, o celular não a abre: a tela
  explica e o campo continua funcionando.
- "Já usado" aparece sem o horário, porque a API manda a hora só no texto da mensagem. Um campo
  `checkedInAt` no corpo do erro deixaria a porta dizer quando o ingresso entrou.
- Os testes cobrem as regras de cada tela e decodificam um QR gerado pelo mesmo pacote do
  ingresso. O fluxo completo pela interface, com a API de verdade, fica para o E2E da etapa 6.4.
