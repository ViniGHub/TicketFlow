import { DomainError } from '@ticketflow/domain';

// Status HTTP de cada código: common/error-status.ts.

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'EMAIL_ALREADY_REGISTERED';

  constructor() {
    super('Este e-mail já está cadastrado.');
  }
}

/** Mesma mensagem para e-mail inexistente e senha errada: não revela quais e-mails existem. */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('E-mail ou senha inválidos.');
  }
}

export class InvalidRefreshTokenError extends DomainError {
  readonly code = 'INVALID_REFRESH_TOKEN';

  constructor() {
    super('Sessão expirada. Entre novamente.');
  }
}

export class RefreshTokenReusedError extends DomainError {
  readonly code = 'REFRESH_TOKEN_REUSED';

  constructor() {
    super('Sessão encerrada por segurança. Entre novamente.');
  }
}
