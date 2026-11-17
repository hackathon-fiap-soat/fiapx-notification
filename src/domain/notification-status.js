'use strict';

/** Ciclo de vida de um envio: PENDING (reservado), SENT (aceito pelo provedor SMTP) ou FAILED. */
const NotificationStatus = Object.freeze({
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
});

module.exports = { NotificationStatus };
