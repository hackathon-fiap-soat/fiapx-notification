'use strict';

/**
 * Portas (interfaces) do caso de uso. As implementações ficam em src/infrastructure e são ligadas em
 * src/infrastructure/container.js; nos testes unitários, são substituídas por fakes (tests/helpers/fakes.js).
 *
 * @typedef {import('../domain/notification').Notification} Notification
 *
 * @typedef {object} ExistingNotification
 * @property {string} status  PENDING, SENT ou FAILED
 * @property {string|null} providerMessageId
 *
 * @typedef {object} NotificationRepository
 * @property {(n: Notification, opts: {now: Date, abandonedBefore: Date}) => Promise<{reserved: true}|{reserved: false, existing: ExistingNotification}>} reserve
 *   grava PENDING com a condição `attribute_not_exists(message_id) OR #status = :failed` (ou PENDING abandonado)
 * @property {(n: Notification, now: Date) => Promise<void>} markSent
 * @property {(n: Notification, now: Date) => Promise<void>} markFailed
 * @property {(r: InvalidRecord) => Promise<void>} recordInvalid  grava FAILED só se o item ainda não existe
 *
 * @typedef {object} InvalidRecord
 * @property {string} email
 * @property {string} messageId
 * @property {string|null} template
 * @property {string|null} correlationId
 * @property {string|null} sagaId
 * @property {string|null} videoId
 * @property {string} error
 * @property {Date} now
 *
 * @typedef {object} EmailMessage
 * @property {{email: string, name: string}} to
 * @property {string} subject
 * @property {string} html
 * @property {string} text
 *
 * @typedef {object} EmailSender
 * @property {(m: EmailMessage) => Promise<{providerMessageId: string|null}>} send  lança se o provedor recusar
 *
 * @typedef {object} TemplateRenderer
 * @property {(n: Notification, ctx: {webUrl: string}) => {subject: string, html: string, text: string}} render
 *
 * @typedef {object} ReplyPublisher
 * @property {(envelope: object) => Promise<void>} publish  publica na saga-replies.fifo (MessageGroupId = saga_id)
 *
 * @typedef {object} ContractValidator
 * @property {(msg: unknown) => string[]} validateSendNotification  lista de erros (vazia se válido)
 *
 * @typedef {object} ReplyIdGenerator
 * @property {(commandMessageId: string, replyType: string, at: Date) => string} forReply
 *   UUID v7 determinístico: a mesma resposta ao mesmo comando tem sempre o mesmo message_id
 *
 * @typedef {object} Clock
 * @property {() => Date} now
 */

module.exports = {};
