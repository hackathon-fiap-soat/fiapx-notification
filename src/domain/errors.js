'use strict';

/**
 * Erros do domínio. Value objects e a entidade lançam InvalidNotificationError quando um dado de entrada
 * viola uma regra; o caso de uso trata isso como payload inválido (registrado como FAILED, sem reenvio).
 */
class InvalidNotificationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'InvalidNotificationError';
  }
}

module.exports = { InvalidNotificationError };
