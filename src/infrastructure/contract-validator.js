'use strict';

const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const DIR = path.join(__dirname, '..', 'contracts');

/**
 * Valida o SendNotification contra o JSON Schema do fiapx-docs (cópia em src/contracts, conferida pelo
 * contract test). Consumidor tolerante: campos desconhecidos (additionalProperties) não invalidam a mensagem.
 */
function schemaContractValidator(dir = DIR) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(require(path.join(dir, 'envelope.schema.json')), 'envelope.schema.json');
  const valida = ajv.compile(require(path.join(dir, 'send-notification.v1.schema.json')));

  return {
    validateSendNotification(msg) {
      if (valida(msg)) return [];
      const relevantes = valida.errors.filter((e) => e.keyword !== 'additionalProperties');
      // Só "if" sem o "then" correspondente não diz nada: o erro real vem junto.
      const uteis = relevantes.filter((e) => e.keyword !== 'if');
      if (uteis.length === 0) return [];
      return [...new Set(uteis.map((e) => `${e.instancePath || '/'} ${e.message}`))];
    },
  };
}

module.exports = { schemaContractValidator };
