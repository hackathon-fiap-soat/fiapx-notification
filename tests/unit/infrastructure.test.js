'use strict';

const { ConditionalCheckFailedException } = require('@aws-sdk/client-dynamodb');
const { createConfig } = require('../../src/infrastructure/config');
const { smtpEmailSender } = require('../../src/infrastructure/smtp-email-sender');
const { sqsReplyPublisher } = require('../../src/infrastructure/sqs-reply-publisher');
const { dynamoNotificationRepository } = require('../../src/infrastructure/dynamo-notification-repository');
const { fileTemplateRenderer, escapeHtml } = require('../../src/infrastructure/template-renderer');
const { deterministicReplyIds } = require('../../src/infrastructure/ids');
const { schemaContractValidator } = require('../../src/infrastructure/contract-validator');
const { log } = require('../../src/infrastructure/logger');
const { Notification } = require('../../src/domain/notification');
const { exemplo } = require('../helpers/fakes');

const video = exemplo('send-notification.v1.json');
const senha = exemplo('send-notification.v1--password-reset.json');

/** Cliente AWS falso: grava os comandos e responde com a função dada. */
function clienteFalso(responder = () => ({})) {
  const comandos = [];
  return {
    comandos,
    send: jest.fn(async (cmd) => {
      comandos.push(cmd);
      return responder(cmd);
    }),
  };
}

describe('createConfig', () => {
  it('lê do SSM em /fiapx/<env>/ e do segredo SMTP, com cache', async () => {
    const valores = {
      '/fiapx/local/dynamodb/notifications/table_name': 'fiapx-local-notifications',
      '/fiapx/local/sqs/saga-replies/url': 'http://sqs/saga-replies.fifo',
      '/fiapx/local/web/url': 'http://localhost:5173/',
      '/fiapx/local/notification/smtp_host': 'mailpit',
      '/fiapx/local/notification/smtp_port': '1025',
      '/fiapx/local/notification/smtp_secret_arn': 'arn:smtp',
    };
    const ssm = clienteFalso((c) => ({ Parameter: { Value: valores[c.input.Name] } }));
    const secrets = clienteFalso(() => ({ SecretString: JSON.stringify({ user: '', password: '', from: 'nao-responda@fiapx.local' }) }));
    const cfg = createConfig({}, { ssm, secrets });

    expect(await cfg.tableName()).toBe('fiapx-local-notifications');
    expect(await cfg.sagaRepliesQueueUrl()).toBe('http://sqs/saga-replies.fifo');
    expect(await cfg.webUrl()).toBe('http://localhost:5173');
    expect(await cfg.smtp()).toEqual({ host: 'mailpit', port: 1025, user: '', password: '', from: 'nao-responda@fiapx.local' });
    await cfg.smtp();
    expect(secrets.send).toHaveBeenCalledTimes(1);
    expect(secrets.comandos[0].input).toEqual({ SecretId: 'arn:smtp' });
  });

  it('variáveis de ambiente têm prioridade (Terraform na AWS)', async () => {
    const ssm = clienteFalso(() => { throw new Error('não deveria ler o SSM'); });
    const secrets = clienteFalso(() => ({ SecretString: '{"user":"u","password":"p","from":"time@example.com"}' }));
    const cfg = createConfig({
      FIAPX_ENV: 'prod', NOTIFICATION_TABLE_NAME: 't', SAGA_REPLIES_QUEUE_URL: 'q', WEB_URL: 'https://x',
      SMTP_HOST: 'smtp.email.sa-saopaulo-1.oci.oraclecloud.com', SMTP_PORT: '587', SMTP_SECRET_ARN: 'arn:prod',
    }, { ssm, secrets });
    expect(await cfg.tableName()).toBe('t');
    expect(await cfg.smtp()).toEqual({ host: 'smtp.email.sa-saopaulo-1.oci.oraclecloud.com', port: 587, user: 'u', password: 'p', from: 'time@example.com' });
  });

  it('não guarda em cache uma leitura que falhou', async () => {
    let n = 0;
    const ssm = clienteFalso(() => {
      n += 1;
      if (n === 1) throw new Error('throttling');
      return { Parameter: { Value: 'ok' } };
    });
    const cfg = createConfig({ FIAPX_ENV: 'x' }, { ssm, secrets: clienteFalso() });
    await expect(cfg.tableName()).rejects.toThrow('throttling');
    expect(await cfg.tableName()).toBe('ok');
    expect(ssm.comandos[0].input.Name).toBe('/fiapx/x/dynamodb/notifications/table_name');
  });

  it('cria os clientes reais quando não recebe nenhum', () => {
    expect(createConfig({})).toHaveProperty('smtp');
  });
});

describe('smtpEmailSender', () => {
  const mensagem = { to: { email: 'maria@example.com', name: 'Maria' }, subject: 'Assunto', html: '<p>x</p>', text: 'x' };

  function transporte(info = { messageId: '<abc@fiapx>' }) {
    const opcoes = [];
    const enviados = [];
    const create = jest.fn((o) => {
      opcoes.push(o);
      return { sendMail: async (m) => { enviados.push(m); return info; } };
    });
    return { create, opcoes, enviados };
  }

  it('Mailpit: sem autenticação nem TLS obrigatório; remetente com nome FIAP X', async () => {
    const t = transporte();
    const s = smtpEmailSender(async () => ({ host: 'mailpit', port: 1025, user: '', password: '', from: 'nao-responda@fiapx.local' }), t.create);
    expect(await s.send(mensagem)).toEqual({ providerMessageId: 'abc@fiapx' });
    await s.send(mensagem);
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.opcoes[0]).toMatchObject({ host: 'mailpit', port: 1025, secure: false, requireTLS: false, auth: undefined });
    expect(t.enviados[0]).toMatchObject({
      from: { name: 'FIAP X', address: 'nao-responda@fiapx.local' },
      to: { name: 'Maria', address: 'maria@example.com' },
      subject: 'Assunto', html: '<p>x</p>', text: 'x',
    });
  });

  it('OCI Email Delivery: autenticado, porta 587 com STARTTLS obrigatório', async () => {
    const t = transporte({});
    const s = smtpEmailSender(async () => ({ host: 'smtp.email.sa-saopaulo-1.oci.oraclecloud.com', port: 587, user: 'u', password: 'p', from: 'FIAP X <time@example.com>' }), t.create);
    expect(await s.send(mensagem)).toEqual({ providerMessageId: null });
    expect(t.opcoes[0]).toMatchObject({ secure: false, requireTLS: true, auth: { user: 'u', pass: 'p' } });
    expect(t.enviados[0].from).toBe('FIAP X <time@example.com>');
  });

  it('porta 465 usa TLS direto', async () => {
    const t = transporte();
    await smtpEmailSender(async () => ({ host: 'h', port: 465, user: 'u', password: 'p', from: 'a@b.com' }), t.create).send(mensagem);
    expect(t.opcoes[0]).toMatchObject({ secure: true, requireTLS: false });
  });

  it('sem remetente configurado, falha com mensagem clara', async () => {
    const s = smtpEmailSender(async () => ({ host: 'h', port: 587, user: 'u', password: 'p', from: '' }), transporte().create);
    await expect(s.send(mensagem)).rejects.toThrow(/Remetente SMTP/);
  });

  it('usa o Nodemailer por padrão', () => {
    expect(smtpEmailSender(async () => ({}))).toHaveProperty('send');
  });
});

describe('sqsReplyPublisher', () => {
  it('publica na FIFO com MessageGroupId = saga_id e dedup = message_id', async () => {
    const sqs = clienteFalso();
    const env = exemplo('notification-sent.v1.json');
    await sqsReplyPublisher(async () => 'http://fila.fifo', sqs).publish(env);
    expect(sqs.comandos[0].input).toMatchObject({
      QueueUrl: 'http://fila.fifo',
      MessageGroupId: env.saga_id,
      MessageDeduplicationId: env.message_id,
      MessageAttributes: { type: { DataType: 'String', StringValue: 'NotificationSent' } },
    });
    expect(JSON.parse(sqs.comandos[0].input.MessageBody)).toEqual(env);
  });

  it('cria o cliente real quando não recebe nenhum', () => {
    expect(sqsReplyPublisher(async () => 'x')).toHaveProperty('publish');
  });
});

describe('dynamoNotificationRepository', () => {
  const agora = new Date('2026-11-16T12:10:00Z');
  const tabela = async () => 'fiapx-local-notifications';
  const nova = (msg = video) => {
    const n = Notification.fromCommand(msg);
    n.subject = 'Assunto';
    n.startAttempt(1);
    return n;
  };
  const conflito = (item) => Object.assign(new ConditionalCheckFailedException({ message: 'x', $metadata: {} }), item ? { Item: item } : {});

  it('reserva com PutItem condicional (PK email, SK message_id), sem action_url', async () => {
    const ddb = clienteFalso();
    const repo = dynamoNotificationRepository(tabela, ddb);
    expect(await repo.reserve(nova(senha), { now: agora, abandonedBefore: new Date(agora - 60000) })).toEqual({ reserved: true });
    const input = ddb.comandos[0].input;
    expect(input.TableName).toBe('fiapx-local-notifications');
    expect(input.ConditionExpression).toMatch(/^attribute_not_exists\(message_id\) OR #status = :failed/);
    expect(input.Item).toMatchObject({
      email: { S: 'maria.silva@example.com' }, message_id: { S: senha.message_id }, status: { S: 'PENDING' },
      template: { S: 'PASSWORD_RESET' }, attempts: { N: '1' }, created_at: { S: '2026-11-16T12:00:00.000Z' },
    });
    expect(input.Item.saga_id).toBeUndefined();
    expect(JSON.stringify(input)).not.toContain('token');
    expect(Number(input.Item.expires_at.N)).toBe(Date.parse('2026-11-16T12:00:00Z') / 1000 + 90 * 86400);
  });

  it('item da SAGA guarda saga_id, video_id e correlation_id', async () => {
    const ddb = clienteFalso();
    await dynamoNotificationRepository(tabela, ddb).reserve(nova(), { now: agora, abandonedBefore: agora });
    expect(ddb.comandos[0].input.Item).toMatchObject({ saga_id: { S: video.saga_id }, video_id: { S: video.video_id }, correlation_id: { S: video.correlation_id } });
  });

  it('condição falhou: devolve o item atual (do erro ou de um GetItem)', async () => {
    const ddb = clienteFalso(() => { throw conflito({ status: { S: 'SENT' }, provider_message_id: { S: 'p1' } }); });
    expect(await dynamoNotificationRepository(tabela, ddb).reserve(nova(), { now: agora, abandonedBefore: agora }))
      .toEqual({ reserved: false, existing: { status: 'SENT', providerMessageId: 'p1' } });

    const ddb2 = clienteFalso((c) => {
      if (c.constructor.name === 'PutItemCommand') throw conflito();
      return { Item: { status: { S: 'PENDING' } } };
    });
    expect(await dynamoNotificationRepository(tabela, ddb2).reserve(nova(), { now: agora, abandonedBefore: agora }))
      .toEqual({ reserved: false, existing: { status: 'PENDING', providerMessageId: null } });
    expect(ddb2.comandos[1].input.ConsistentRead).toBe(true);

    const ddb3 = clienteFalso((c) => {
      if (c.constructor.name === 'PutItemCommand') throw Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' });
      return {};
    });
    expect((await dynamoNotificationRepository(tabela, ddb3).reserve(nova(), { now: agora, abandonedBefore: agora })).existing.status).toBeNull();
  });

  it('outros erros sobem', async () => {
    const ddb = clienteFalso(() => { throw new Error('ProvisionedThroughputExceeded'); });
    const repo = dynamoNotificationRepository(tabela, ddb);
    await expect(repo.reserve(nova(), { now: agora, abandonedBefore: agora })).rejects.toThrow('Provisioned');
    await expect(repo.recordInvalid({ email: 'a@b.com', messageId: 'm', error: 'x', now: agora })).rejects.toThrow('Provisioned');
  });

  it('markSent grava SENT, provider_message_id e sent_at', async () => {
    const ddb = clienteFalso();
    const repo = dynamoNotificationRepository(tabela, ddb);
    const n = nova();
    n.markSent('p1', agora);
    await repo.markSent(n, agora);
    const input = ddb.comandos[0].input;
    expect(input.Key).toEqual({ email: { S: 'maria.silva@example.com' }, message_id: { S: video.message_id } });
    expect(input.UpdateExpression).toContain('provider_message_id = :pid');
    expect(input.ExpressionAttributeValues[':sent']).toEqual({ S: 'SENT' });

    n.markSent(null, agora);
    n.sentAt = null;
    await repo.markSent(n, agora);
    expect(ddb.comandos[1].input.UpdateExpression).not.toContain('provider_message_id');
  });

  it('markFailed grava FAILED, last_error e attempts', async () => {
    const ddb = clienteFalso();
    const repo = dynamoNotificationRepository(tabela, ddb);
    const n = nova();
    n.markFailed('timeout');
    await repo.markFailed(n, agora);
    expect(ddb.comandos[0].input.ExpressionAttributeValues).toMatchObject({ ':failed': { S: 'FAILED' }, ':err': { S: 'timeout' }, ':attempts': { N: '1' } });
    n.lastError = null;
    await repo.markFailed(n, agora);
    expect(ddb.comandos[1].input.ExpressionAttributeValues[':err']).toEqual({ S: 'erro desconhecido' });
  });

  it('recordInvalid grava FAILED só se o item não existe e ignora o conflito', async () => {
    const ddb = clienteFalso();
    const repo = dynamoNotificationRepository(tabela, ddb);
    await repo.recordInvalid({ email: 'a@b.com', messageId: 'm1', template: 'X', correlationId: 'c', sagaId: 's', videoId: 'v', error: 'Payload inválido', now: agora });
    expect(ddb.comandos[0].input).toMatchObject({ ConditionExpression: 'attribute_not_exists(message_id)', Item: { status: { S: 'FAILED' }, template: { S: 'X' } } });
    await repo.recordInvalid({ email: 'a@b.com', messageId: 'm2', template: null, correlationId: null, sagaId: null, videoId: null, error: 'x', now: agora });
    expect(ddb.comandos[1].input.Item.template).toBeUndefined();

    const conflitante = clienteFalso(() => { throw conflito(); });
    await expect(dynamoNotificationRepository(tabela, conflitante).recordInvalid({ email: 'a@b.com', messageId: 'm', error: 'x', now: agora })).resolves.toBeUndefined();
  });

  it('cria o cliente real quando não recebe nenhum', () => {
    expect(dynamoNotificationRepository(tabela)).toHaveProperty('reserve');
  });
});

describe('fileTemplateRenderer', () => {
  const renderer = fileTemplateRenderer();
  const webUrl = 'https://fiapx.example';

  it.each([
    ['VIDEO_FAILED', 'Não conseguimos processar o vídeo aula-01.mp4', 'https://fiapx.example/'],
    ['VIDEO_COMPLETED', 'Seu vídeo aula-01.mp4 está pronto', 'https://fiapx.example/'],
    ['PASSWORD_CHANGED', 'Sua senha do FIAP X foi alterada', 'https://fiapx.example/recuperar-senha'],
  ])('%s: assunto, HTML e texto com o link', (template, assunto, link) => {
    const base = template.startsWith('VIDEO') ? video : { ...senha, payload: { ...senha.payload, action_url: undefined } };
    const n = Notification.fromCommand({ ...base, payload: { ...base.payload, template } });
    const r = renderer.render(n, { webUrl });
    expect(r.subject).toBe(assunto);
    expect(r.html).toContain(`href="${link}"`);
    expect(r.html).toMatch(/^<!doctype html>/);
    expect(r.text).toContain(link);
    expect(r.text).toContain('Olá, Maria.');
  });

  it('PASSWORD_RESET usa o action_url como link', () => {
    const r = renderer.render(Notification.fromCommand(senha), { webUrl });
    expect(r.html).toContain(escapeHtml(senha.payload.action_url));
    expect(r.text).toContain(senha.payload.action_url);
  });

  it('escapa HTML nos valores vindos da mensagem', () => {
    const n = Notification.fromCommand({ ...video, payload: { ...video.payload, video_name: '<script>x</script>.mp4' } });
    const r = renderer.render(n, { webUrl });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.text).toContain('<script>x</script>.mp4');
  });

  it('variável desconhecida no modelo é erro', () => {
    const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tpl-'));
    require('node:fs').writeFileSync(`${dir}/video-failed.html`, '{{inexistente}}');
    expect(() => fileTemplateRenderer(dir).render(Notification.fromCommand(video), { webUrl })).toThrow(/inexistente/);
  });
});

describe('deterministicReplyIds', () => {
  it('UUID v7 estável por comando e tipo de resposta', () => {
    const ids = deterministicReplyIds();
    const at = new Date('2026-11-16T12:07:00Z');
    const a = ids.forReply(video.message_id, 'NotificationSent', at);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids.forReply(video.message_id, 'NotificationSent', at)).toBe(a);
    expect(ids.forReply(video.message_id, 'NotificationFailed', at)).not.toBe(a);
    expect(parseInt(a.replace(/-/g, '').slice(0, 12), 16)).toBe(at.getTime());
    expect(ids.forReply('x', 'y', 'não é data')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('schemaContractValidator', () => {
  const v = schemaContractValidator();

  it('aceita os exemplos e ignora campos desconhecidos (consumidor tolerante)', () => {
    expect(v.validateSendNotification(video)).toEqual([]);
    expect(v.validateSendNotification({ ...video, novo: 1, payload: { ...video.payload, novo: 2 } })).toEqual([]);
  });

  it('lista os erros relevantes', () => {
    expect(v.validateSendNotification({ ...video, payload: { ...video.payload, video_name: undefined } }).join()).toMatch(/video_name/);
    expect(v.validateSendNotification({ ...senha, saga_id: video.saga_id }).join()).toMatch(/saga_id/);
    expect(v.validateSendNotification({}).length).toBeGreaterThan(0);
  });
});

describe('log', () => {
  it('uma linha JSON por evento, sem campos sensíveis', () => {
    const out = jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    log('info', 'ok', { correlation_id: 'c', action_url: 'https://x?token=1', password: 'p', vazio: undefined });
    log('error', 'falhou', { error: 'x' });
    const linha = JSON.parse(out.mock.calls[0][0]);
    expect(linha).toEqual({ level: 'info', message: 'ok', service: 'fiapx-notification', correlation_id: 'c' });
    expect(JSON.parse(err.mock.calls[0][0]).level).toBe('error');
    jest.restoreAllMocks();
  });
});
