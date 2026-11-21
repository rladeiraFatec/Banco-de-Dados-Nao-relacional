/**
 * Erro de aplicação com status HTTP associado.
 * Lançar HttpError em qualquer rota faz o middleware de erro
 * responder em JSON com o status correto.
 */
export class HttpError extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.name = 'HttpError';
    this.status = status;
    if (detalhes !== undefined) this.detalhes = detalhes;
  }
}
