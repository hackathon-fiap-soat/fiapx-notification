'use strict';

const { Notification } = require('../domain/notification');
const { Email } = require('../domain/email');
const { NotificationStatus } = require('../domain/notification-status');
const { InvalidNotificationError } = require('../domain/errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERRO_MAX = 2000;

/** Resultado do processamento de uma mensagem; `retry` decide o ReportBatchItemFailures do handler. */
const Outcome = Object.freeze({
  SENT: 'SENT', // e-mail enviado agora
  DUPLICATE: 'DUPLICATE', // já tinha sido enviado: não reenvia, só responde à SAGA
  INVALID: 'INVALID', // payload inválido: FAILED, sem reenvio
  IN_PROGRESS: 'IN_PROGRESS', // outra execução está enviando a mesma mensagem: tenta de novo depois
  RETRY: 'RETRY', // falha no SMTP: volta para a fila
  GAVE_UP: 'GAVE_UP', // falha na última tentativa: NotificationFailed e a mensagem vai para a DLQ
});

const isUuid = (v) => typeof v === 'string' && UUID.test(v);
const truncar = (s, max = ERRO_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Caso de uso SendNotification (spec §8.6): valida o comando, reserva o envio no DynamoDB (idempotência),
 * envia o e-mail e responde à SAGA quando o comando faz parte dela.
 *
 * O try/catch aqui é o permitido pela regra do time para consumidores de fila: é onde se decide entre
 * confirmar a mensagem e devolvê-la para a fila.
 *
 * @param {object} deps
 * @param {import('./ports').NotificationRepository} deps.repository
 * @param {import('./ports').EmailSender} deps.sender
 * @param {import('./ports').ReplyPublisher} deps.replies
 * @param {import('./ports').TemplateRenderer} deps.renderer
 * @param {import('./ports').ContractValidator} deps.validator
 * @param {import('./ports').ReplyIdGenerator} deps.ids
 * @param {import('./ports').Clock} deps.clock
 * @param {{webUrl: () => Promise<string>}} deps.config
 * @param {number} [deps.maxAttempts] recebimentos até a DLQ (maxReceiveCount da fila)
 * @param {number} [deps.abandonAfterMs] PENDING mais antigo que isso é considerado abandonado (Lambda morreu)
 */
function createSendNotification(deps) {
  const { repository, sender, replies, renderer, validator, ids, clock, config } = deps;
  const maxAttempts = deps.maxAttempts ?? 3;
  const abandonAfterMs = deps.abandonAfterMs ?? 60_000;

  function reply(type, ctx, payload) {
    const now = clock.now();
    return replies.publish({
      message_id: ids.forReply(ctx.messageId, type, ctx.createdAt),
      type,
      version: 1,
      saga_id: ctx.sagaId,
      video_id: ctx.videoId,
      correlation_id: ctx.correlationId,
      occurred_at: now.toISOString(),
      payload: { channel: 'EMAIL', ...payload },
    });
  }

  const replySent = (n, providerMessageId) =>
    reply('NotificationSent', n, providerMessageId ? { provider_message_id: truncar(providerMessageId, 255) } : {});
  const replyFailed = (ctx, error) => reply('NotificationFailed', ctx, { error: truncar(error) });

  /** Payload inválido: registra FAILED (se houver e-mail e message_id) e avisa a SAGA; nunca reenvia. */
  async function invalid(msg, error) {
    const m = msg && typeof msg === 'object' ? msg : {};
    const p = m.payload && typeof m.payload === 'object' ? m.payload : {};
    const base = { result: Outcome.INVALID, retry: false, error, messageId: m.message_id, correlationId: m.correlation_id };
    let email;
    try {
      email = Email.of(p.recipient_email);
    } catch {
      return base;
    }
    const now = clock.now();
    if (typeof m.message_id === 'string' && m.message_id !== '') {
      await repository.recordInvalid({
        email: email.toString(),
        messageId: m.message_id,
        template: typeof p.template === 'string' ? p.template : null,
        correlationId: typeof m.correlation_id === 'string' ? m.correlation_id : null,
        sagaId: typeof m.saga_id === 'string' ? m.saga_id : null,
        videoId: typeof m.video_id === 'string' ? m.video_id : null,
        error: truncar(`Payload inválido: ${error}`),
        now,
      });
    }
    // A SAGA só recebe a resposta se ela puder ser montada de forma válida (ids no formato do contrato).
    if ([m.message_id, m.saga_id, m.video_id, m.correlation_id].every(isUuid)) {
      const createdAt = Number.isNaN(new Date(m.occurred_at).getTime()) ? now : new Date(m.occurred_at);
      await replyFailed({ messageId: m.message_id, sagaId: m.saga_id, videoId: m.video_id, correlationId: m.correlation_id, createdAt },
        `Payload inválido: ${error}`);
    }
    return { ...base, email };
  }

  /**
   * @param {{body: string, receiveCount?: number}} entrada corpo da mensagem SQS e ApproximateReceiveCount
   */
  return async function sendNotification({ body, receiveCount = 1 }) {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      return invalid(undefined, 'corpo não é JSON');
    }
    const erros = validator.validateSendNotification(msg);
    if (erros.length > 0) return invalid(msg, erros.join('; '));

    let n;
    try {
      n = Notification.fromCommand(msg);
    } catch (e) {
      if (e instanceof InvalidNotificationError) return invalid(msg, e.message);
      throw e;
    }
    const ctx = { messageId: n.messageId, correlationId: n.correlationId, email: n.recipient.email, template: n.template };

    const conteudo = renderer.render(n, { webUrl: await config.webUrl() });
    n.subject = conteudo.subject;
    n.startAttempt(receiveCount);

    const agora = clock.now();
    const reserva = await repository.reserve(n, { now: agora, abandonedBefore: new Date(agora.getTime() - abandonAfterMs) });
    if (!reserva.reserved) {
      if (reserva.existing.status === NotificationStatus.SENT) {
        if (n.isPartOfSaga()) await replySent(n, reserva.existing.providerMessageId);
        return { ...ctx, result: Outcome.DUPLICATE, retry: false };
      }
      return { ...ctx, result: Outcome.IN_PROGRESS, retry: true };
    }

    let enviado;
    try {
      enviado = await sender.send({
        to: { email: n.recipient.email.toString(), name: n.recipient.name },
        subject: conteudo.subject,
        html: conteudo.html,
        text: conteudo.text,
      });
    } catch (e) {
      const erro = truncar(e && e.message ? e.message : String(e));
      n.markFailed(erro);
      await repository.markFailed(n, clock.now());
      const ultima = receiveCount >= maxAttempts;
      if (ultima && n.isPartOfSaga()) await replyFailed(n, erro);
      return { ...ctx, result: ultima ? Outcome.GAVE_UP : Outcome.RETRY, retry: true, error: erro, attempt: receiveCount };
    }

    n.markSent(enviado.providerMessageId, clock.now());
    await repository.markSent(n, n.sentAt);
    if (n.isPartOfSaga()) await replySent(n, n.providerMessageId);
    return { ...ctx, result: Outcome.SENT, retry: false, providerMessageId: n.providerMessageId, attempt: receiveCount };
  };
}

module.exports = { createSendNotification, Outcome };
