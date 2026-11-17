'use strict';

const crypto = require('node:crypto');

/**
 * UUID v7 determinístico para as respostas à SAGA: o timestamp vem do comando e o resto de um SHA-256 de
 * (message_id do comando, tipo da resposta). Reenviar a resposta ao mesmo comando (mensagem duplicada ou
 * nova tentativa) gera o mesmo message_id, que a FIFO deduplica (MessageDeduplicationId) e o video-api
 * reconhece como já processado.
 */
function deterministicReplyIds() {
  return {
    forReply(commandMessageId, replyType, at) {
      const b = crypto.createHash('sha256').update(`${commandMessageId}:${replyType}`).digest().subarray(0, 16);
      const ms = BigInt(at instanceof Date ? at.getTime() : Date.now());
      for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
      b[6] = (b[6] & 0x0f) | 0x70;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = b.toString('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  };
}

module.exports = { deterministicReplyIds };
