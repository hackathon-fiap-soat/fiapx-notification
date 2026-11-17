'use strict';

const { Email } = require('../../src/domain/email');
const { Recipient } = require('../../src/domain/recipient');
const { Notification, RETENCAO_DIAS } = require('../../src/domain/notification');
const { templateOf, isVideoTemplate, requiresActionUrl, Template } = require('../../src/domain/template');
const { readableReason } = require('../../src/domain/failure-reason');
const { InvalidNotificationError } = require('../../src/domain/errors');
const { exemplo } = require('../helpers/fakes');

describe('Email', () => {
  it('normaliza para minúsculas e sem espaços', () => {
    expect(Email.of('  Maria.Silva@Example.COM ').toString()).toBe('maria.silva@example.com');
  });

  it.each([undefined, 42, '', 'sem-arroba', 'a@b', `${'x'.repeat(180)}@example.com`])('rejeita %p', (v) => {
    expect(() => Email.of(v)).toThrow(InvalidNotificationError);
  });

  it('mascara a parte local para logs', () => {
    expect(Email.of('maria@example.com').masked()).toBe('m***a@example.com');
    expect(Email.of('al@example.com').masked()).toBe('a***@example.com');
  });
});

describe('Recipient', () => {
  it('guarda nome e e-mail e devolve o primeiro nome', () => {
    const r = Recipient.of({ email: 'MARIA@example.com', name: ' Maria Silva ' });
    expect(r.email.toString()).toBe('maria@example.com');
    expect(r.name).toBe('Maria Silva');
    expect(r.firstName()).toBe('Maria');
  });

  it.each([undefined, '', '   ', 'x'.repeat(121)])('rejeita nome %p', (name) => {
    expect(() => Recipient.of({ email: 'a@example.com', name })).toThrow(InvalidNotificationError);
  });
});

describe('Template', () => {
  it('reconhece os quatro modelos', () => {
    expect(Object.keys(Template)).toEqual(['VIDEO_FAILED', 'VIDEO_COMPLETED', 'PASSWORD_RESET', 'PASSWORD_CHANGED']);
    expect(templateOf('VIDEO_FAILED')).toBe('VIDEO_FAILED');
    expect(() => templateOf('OUTRO')).toThrow(InvalidNotificationError);
    expect(() => templateOf(undefined)).toThrow(/desconhecido/);
  });

  it('separa modelos de vídeo e de senha', () => {
    expect(isVideoTemplate('VIDEO_COMPLETED')).toBe(true);
    expect(isVideoTemplate('PASSWORD_CHANGED')).toBe(false);
    expect(requiresActionUrl('PASSWORD_RESET')).toBe(true);
    expect(requiresActionUrl('VIDEO_FAILED')).toBe(false);
  });
});

describe('readableReason', () => {
  it('traduz os códigos do video-api', () => {
    expect(readableReason('FFMPEG_ERROR')).toBe('O arquivo de vídeo está corrompido ou em um formato que não conseguimos ler');
    expect(readableReason('QUOTA_EXCEEDED')).toMatch(/5 vídeos/);
  });

  it('usa texto genérico para código desconhecido ou ausente e mantém texto livre', () => {
    expect(readableReason('ALGO_NOVO')).toMatch(/erro inesperado/);
    expect(readableReason(undefined)).toMatch(/erro inesperado/);
    expect(readableReason('  ')).toMatch(/erro inesperado/);
    expect(readableReason('O vídeo tem 0 bytes')).toBe('O vídeo tem 0 bytes');
  });
});

describe('Notification', () => {
  const video = exemplo('send-notification.v1.json');
  const senha = exemplo('send-notification.v1--password-reset.json');

  it('nasce PENDING a partir do comando de vídeo, dentro da SAGA', () => {
    const n = Notification.fromCommand(video);
    expect(n).toMatchObject({ status: 'PENDING', template: 'VIDEO_FAILED', videoName: 'aula-01.mp4', attempts: 0 });
    expect(n.isPartOfSaga()).toBe(true);
    expect(n.readableReason()).toMatch(/corrompido/);
    expect(n.expiresAt()).toBe(Date.parse(video.occurred_at) / 1000 + RETENCAO_DIAS * 86400);
  });

  it('e-mail de senha fica fora da SAGA', () => {
    const n = Notification.fromCommand(senha);
    expect(n.isPartOfSaga()).toBe(false);
    expect(n.actionUrl).toBe(senha.payload.action_url);
  });

  it('muda de estado ao enviar e ao falhar', () => {
    const n = Notification.fromCommand(video);
    n.startAttempt(2);
    n.markFailed('timeout');
    expect(n).toMatchObject({ status: 'FAILED', attempts: 2, lastError: 'timeout' });
    const at = new Date('2026-11-16T12:00:00Z');
    n.markSent('id-1', at);
    expect(n).toMatchObject({ status: 'SENT', providerMessageId: 'id-1', sentAt: at, lastError: null });
    n.markSent('', at);
    expect(n.providerMessageId).toBeNull();
  });

  it.each([
    ['vídeo sem video_name', { ...video, payload: { ...video.payload, video_name: undefined } }],
    ['vídeo sem saga_id', { ...video, saga_id: null }],
    ['senha com saga_id', { ...senha, saga_id: video.saga_id }],
    ['reset sem action_url', { ...senha, payload: { ...senha.payload, action_url: undefined } }],
    ['occurred_at inválido', { ...video, occurred_at: 'ontem' }],
    ['sem payload', { ...video, payload: undefined }],
  ])('rejeita %s', (_, msg) => {
    expect(() => Notification.fromCommand(msg)).toThrow(InvalidNotificationError);
  });
});
