'use strict';

const { Email } = require('./email');
const { InvalidNotificationError } = require('./errors');

const NOME_MAX = 120;

/** Value object do destinatário: e-mail normalizado e nome de exibição. */
class Recipient {
  /**
   * @param {Email} email
   * @param {string} name
   */
  constructor(email, name) {
    this.email = email;
    this.name = name;
    Object.freeze(this);
  }

  /** @param {{email: unknown, name: unknown}} dados */
  static of({ email, name }) {
    const nome = typeof name === 'string' ? name.trim() : '';
    if (nome.length === 0 || nome.length > NOME_MAX) {
      throw new InvalidNotificationError('Nome do destinatário inválido.');
    }
    return new Recipient(Email.of(email), nome);
  }

  /** Primeiro nome, para a saudação do e-mail. */
  firstName() {
    return this.name.split(/\s+/)[0];
  }
}

module.exports = { Recipient };
