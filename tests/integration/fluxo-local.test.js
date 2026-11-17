'use strict';

/**
 * Integração com o ambiente local real (fiapx-infra/local): LocalStack (SSM, Secrets Manager, DynamoDB e
 * SQS) e Mailpit (SMTP em localhost:1025, API em localhost:8025). Roda só com INTEGRATION=1
 * (`npm run test:integration`), com o compose de pé:
 *   cd ../fiapx-infra/local && docker compose up -d --wait
 *
 * Usa o handler da Lambda e a configuração do SSM em /fiapx/local, com duas trocas: SMTP_HOST=localhost
 * (o SSM local diz "mailpit", nome que só resolve dentro do compose) e uma fila FIFO de respostas própria do
 * teste, para não disputar a saga-replies.fifo com o saga-consumer do fiapx-video-api, se ele estiver de pé.
 */
const crypto = require('node:crypto');
const { SQSClient, CreateQueueCommand, DeleteQueueCommand, ReceiveMessageCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');

const rodar = process.env.INTEGRATION === '1' ? describe : describe.skip;

process.env.FIAPX_ENV = process.env.FIAPX_ENV || 'local';
process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';

const container = require('../../src/infrastructure/container');
const { handler } = require('../../src/handlers/sqs-handler');
const { exemplo } = require('../helpers/fakes');

const uuid = () => crypto.randomUUID();
const registro = (msg) => ({ messageId: uuid(), body: JSON.stringify(msg), attributes: { ApproximateReceiveCount: '1' } });

async function emails(para) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`);
  return (await r.json()).messages || [];
}

async function corpoDoEmail(id) {
  return (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
}

rodar('fluxo no ambiente local (LocalStack + Mailpit)', () => {
  const sqs = new SQSClient({});
  const ddb = new DynamoDBClient({});
  const sufixo = Date.now();
  let filaRespostas;
  let tabela;

  async function respostas() {
    const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: filaRespostas, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }));
    return (r.Messages || []).map((m) => JSON.parse(m.Body));
  }

  async function item(email, messageId) {
    const r = await ddb.send(new GetItemCommand({ TableName: tabela, Key: { email: { S: email }, message_id: { S: messageId } }, ConsistentRead: true }));
    return r.Item;
  }

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    // O SDK avisa que a URL da fila do LocalStack difere do endpoint; é esperado no ambiente local.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const q = await sqs.send(new CreateQueueCommand({
      QueueName: `fiapx-local-notification-it-${sufixo}.fifo`,
      Attributes: { FifoQueue: 'true', VisibilityTimeout: '60' },
    }));
    filaRespostas = q.QueueUrl;
    process.env.SAGA_REPLIES_QUEUE_URL = filaRespostas;
    container.reset();
    tabela = await container.getConfig().tableName();
  });

  afterAll(async () => {
    await sqs.send(new DeleteQueueCommand({ QueueUrl: filaRespostas })).catch(() => {});
    delete process.env.SAGA_REPLIES_QUEUE_URL;
    container.reset();
    jest.restoreAllMocks();
  });

  it('VIDEO_FAILED: e-mail no Mailpit, item SENT no DynamoDB e NotificationSent; duplicata não reenvia', async () => {
    const email = `video-failed+${sufixo}@example.com`;
    const base = exemplo('send-notification.v1.json');
    const msg = { ...base, message_id: uuid(), saga_id: uuid(), payload: { ...base.payload, recipient_email: email.toUpperCase() } };

    expect(await handler({ Records: [registro(msg)] })).toEqual({ batchItemFailures: [] });

    const recebidos = await emails(email);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].Subject).toBe('Não conseguimos processar o vídeo aula-01.mp4');
    expect(recebidos[0].From).toMatchObject({ Name: 'FIAP X' });
    const completo = await corpoDoEmail(recebidos[0].ID);
    expect(completo.Text).toContain('O arquivo de vídeo está corrompido');
    expect(completo.HTML).toContain('<strong>aula-01.mp4</strong>');

    const salvo = await item(email, msg.message_id);
    expect(salvo).toMatchObject({ status: { S: 'SENT' }, template: { S: 'VIDEO_FAILED' }, attempts: { N: '1' }, saga_id: { S: msg.saga_id } });
    expect(salvo.provider_message_id.S).toBe(completo.MessageID);

    const [resposta] = await respostas();
    expect(resposta).toMatchObject({ type: 'NotificationSent', saga_id: msg.saga_id, payload: { channel: 'EMAIL', provider_message_id: completo.MessageID } });

    // Mesma mensagem de novo (Standard entrega pelo menos uma vez): sem segundo e-mail.
    expect(await handler({ Records: [registro(msg)] })).toEqual({ batchItemFailures: [] });
    expect(await emails(email)).toHaveLength(1);
  });

  it('PASSWORD_RESET: e-mail com o link, sem action_url no DynamoDB e sem resposta na SAGA', async () => {
    const email = `password-reset+${sufixo}@example.com`;
    const base = exemplo('send-notification.v1--password-reset.json');
    const msg = { ...base, message_id: uuid(), payload: { ...base.payload, recipient_email: email } };

    expect(await handler({ Records: [registro(msg)] })).toEqual({ batchItemFailures: [] });

    const [recebido] = await emails(email);
    expect(recebido.Subject).toBe('Redefinição de senha do FIAP X');
    expect((await corpoDoEmail(recebido.ID)).Text).toContain(base.payload.action_url);
    const salvo = await item(email, msg.message_id);
    expect(salvo.status.S).toBe('SENT');
    expect(JSON.stringify(salvo)).not.toContain('token');
    expect(await respostas()).toEqual([]);
  });

  it('payload inválido: FAILED no DynamoDB, nenhum e-mail e mensagem removida da fila', async () => {
    const email = `invalido+${sufixo}@example.com`;
    const base = exemplo('send-notification.v1.json');
    const msg = { ...base, message_id: uuid(), saga_id: uuid(), payload: { ...base.payload, recipient_email: email, video_name: undefined } };

    expect(await handler({ Records: [registro(msg)] })).toEqual({ batchItemFailures: [] });
    expect(await emails(email)).toHaveLength(0);
    expect((await item(email, msg.message_id)).status.S).toBe('FAILED');
    expect((await respostas()).map((r) => r.type)).toEqual(['NotificationFailed']);
  });
});
