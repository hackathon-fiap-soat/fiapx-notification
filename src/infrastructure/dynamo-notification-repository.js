'use strict';

const {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  GetItemCommand,
  ConditionalCheckFailedException,
} = require('@aws-sdk/client-dynamodb');
const { NotificationStatus } = require('../domain/notification-status');
const { RETENCAO_DIAS } = require('../domain/notification');

const S = (v) => ({ S: String(v) });
const N = (v) => ({ N: String(v) });

/** Monta o item só com os atributos presentes (DynamoDB não aceita string vazia em chave e evita nulos). */
function item(campos) {
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null && v !== undefined));
}

const lerTexto = (attr) => (attr && attr.S !== undefined ? attr.S : null);

/**
 * Histórico e idempotência no DynamoDB fiapx-<env>-notifications (spec §8.6.2): PK `email`, SK `message_id`.
 * O `action_url` nunca é gravado: a entidade o carrega só em memória e este adaptador não o lê.
 */
function dynamoNotificationRepository(tableName, client = new DynamoDBClient({})) {
  return {
    async reserve(n, { now, abandonedBefore }) {
      const tabela = await tableName();
      const chave = { email: S(n.recipient.email), message_id: S(n.messageId) };
      try {
        await client.send(new PutItemCommand({
          TableName: tabela,
          Item: item({
            ...chave,
            created_at: S(n.createdAt.toISOString()),
            status: S(NotificationStatus.PENDING),
            template: S(n.template),
            subject: n.subject ? S(n.subject) : null,
            correlation_id: n.correlationId ? S(n.correlationId) : null,
            saga_id: n.sagaId ? S(n.sagaId) : null,
            video_id: n.videoId ? S(n.videoId) : null,
            attempts: N(n.attempts),
            updated_at: S(now.toISOString()),
            expires_at: N(n.expiresAt()),
          }),
          // Spec §8.6.3: só grava (e envia) o que é novo ou falhou antes. O PENDING abandonado (Lambda que
          // morreu entre a reserva e o envio) também pode ser retomado depois do timeout de visibilidade.
          ConditionExpression:
            'attribute_not_exists(message_id) OR #status = :failed OR (#status = :pending AND updated_at < :abandoned)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':failed': S(NotificationStatus.FAILED),
            ':pending': S(NotificationStatus.PENDING),
            ':abandoned': S(abandonedBefore.toISOString()),
          },
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }));
        return { reserved: true };
      } catch (e) {
        if (!(e instanceof ConditionalCheckFailedException) && e.name !== 'ConditionalCheckFailedException') throw e;
        const atual = e.Item || (await client.send(new GetItemCommand({ TableName: tabela, Key: chave, ConsistentRead: true }))).Item || {};
        return {
          reserved: false,
          existing: { status: lerTexto(atual.status), providerMessageId: lerTexto(atual.provider_message_id) },
        };
      }
    },

    async markSent(n, now) {
      const valores = {
        ':sent': S(NotificationStatus.SENT),
        ':sent_at': S((n.sentAt || now).toISOString()),
        ':now': S(now.toISOString()),
        ':attempts': N(n.attempts),
      };
      let set = '#status = :sent, sent_at = :sent_at, updated_at = :now, attempts = :attempts';
      if (n.providerMessageId) {
        set += ', provider_message_id = :pid';
        valores[':pid'] = S(n.providerMessageId);
      }
      await client.send(new UpdateItemCommand({
        TableName: await tableName(),
        Key: { email: S(n.recipient.email), message_id: S(n.messageId) },
        UpdateExpression: `SET ${set} REMOVE last_error`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: valores,
      }));
    },

    async markFailed(n, now) {
      await client.send(new UpdateItemCommand({
        TableName: await tableName(),
        Key: { email: S(n.recipient.email), message_id: S(n.messageId) },
        UpdateExpression: 'SET #status = :failed, last_error = :err, updated_at = :now, attempts = :attempts',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':failed': S(NotificationStatus.FAILED),
          ':err': S(n.lastError || 'erro desconhecido'),
          ':now': S(now.toISOString()),
          ':attempts': N(n.attempts),
        },
      }));
    },

    async recordInvalid(r) {
      const agora = r.now.toISOString();
      try {
        await client.send(new PutItemCommand({
          TableName: await tableName(),
          Item: item({
            email: S(r.email),
            message_id: S(r.messageId),
            created_at: S(agora),
            status: S(NotificationStatus.FAILED),
            template: r.template ? S(r.template) : null,
            correlation_id: r.correlationId ? S(r.correlationId) : null,
            saga_id: r.sagaId ? S(r.sagaId) : null,
            video_id: r.videoId ? S(r.videoId) : null,
            attempts: N(1),
            last_error: S(r.error),
            updated_at: S(agora),
            expires_at: N(Math.floor(r.now.getTime() / 1000) + RETENCAO_DIAS * 24 * 3600),
          }),
          // Nunca sobrescreve um envio registrado antes (ex.: mesma mensagem já enviada).
          ConditionExpression: 'attribute_not_exists(message_id)',
        }));
      } catch (e) {
        if (!(e instanceof ConditionalCheckFailedException) && e.name !== 'ConditionalCheckFailedException') throw e;
      }
    },
  };
}

module.exports = { dynamoNotificationRepository };
