'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createSendNotification } = require('../../src/application/send-notification');
const { fileTemplateRenderer } = require('../../src/infrastructure/template-renderer');
const { schemaContractValidator } = require('../../src/infrastructure/contract-validator');
const { deterministicReplyIds } = require('../../src/infrastructure/ids');

const CONTRACTS_DIR = path.resolve(process.env.CONTRACTS_DIR || path.join(__dirname, '..', '..', '..', 'fiapx-docs', 'contracts'));

/** Exemplo oficial do fiapx-docs (contracts/examples). */
function exemplo(nome) {
  return JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, 'examples', nome), 'utf8'));
}

/** Repositório em memória com a mesma condição do DynamoDB. */
function memoryRepository() {
  const itens = new Map();
  const chave = (email, id) => `${email}#${id}`;
  return {
    itens,
    get: (email, id) => itens.get(chave(email, id)),
    async reserve(n, { now, abandonedBefore }) {
      const k = chave(n.recipient.email, n.messageId);
      const atual = itens.get(k);
      const pode = !atual || atual.status === 'FAILED' ||
        (atual.status === 'PENDING' && atual.updated_at < abandonedBefore.toISOString());
      if (!pode) return { reserved: false, existing: { status: atual.status, providerMessageId: atual.provider_message_id || null } };
      itens.set(k, {
        email: String(n.recipient.email), message_id: n.messageId, status: 'PENDING', template: n.template,
        subject: n.subject, attempts: n.attempts, created_at: n.createdAt.toISOString(), updated_at: now.toISOString(),
        saga_id: n.sagaId, video_id: n.videoId, correlation_id: n.correlationId,
      });
      return { reserved: true };
    },
    async markSent(n, now) {
      Object.assign(itens.get(chave(n.recipient.email, n.messageId)), {
        status: 'SENT', provider_message_id: n.providerMessageId, sent_at: n.sentAt.toISOString(), updated_at: now.toISOString(),
      });
    },
    async markFailed(n, now) {
      Object.assign(itens.get(chave(n.recipient.email, n.messageId)), {
        status: 'FAILED', last_error: n.lastError, attempts: n.attempts, updated_at: now.toISOString(),
      });
    },
    async recordInvalid(r) {
      const k = chave(r.email, r.messageId);
      if (!itens.has(k)) itens.set(k, { email: r.email, message_id: r.messageId, status: 'FAILED', last_error: r.error, template: r.template });
    },
  };
}

/** Remetente SMTP falso: guarda os e-mails e pode falhar sob demanda. */
function fakeSender() {
  const enviados = [];
  let falhas = 0;
  return {
    enviados,
    falharProximos(n) {
      falhas = n;
    },
    async send(m) {
      if (falhas > 0) {
        falhas -= 1;
        throw new Error('Connection timeout');
      }
      enviados.push(m);
      return { providerMessageId: `msg-${enviados.length}@fiapx.test` };
    },
  };
}

/** Monta o caso de uso com fakes e as implementações puras reais (templates, schema, ids). */
function montar(over = {}) {
  const repository = over.repository || memoryRepository();
  const sender = over.sender || fakeSender();
  const respostas = [];
  let agora = new Date('2026-11-16T12:10:00Z');
  const clock = { now: () => new Date(agora), avancar: (ms) => { agora = new Date(agora.getTime() + ms); } };
  const sendNotification = createSendNotification({
    repository,
    sender,
    replies: { publish: async (e) => { respostas.push(e); } },
    renderer: fileTemplateRenderer(),
    validator: over.validator || schemaContractValidator(),
    ids: deterministicReplyIds(),
    clock,
    config: { webUrl: async () => 'http://localhost:5173' },
    ...over.deps,
  });
  return { sendNotification, repository, sender, respostas, clock };
}

module.exports = { montar, exemplo, memoryRepository, fakeSender, CONTRACTS_DIR };
