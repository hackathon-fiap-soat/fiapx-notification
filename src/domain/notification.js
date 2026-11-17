'use strict';

const { Recipient } = require('./recipient');
const { NotificationStatus } = require('./notification-status');
const { templateOf, isVideoTemplate, requiresActionUrl } = require('./template');
const { readableReason } = require('./failure-reason');
const { InvalidNotificationError } = require('./errors');

/** Dias que o histórico fica no DynamoDB (TTL `expires_at`). */
const RETENCAO_DIAS = 90;

/**
 * Entidade Notification: um pedido de e-mail (identificado pelo message_id do SendNotification) e o resultado
 * do envio. O `actionUrl` (link de redefinição com token) só existe em memória: nunca é persistido nem logado.
 */
class Notification {
  /** @param {object} props */
  constructor(props) {
    Object.assign(this, props);
  }

  /**
   * Cria a notificação a partir do envelope SendNotification já validado contra o schema.
   * @param {object} msg envelope
   */
  static fromCommand(msg) {
    const p = msg.payload || {};
    const template = templateOf(p.template);
    const recipient = Recipient.of({ email: p.recipient_email, name: p.recipient_name });
    const sagaId = msg.saga_id ?? null;
    const videoId = msg.video_id ?? null;

    if (isVideoTemplate(template) && (!sagaId || !videoId || !p.video_name)) {
      throw new InvalidNotificationError('Modelo de vídeo exige saga_id, video_id e video_name.');
    }
    if (!isVideoTemplate(template) && (sagaId || videoId)) {
      throw new InvalidNotificationError('Modelo de senha não faz parte da SAGA (saga_id e video_id nulos).');
    }
    if (requiresActionUrl(template) && !p.action_url) {
      throw new InvalidNotificationError('PASSWORD_RESET exige action_url.');
    }
    const createdAt = new Date(msg.occurred_at);
    if (Number.isNaN(createdAt.getTime())) throw new InvalidNotificationError('occurred_at inválido.');

    return new Notification({
      messageId: msg.message_id,
      correlationId: msg.correlation_id,
      sagaId,
      videoId,
      template,
      recipient,
      videoName: p.video_name ?? null,
      reason: p.reason ?? null,
      actionUrl: p.action_url ?? null,
      createdAt,
      status: NotificationStatus.PENDING,
      subject: null,
      attempts: 0,
      providerMessageId: null,
      lastError: null,
      sentAt: null,
    });
  }

  /** E-mails de vídeo fazem parte da SAGA e recebem resposta na saga-replies.fifo; os de senha, não. */
  isPartOfSaga() {
    return this.sagaId !== null;
  }

  /** Texto legível do motivo da falha (VIDEO_FAILED). */
  readableReason() {
    return readableReason(this.reason);
  }

  /** Epoch (segundos) em que o item expira no DynamoDB. */
  expiresAt() {
    return Math.floor(this.createdAt.getTime() / 1000) + RETENCAO_DIAS * 24 * 3600;
  }

  /** @param {number} attempt número desta tentativa (1, 2, 3...) */
  startAttempt(attempt) {
    this.status = NotificationStatus.PENDING;
    this.attempts = attempt;
  }

  /**
   * @param {string|null} providerMessageId
   * @param {Date} at
   */
  markSent(providerMessageId, at) {
    this.status = NotificationStatus.SENT;
    this.providerMessageId = providerMessageId || null;
    this.sentAt = at;
    this.lastError = null;
  }

  /** @param {string} error */
  markFailed(error) {
    this.status = NotificationStatus.FAILED;
    this.lastError = error;
  }
}

module.exports = { Notification, RETENCAO_DIAS };
