'use strict';

const { getSendNotification } = require('../infrastructure/container');
const { log } = require('../infrastructure/logger');

/**
 * Entrada da Lambda: lote (até 10) da fila notification-commands. Responde no formato do
 * ReportBatchItemFailures: só as mensagens com `retry` voltam para a fila (e, depois de 3 recebimentos,
 * vão para a DLQ); as demais são removidas.
 *
 * @param {{Records: Array<{messageId: string, body: string, attributes?: {ApproximateReceiveCount?: string}}>}} event
 */
async function handler(event) {
  const registros = (event && event.Records) || [];
  const resultados = await Promise.all(registros.map(processar));
  return {
    batchItemFailures: registros
      .filter((_, i) => resultados[i])
      .map((r) => ({ itemIdentifier: r.messageId })),
  };
}

/** @returns {Promise<boolean>} true se a mensagem deve voltar para a fila */
async function processar(registro) {
  const inicio = Date.now();
  const receiveCount = Number((registro.attributes && registro.attributes.ApproximateReceiveCount) || 1);
  try {
    const r = await getSendNotification()({ body: registro.body, receiveCount });
    log(r.retry ? 'warn' : 'info', 'notificação processada', {
      sqs_message_id: registro.messageId,
      message_id: r.messageId,
      correlation_id: r.correlationId,
      template: r.template,
      recipient: r.email ? r.email.masked() : undefined,
      result: r.result,
      attempt: receiveCount,
      provider_message_id: r.providerMessageId || undefined,
      error: r.error,
      duration_ms: Date.now() - inicio,
    });
    return r.retry;
  } catch (e) {
    log('error', 'erro inesperado ao processar a notificação', {
      sqs_message_id: registro.messageId,
      attempt: receiveCount,
      error: e.message,
      stack: e.stack,
    });
    return true;
  }
}

module.exports = { handler };
