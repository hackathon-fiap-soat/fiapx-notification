'use strict';

const { montar, exemplo, fakeSender } = require('../helpers/fakes');
const { Outcome } = require('../../src/application/send-notification');

const video = exemplo('send-notification.v1.json');
const senha = exemplo('send-notification.v1--password-reset.json');
const corpo = (m) => JSON.stringify(m);

describe('SendNotification', () => {
  it('envia o VIDEO_FAILED, grava SENT e responde NotificationSent à SAGA', async () => {
    const { sendNotification, repository, sender, respostas } = montar();
    const r = await sendNotification({ body: corpo(video) });

    expect(r).toMatchObject({ result: Outcome.SENT, retry: false, providerMessageId: 'msg-1@fiapx.test', attempt: 1 });
    expect(sender.enviados).toHaveLength(1);
    expect(sender.enviados[0]).toMatchObject({
      to: { email: 'maria.silva@example.com', name: 'Maria Silva' },
      subject: 'Não conseguimos processar o vídeo aula-01.mp4',
    });
    expect(sender.enviados[0].html).toContain('corrompido');
    expect(repository.get('maria.silva@example.com', video.message_id)).toMatchObject({
      status: 'SENT', provider_message_id: 'msg-1@fiapx.test', attempts: 1, template: 'VIDEO_FAILED',
    });
    expect(respostas).toEqual([expect.objectContaining({
      type: 'NotificationSent', version: 1, saga_id: video.saga_id, video_id: video.video_id,
      correlation_id: video.correlation_id, payload: { channel: 'EMAIL', provider_message_id: 'msg-1@fiapx.test' },
    })]);
  });

  it('mensagem duplicada não reenvia o e-mail e repete a mesma resposta (mesmo message_id)', async () => {
    const { sendNotification, sender, respostas } = montar();
    await sendNotification({ body: corpo(video) });
    const r = await sendNotification({ body: corpo(video) });

    expect(r).toMatchObject({ result: Outcome.DUPLICATE, retry: false });
    expect(sender.enviados).toHaveLength(1);
    expect(respostas).toHaveLength(2);
    expect(respostas[1].message_id).toBe(respostas[0].message_id);
    expect(respostas[1].payload.provider_message_id).toBe('msg-1@fiapx.test');
  });

  it('PASSWORD_RESET envia o link e não responde à SAGA nem grava o action_url', async () => {
    const { sendNotification, repository, sender, respostas } = montar();
    const r = await sendNotification({ body: corpo(senha) });

    expect(r.result).toBe(Outcome.SENT);
    expect(sender.enviados[0].text).toContain(senha.payload.action_url);
    expect(sender.enviados[0].html).toContain('redefinir-senha?token=');
    expect(respostas).toEqual([]);
    expect(JSON.stringify(repository.get('maria.silva@example.com', senha.message_id))).not.toContain('token');
  });

  it('duplicata de e-mail de senha também não responde à SAGA', async () => {
    const { sendNotification, sender, respostas } = montar();
    await sendNotification({ body: corpo(senha) });
    expect((await sendNotification({ body: corpo(senha) })).result).toBe(Outcome.DUPLICATE);
    expect(sender.enviados).toHaveLength(1);
    expect(respostas).toEqual([]);
  });

  it('VIDEO_COMPLETED sem provider_message_id responde só com o canal', async () => {
    const sender = { send: async () => ({ providerMessageId: null }) };
    const { sendNotification, respostas } = montar({ sender });
    const msg = { ...video, payload: { ...video.payload, template: 'VIDEO_COMPLETED', reason: undefined } };
    expect((await sendNotification({ body: corpo(msg) })).result).toBe(Outcome.SENT);
    expect(respostas[0].payload).toEqual({ channel: 'EMAIL' });
  });

  it('falha no SMTP: FAILED, volta para a fila e o reenvio seguinte funciona', async () => {
    const { sendNotification, repository, sender, respostas } = montar();
    sender.falharProximos(1);
    const r1 = await sendNotification({ body: corpo(video), receiveCount: 1 });
    expect(r1).toMatchObject({ result: Outcome.RETRY, retry: true, error: 'Connection timeout' });
    expect(repository.get('maria.silva@example.com', video.message_id)).toMatchObject({ status: 'FAILED', attempts: 1, last_error: 'Connection timeout' });
    expect(respostas).toEqual([]);

    const r2 = await sendNotification({ body: corpo(video), receiveCount: 2 });
    expect(r2.result).toBe(Outcome.SENT);
    expect(repository.get('maria.silva@example.com', video.message_id)).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(respostas.map((m) => m.type)).toEqual(['NotificationSent']);
  });

  it('3ª tentativa com falha: NotificationFailed e a mensagem segue para a DLQ', async () => {
    const sender = fakeSender();
    sender.falharProximos(3);
    const { sendNotification, respostas } = montar({ sender });
    const r = await sendNotification({ body: corpo(video), receiveCount: 3 });
    expect(r).toMatchObject({ result: Outcome.GAVE_UP, retry: true });
    expect(respostas).toEqual([expect.objectContaining({ type: 'NotificationFailed', payload: { channel: 'EMAIL', error: 'Connection timeout' } })]);
  });

  it('3ª tentativa com falha em e-mail de senha não responde à SAGA', async () => {
    const sender = { send: async () => { throw 'recusado'; } }; // erro sem message
    const { sendNotification, respostas } = montar({ sender });
    const r = await sendNotification({ body: corpo(senha), receiveCount: 3 });
    expect(r).toMatchObject({ result: Outcome.GAVE_UP, error: 'recusado' });
    expect(respostas).toEqual([]);
  });

  it('erro longo do provedor é truncado', async () => {
    const sender = { send: async () => { throw new Error('x'.repeat(5000)); } };
    const { sendNotification, respostas } = montar({ sender });
    await sendNotification({ body: corpo(video), receiveCount: 3 });
    expect(respostas[0].payload.error).toHaveLength(2000);
  });

  it('outra execução enviando a mesma mensagem (PENDING recente): tenta de novo depois', async () => {
    const { sendNotification, repository, sender } = montar();
    const n = require('../../src/domain/notification').Notification.fromCommand(video);
    n.startAttempt(1);
    await repository.reserve(n, { now: new Date('2026-11-16T12:10:00Z'), abandonedBefore: new Date(0) });
    const r = await sendNotification({ body: corpo(video) });
    expect(r).toMatchObject({ result: Outcome.IN_PROGRESS, retry: true });
    expect(sender.enviados).toHaveLength(0);
  });

  it('PENDING abandonado (mais antigo que o timeout) é retomado', async () => {
    const { sendNotification, repository, sender, clock } = montar();
    const n = require('../../src/domain/notification').Notification.fromCommand(video);
    n.startAttempt(1);
    await repository.reserve(n, { now: clock.now(), abandonedBefore: new Date(0) });
    clock.avancar(61_000);
    const r = await sendNotification({ body: corpo(video), receiveCount: 2 });
    expect(r.result).toBe(Outcome.SENT);
    expect(sender.enviados).toHaveLength(1);
  });

  describe('payload inválido (FAILED, sem reenvio)', () => {
    it('corpo que não é JSON é descartado', async () => {
      const { sendNotification, sender } = montar();
      expect(await sendNotification({ body: '{' })).toMatchObject({ result: Outcome.INVALID, retry: false, error: 'corpo não é JSON' });
      expect(sender.enviados).toHaveLength(0);
    });

    it('fora do schema: registra FAILED e responde NotificationFailed à SAGA', async () => {
      const { sendNotification, repository, sender, respostas } = montar();
      const msg = { ...video, payload: { ...video.payload, template: 'OUTRO' } };
      const r = await sendNotification({ body: corpo(msg) });
      expect(r).toMatchObject({ result: Outcome.INVALID, retry: false });
      expect(r.error).toMatch(/template/);
      expect(sender.enviados).toHaveLength(0);
      expect(repository.get('maria.silva@example.com', video.message_id)).toMatchObject({ status: 'FAILED', template: 'OUTRO' });
      expect(respostas).toEqual([expect.objectContaining({ type: 'NotificationFailed', saga_id: video.saga_id })]);
      expect(respostas[0].payload.error).toMatch(/^Payload inválido/);
    });

    it('não sobrescreve um envio já registrado', async () => {
      const { sendNotification, repository } = montar();
      await sendNotification({ body: corpo(video) });
      await sendNotification({ body: corpo({ ...video, payload: { ...video.payload, recipient_name: '' } }) });
      expect(repository.get('maria.silva@example.com', video.message_id).status).toBe('SENT');
    });

    it('sem e-mail válido não há o que registrar', async () => {
      const { sendNotification, repository, respostas } = montar();
      const r = await sendNotification({ body: corpo({ ...video, payload: { ...video.payload, recipient_email: 'x' } }) });
      expect(r.result).toBe(Outcome.INVALID);
      expect(repository.itens.size).toBe(0);
      expect(respostas).toEqual([]);
    });

    it('sem message_id ou com ids fora do formato: não grava nem responde', async () => {
      const { sendNotification, repository, respostas } = montar();
      await sendNotification({ body: corpo({ ...video, message_id: '', saga_id: 'nao-e-uuid', occurred_at: 'x' }) });
      expect(repository.itens.size).toBe(0);
      expect(respostas).toEqual([]);
    });

    it('occurred_at inválido usa o horário atual na resposta', async () => {
      const { sendNotification, respostas } = montar();
      await sendNotification({ body: corpo({ ...video, occurred_at: 'ontem' }) });
      expect(respostas).toHaveLength(1);
    });

    it('JSON que não é objeto', async () => {
      const { sendNotification } = montar();
      expect((await sendNotification({ body: '42' })).result).toBe(Outcome.INVALID);
      expect((await sendNotification({ body: corpo({ ...video, payload: 'x' }) })).result).toBe(Outcome.INVALID);
    });

    it('regra de domínio violada mesmo com schema aceito', async () => {
      const { sendNotification, respostas } = montar({ validator: { validateSendNotification: () => [] } });
      const r = await sendNotification({ body: corpo({ ...senha, saga_id: video.saga_id }) });
      expect(r).toMatchObject({ result: Outcome.INVALID, error: expect.stringMatching(/SAGA/) });
      expect(respostas).toEqual([]);
    });

    it('erro inesperado do domínio é propagado', async () => {
      const { sendNotification } = montar({ validator: { validateSendNotification: () => [] } });
      await expect(sendNotification({ body: 'null' })).rejects.toThrow(TypeError);
    });
  });
});
