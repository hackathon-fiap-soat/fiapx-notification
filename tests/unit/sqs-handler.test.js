'use strict';

jest.mock('../../src/infrastructure/container', () => {
  const fn = jest.fn();
  return { getSendNotification: () => fn, __fn: fn };
});

const { __fn: sendNotification } = require('../../src/infrastructure/container');
const { handler } = require('../../src/handlers/sqs-handler');
const { Email } = require('../../src/domain/email');

const registro = (id, receiveCount = '1') => ({ messageId: id, body: `{"id":"${id}"}`, attributes: { ApproximateReceiveCount: receiveCount } });

describe('sqs-handler', () => {
  let saida;
  beforeEach(() => {
    sendNotification.mockReset();
    saida = [];
    jest.spyOn(console, 'log').mockImplementation((l) => saida.push(JSON.parse(l)));
    jest.spyOn(console, 'error').mockImplementation((l) => saida.push(JSON.parse(l)));
  });
  afterEach(() => jest.restoreAllMocks());

  it('devolve para a fila só as mensagens com retry (ReportBatchItemFailures)', async () => {
    sendNotification.mockImplementation(async ({ body, receiveCount }) => {
      const { id } = JSON.parse(body);
      if (id === 'b') return { result: 'RETRY', retry: true, error: 'timeout', email: Email.of('maria@example.com') };
      if (id === 'c') throw new Error('DynamoDB fora do ar');
      return { result: 'SENT', retry: false, messageId: `m-${id}`, correlationId: 'c1', template: 'VIDEO_FAILED', receiveCount };
    });

    const r = await handler({ Records: [registro('a'), registro('b', '2'), registro('c', '3')] });

    expect(r).toEqual({ batchItemFailures: [{ itemIdentifier: 'b' }, { itemIdentifier: 'c' }] });
    expect(sendNotification).toHaveBeenCalledWith({ body: '{"id":"a"}', receiveCount: 1 });
    expect(sendNotification).toHaveBeenCalledWith({ body: '{"id":"b"}', receiveCount: 2 });
    expect(saida.find((l) => l.sqs_message_id === 'a')).toMatchObject({ level: 'info', result: 'SENT', message_id: 'm-a', correlation_id: 'c1' });
    expect(saida.find((l) => l.sqs_message_id === 'b')).toMatchObject({ level: 'warn', recipient: 'm***a@example.com', attempt: 2 });
    expect(saida.find((l) => l.sqs_message_id === 'c')).toMatchObject({ level: 'error', error: 'DynamoDB fora do ar', attempt: 3 });
  });

  it('lote vazio ou sem atributos', async () => {
    expect(await handler({})).toEqual({ batchItemFailures: [] });
    sendNotification.mockResolvedValue({ result: 'SENT', retry: false });
    expect(await handler({ Records: [{ messageId: 'x', body: '{}' }] })).toEqual({ batchItemFailures: [] });
    expect(sendNotification).toHaveBeenCalledWith({ body: '{}', receiveCount: 1 });
  });
});
