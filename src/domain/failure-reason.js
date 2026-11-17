'use strict';

/**
 * Motivos de falha do vídeo (códigos do fiapx-video-api, FailureReason) em texto legível para o e-mail.
 * Os textos são os mesmos que a API mostra (fiapx-docs/03-arquitetura/saga.md, "Motivos legíveis").
 */
const TEXTOS = Object.freeze({
  INVALID_UPLOAD: 'O arquivo enviado não é um vídeo válido ou ultrapassa 500 MB',
  QUOTA_EXCEEDED: 'Você já tem 5 vídeos em processamento. Aguarde a conclusão e envie de novo',
  FFMPEG_ERROR: 'O arquivo de vídeo está corrompido ou em um formato que não conseguimos ler',
  NO_FRAMES: 'Não foi possível extrair imagens do vídeo. Ele pode ter menos de 1 segundo',
  DOWNLOAD_ERROR: 'Tivemos um problema temporário ao processar o vídeo. Tente enviar de novo',
  UPLOAD_ERROR: 'Tivemos um problema temporário ao processar o vídeo. Tente enviar de novo',
  PROCESSING_TIMEOUT: 'O processamento demorou mais do que o esperado. Tente enviar de novo',
});

const GENERICO = 'Ocorreu um erro inesperado ao processar o vídeo. Tente enviar de novo';
const CODIGO = /^[A-Z][A-Z0-9_]*$/;

/**
 * Texto legível do motivo. Código conhecido vira o texto da tabela; código desconhecido ou motivo ausente
 * vira uma mensagem genérica; texto livre (não é código) é mostrado como veio.
 * @param {string|undefined|null} reason
 */
function readableReason(reason) {
  if (typeof reason !== 'string' || reason.trim() === '') return GENERICO;
  const r = reason.trim();
  if (Object.hasOwn(TEXTOS, r)) return TEXTOS[r];
  return CODIGO.test(r) ? GENERICO : r;
}

module.exports = { readableReason };
