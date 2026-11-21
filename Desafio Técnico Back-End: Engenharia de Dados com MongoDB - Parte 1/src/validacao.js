import { HttpError } from './errors.js';

/** Garante que o corpo da requisição é um objeto JSON. */
export function corpoObjeto(corpo) {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new HttpError(400, 'Envie um corpo JSON válido (objeto).');
  }
  return corpo;
}

/** Texto obrigatório, com trim e limites de tamanho. */
export function texto(valor, campo, { min = 1, max = 120 } = {}) {
  if (typeof valor !== 'string') {
    throw new HttpError(400, `O campo "${campo}" deve ser um texto.`);
  }
  const limpo = valor.trim();
  if (limpo.length < min) {
    throw new HttpError(400, `O campo "${campo}" deve ter pelo menos ${min} caractere(s).`);
  }
  if (limpo.length > max) {
    throw new HttpError(400, `O campo "${campo}" deve ter no máximo ${max} caracteres.`);
  }
  return limpo;
}

/** Texto opcional: retorna null quando ausente/vazio. */
export function textoOpcional(valor, campo, opcoes = {}) {
  if (valor === undefined || valor === null || valor === '') return null;
  return texto(valor, campo, opcoes);
}

/** Converte números e strings numéricas; rejeita vazio, null e booleanos. */
function numeroDe(valor, campo) {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string' && valor.trim() !== '') return Number(valor);
  throw new HttpError(400, `O campo "${campo}" deve ser um número.`);
}

/** Inteiro dentro do intervalo informado. */
export function inteiro(valor, campo, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numero = numeroDe(valor, campo);
  if (!Number.isInteger(numero)) {
    throw new HttpError(400, `O campo "${campo}" deve ser um número inteiro.`);
  }
  if (numero < min || numero > max) {
    throw new HttpError(400, `O campo "${campo}" deve estar entre ${min} e ${max}.`);
  }
  return numero;
}

/** Número finito e positivo (usado para preço). */
export function numeroPositivo(valor, campo, { min = 0.01, max = 1_000_000 } = {}) {
  const numero = numeroDe(valor, campo);
  if (!Number.isFinite(numero)) {
    throw new HttpError(400, `O campo "${campo}" deve ser um número finito.`);
  }
  if (numero < min || numero > max) {
    throw new HttpError(400, `O campo "${campo}" deve estar entre ${min} e ${max}.`);
  }
  return numero;
}

/** Identificador inteiro positivo (aceita number ou string numérica). */
export function id(valor, campo) {
  return inteiro(valor, campo, { min: 1 });
}

/** Valor restrito a uma lista de opções. */
export function umDe(valor, campo, opcoes) {
  if (!opcoes.includes(valor)) {
    throw new HttpError(400, `O campo "${campo}" deve ser um de: ${opcoes.join(', ')}.`);
  }
  return valor;
}

/** Arredonda para duas casas decimais, evitando ruído de ponto flutuante. */
export function arredondarDinheiro(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Interpreta parâmetros de query como booleanos simples ("true"/"1"). */
export function booleanoDeQuery(valor) {
  return valor === 'true' || valor === '1' || valor === true;
}
