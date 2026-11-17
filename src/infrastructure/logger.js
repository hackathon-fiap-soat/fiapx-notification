'use strict';

// Campos que nunca podem aparecer em log: o action_url carrega o token de redefinição de senha.
const SENSIVEIS = /action_url|actionurl|password|token|secret/i;

/** Log em JSON, uma linha por evento, com correlation_id (lido pelo New Relic). */
function log(nivel, mensagem, extra = {}) {
  const limpo = Object.fromEntries(Object.entries(extra).filter(([k, v]) => !SENSIVEIS.test(k) && v !== undefined));
  const linha = JSON.stringify({ level: nivel, message: mensagem, service: 'fiapx-notification', ...limpo });
  (nivel === 'error' ? console.error : console.log)(linha);
}

module.exports = { log };
