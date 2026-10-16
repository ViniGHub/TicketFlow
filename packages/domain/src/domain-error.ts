/**
 * Base de todos os erros de domínio. A API mapeia cada `code` para um status HTTP;
 * nenhum erro de domínio deve vazar como 500.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
