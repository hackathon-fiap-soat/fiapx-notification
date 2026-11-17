'use strict';

const { InvalidNotificationError } = require('./errors');

/**
 * Modelos de e-mail (contrato SendNotification v1). Os de vídeo fazem parte da SAGA (têm saga_id e
 * video_id e recebem resposta na saga-replies.fifo); os de senha vêm do fiapx-auth, fora da SAGA (ADR-017).
 */
const Template = Object.freeze({
  VIDEO_FAILED: 'VIDEO_FAILED',
  VIDEO_COMPLETED: 'VIDEO_COMPLETED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
});

const DE_VIDEO = new Set([Template.VIDEO_FAILED, Template.VIDEO_COMPLETED]);

/** @param {unknown} valor */
function templateOf(valor) {
  if (typeof valor !== 'string' || !Object.hasOwn(Template, valor)) {
    throw new InvalidNotificationError(`Modelo de e-mail desconhecido: ${String(valor)}.`);
  }
  return valor;
}

/** @param {string} template */
const isVideoTemplate = (template) => DE_VIDEO.has(template);

/** @param {string} template */
const requiresActionUrl = (template) => template === Template.PASSWORD_RESET;

module.exports = { Template, templateOf, isVideoTemplate, requiresActionUrl };
