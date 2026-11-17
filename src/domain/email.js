'use strict';

const { InvalidNotificationError } = require('./errors');

const MAX = 180;
// Validação pragmática: parte local, "@", domínio com ao menos um ponto. Sem espaços.
const FORMATO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Value object de e-mail: normalizado (sem espaços nas pontas, minúsculas). É a partition key no DynamoDB. */
class Email {
  /** @param {string} valor já normalizado */
  constructor(valor) {
    this.valor = valor;
    Object.freeze(this);
  }

  /** @param {unknown} entrada */
  static of(entrada) {
    if (typeof entrada !== 'string') throw new InvalidNotificationError('E-mail do destinatário ausente.');
    const valor = entrada.trim().toLowerCase();
    if (valor.length === 0 || valor.length > MAX || !FORMATO.test(valor)) {
      throw new InvalidNotificationError('E-mail do destinatário inválido.');
    }
    return new Email(valor);
  }

  /** E-mail com a parte local mascarada (ex.: m***a@example.com), para logs. */
  masked() {
    const [local, dominio] = this.valor.split('@');
    const meio = local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`;
    return `${meio}@${dominio}`;
  }

  toString() {
    return this.valor;
  }
}

module.exports = { Email, EMAIL_MAX: MAX };
