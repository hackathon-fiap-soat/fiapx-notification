'use strict';

const { createConfig } = require('./config');
const { dynamoNotificationRepository } = require('./dynamo-notification-repository');
const { smtpEmailSender } = require('./smtp-email-sender');
const { sqsReplyPublisher } = require('./sqs-reply-publisher');
const { fileTemplateRenderer } = require('./template-renderer');
const { schemaContractValidator } = require('./contract-validator');
const { deterministicReplyIds } = require('./ids');
const { createSendNotification } = require('../application/send-notification');

let config;
let sendNotification;

function getConfig() {
  config = config || createConfig();
  return config;
}

/** Liga as portas às implementações reais (uma vez por Lambda quente). */
function getSendNotification() {
  if (sendNotification) return sendNotification;
  const cfg = getConfig();
  sendNotification = createSendNotification({
    repository: dynamoNotificationRepository(cfg.tableName),
    sender: smtpEmailSender(cfg.smtp),
    replies: sqsReplyPublisher(cfg.sagaRepliesQueueUrl),
    renderer: fileTemplateRenderer(),
    validator: schemaContractValidator(),
    ids: deterministicReplyIds(),
    clock: { now: () => new Date() },
    config: { webUrl: cfg.webUrl },
    maxAttempts: Number(process.env.MAX_ATTEMPTS || 3),
  });
  return sendNotification;
}

/** Para testes de integração: esquece o estado. */
function reset() {
  config = undefined;
  sendNotification = undefined;
}

module.exports = { getSendNotification, getConfig, reset };
