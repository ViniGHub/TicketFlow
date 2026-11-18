import { errorResponseSchema } from '@ticketflow/contracts';

// Erros da API para a interface (ROADMAP, etapa 6.1). O formato vem de contracts.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Código estável da API (ex.: `INVALID_CREDENTIALS`); `NETWORK` quando nem chegou lá. */
    readonly code: string,
    message: string,
    /** Erros de validação por campo (400). */
    readonly issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Monta o `ApiError` de uma resposta de erro, com ou sem corpo no formato da API. */
export function apiErrorFrom(response: Response, body: unknown): ApiError {
  const parsed = errorResponseSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, issues } = parsed.data;
    return new ApiError(response.status, code, message, issues);
  }
  // 5xx sem o corpo da API: quem respondeu foi o BFF, porque a API não respondeu.
  const code = response.status >= 500 ? 'SERVICE_UNAVAILABLE' : `HTTP_${response.status}`;
  return new ApiError(response.status, code, response.statusText);
}

export const networkError = () =>
  new ApiError(0, 'NETWORK', 'Não foi possível falar com o servidor.');

const MESSAGES: Readonly<Record<string, string>> = {
  NETWORK: 'Não foi possível falar com o servidor. Confira a sua conexão e tente de novo.',
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  EMAIL_ALREADY_REGISTERED: 'Já existe uma conta com este e-mail. Entre com ela.',
  UNAUTHENTICATED: 'Sua sessão acabou. Entre de novo.',
  TOO_MANY_REQUESTS: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
  SERVICE_UNAVAILABLE: 'O serviço está indisponível agora. Tente de novo em instantes.',
  BAD_REQUEST: 'Confira os dados informados.',
  FORBIDDEN: 'Esta conta não pode fazer isso. Entre com uma conta de comprador.',
  // Compra (ADR 0006 e 0008).
  INSUFFICIENT_STOCK: 'Não há ingressos suficientes nesse lote. A disponibilidade foi atualizada.',
  SALES_WINDOW_CLOSED: 'As vendas desse lote não estão abertas agora.',
  EVENT_NOT_PUBLISHED: 'Este evento não está mais à venda.',
  TICKET_TYPE_NOT_FOUND: 'Um dos lotes não existe mais. A página foi atualizada.',
  MAX_PER_ORDER_EXCEEDED: 'A quantidade passa do limite por pedido desse lote.',
  ORDER_TOTAL_TOO_SMALL: 'O valor mínimo de uma compra paga é R$ 0,50.',
  ORDER_TOTAL_TOO_LARGE: 'O valor do pedido passa do limite. Divida a compra em mais pedidos.',
  ORDER_NOT_FOUND: 'Pedido não encontrado.',
  ORDER_NOT_CANCELLABLE: 'Este pedido não está mais reservado. O status foi atualizado.',
  ORDER_PAYMENT_COMPLETED: 'O pagamento já foi feito: o pedido vai ser confirmado em instantes.',
  CHECKOUT_UNAVAILABLE:
    'O pagamento está indisponível agora e nada foi cobrado. Tente de novo em instantes.',
};

/** Mensagem para o usuário, em português; o código desconhecido cai numa genérica. */
export function messageFor(error: unknown): string {
  const code = error instanceof ApiError ? error.code : undefined;
  return (code && MESSAGES[code]) ?? 'Algo deu errado. Tente de novo.';
}

/** Erro 4xx não melhora tentando de novo; 5xx e falha de rede, talvez. */
export function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}
