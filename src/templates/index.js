'use strict';

/**
 * Catálogo dos modelos de e-mail (pt-BR): arquivo base de cada um (.html e .txt nesta pasta), assunto e
 * link do botão. Os links de vídeo e de senha alterada apontam para o front-end (/fiapx/<env>/web/url); o de
 * redefinição é o action_url do comando, que nunca é persistido nem logado.
 */
const MODELOS = Object.freeze({
  VIDEO_FAILED: {
    arquivo: 'video-failed',
    assunto: (n) => `Não conseguimos processar o vídeo ${n.videoName}`,
    link: (n, webUrl) => `${webUrl}/`,
  },
  VIDEO_COMPLETED: {
    arquivo: 'video-completed',
    assunto: (n) => `Seu vídeo ${n.videoName} está pronto`,
    link: (n, webUrl) => `${webUrl}/`,
  },
  PASSWORD_RESET: {
    arquivo: 'password-reset',
    assunto: () => 'Redefinição de senha do FIAP X',
    link: (n) => n.actionUrl,
  },
  PASSWORD_CHANGED: {
    arquivo: 'password-changed',
    assunto: () => 'Sua senha do FIAP X foi alterada',
    link: (n, webUrl) => `${webUrl}/recuperar-senha`,
  },
});

module.exports = { MODELOS };
