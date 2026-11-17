'use strict';

/**
 * Contract tests (fiapx-docs/contracts): o consumidor aceita os exemplos oficiais do SendNotification e as
 * respostas produzidas (NotificationSent/NotificationFailed) validam contra os schemas (produtor estrito).
 * Os schemas são lidos de CONTRACTS_DIR (padrão: ../fiapx-docs/contracts, o clone ao lado; no CI, o
 * workflow faz checkout do fiapx-docs nesse caminho).
 */
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { montar, exemplo, fakeSender, CONTRACTS_DIR } = require('../helpers/fakes');

function validadores() {
  if (!fs.existsSync(path.join(CONTRACTS_DIR, 'envelope.schema.json'))) {
    throw new Error(`Schemas não encontrados em ${CONTRACTS_DIR}. Clone o fiapx-docs ao lado ou defina CONTRACTS_DIR.`);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const f of fs.readdirSync(CONTRACTS_DIR).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, f), 'utf8')), f);
  }
  const ok = (schema) => (msg) => {
    const valida = ajv.getSchema(schema);
    if (!valida(msg)) throw new Error(`${schema}: ${JSON.stringify(valida.errors, null, 2)}`);
  };
  return {
    sent: ok('notification-sent.v1.schema.json'),
    failed: ok('notification-failed.v1.schema.json'),
    send: ok('send-notification.v1.schema.json'),
  };
}

describe('contratos', () => {
  const v = validadores();
  const corpo = (m) => JSON.stringify(m);

  it('a cópia dos schemas em src/contracts é igual à do fiapx-docs (rode npm run contracts:sync)', () => {
    for (const f of ['envelope.schema.json', 'send-notification.v1.schema.json']) {
      const local = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'contracts', f), 'utf8');
      expect(JSON.parse(local)).toEqual(JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, f), 'utf8')));
    }
  });

  it('os exemplos oficiais de SendNotification são válidos e consumidos', async () => {
    for (const nome of ['send-notification.v1.json', 'send-notification.v1--password-reset.json']) {
      const msg = exemplo(nome);
      v.send(msg);
      const { sendNotification } = montar();
      expect((await sendNotification({ body: corpo(msg) })).result).toBe('SENT');
    }
  });

  it('NotificationSent produzido (novo e duplicado) valida contra o schema', async () => {
    const { sendNotification, respostas } = montar();
    const msg = exemplo('send-notification.v1.json');
    await sendNotification({ body: corpo(msg) });
    await sendNotification({ body: corpo(msg) });
    const completed = { ...msg, message_id: '0193a1b2-8007-7a00-9b00-0000000000ff', payload: { ...msg.payload, template: 'VIDEO_COMPLETED', reason: undefined } };
    await sendNotification({ body: corpo(completed) });
    expect(respostas).toHaveLength(3);
    respostas.forEach(v.sent);
  });

  it('NotificationFailed produzido (3ª tentativa e payload inválido) valida contra o schema', async () => {
    const sender = fakeSender();
    sender.falharProximos(1);
    const { sendNotification, respostas } = montar({ sender });
    const msg = exemplo('send-notification.v1.json');
    await sendNotification({ body: corpo(msg), receiveCount: 3 });
    await sendNotification({ body: corpo({ ...msg, message_id: '0193a1b2-8007-7a00-9b00-0000000000fe', payload: { ...msg.payload, template: 'NOVO' } }) });
    expect(respostas.map((r) => r.type)).toEqual(['NotificationFailed', 'NotificationFailed']);
    respostas.forEach(v.failed);
  });

  it('os exemplos oficiais das respostas também validam (sanidade do validador)', () => {
    v.sent(exemplo('notification-sent.v1.json'));
    v.failed(exemplo('notification-failed.v1.json'));
  });
});
