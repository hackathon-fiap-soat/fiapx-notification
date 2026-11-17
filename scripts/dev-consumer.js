#!/usr/bin/env node
'use strict';

/**
 * Consumidor local que imita o event source mapping da Lambda: lê a fila notification-commands do
 * LocalStack em lotes de até 10, chama o mesmo handler e apaga só as mensagens que não voltaram em
 * batchItemFailures (as outras reaparecem depois do visibility timeout e, após 3 recebimentos, vão para a DLQ).
 *
 *   cp .env.example .env && set -a && . ./.env && set +a && npm run dev
 *
 * Com ele de pé, o fluxo local do fiapx-video-api termina em NOTIFIED e os e-mails chegam ao Mailpit
 * (http://localhost:8025).
 */
const { SQSClient, ReceiveMessageCommand, DeleteMessageBatchCommand } = require('@aws-sdk/client-sqs');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

process.env.FIAPX_ENV = process.env.FIAPX_ENV || 'local';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';

const { handler } = require('../src/handlers/sqs-handler');

async function filaDeComandos() {
  if (process.env.NOTIFICATION_QUEUE_URL) return process.env.NOTIFICATION_QUEUE_URL;
  const r = await new SSMClient({}).send(new GetParameterCommand({ Name: `/fiapx/${process.env.FIAPX_ENV}/sqs/notification-commands/url` }));
  return r.Parameter.Value;
}

async function main() {
  const sqs = new SQSClient({});
  const fila = await filaDeComandos();
  let ativo = true;
  process.on('SIGINT', () => { ativo = false; });
  process.on('SIGTERM', () => { ativo = false; });
  console.log(`fiapx-notification local: consumindo ${fila} (Ctrl+C para parar)`);

  while (ativo) {
    const r = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: fila, MaxNumberOfMessages: 10, WaitTimeSeconds: 5, MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    const msgs = r.Messages || [];
    if (msgs.length === 0) continue;
    const { batchItemFailures } = await handler({
      Records: msgs.map((m) => ({ messageId: m.MessageId, body: m.Body, attributes: m.Attributes || {} })),
    });
    const falhas = new Set(batchItemFailures.map((f) => f.itemIdentifier));
    const apagar = msgs.filter((m) => !falhas.has(m.MessageId));
    if (apagar.length > 0) {
      await sqs.send(new DeleteMessageBatchCommand({
        QueueUrl: fila, Entries: apagar.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle })),
      }));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
