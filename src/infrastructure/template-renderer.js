'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MODELOS } = require('../templates');

const DIR = path.join(__dirname, '..', 'templates');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * Substitui {{nome}} pelo valor (escapado no HTML) e {{{nome}}} pelo valor cru (só o conteúdo dentro do
 * layout). Variável desconhecida é erro de programação.
 */
function preencher(modelo, vars, html) {
  return modelo
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => valor(vars, k))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (html ? escapeHtml(valor(vars, k)) : valor(vars, k)));
}

function valor(vars, k) {
  if (!Object.hasOwn(vars, k)) throw new Error(`Variável de template desconhecida: ${k}`);
  return vars[k];
}

/** Renderiza os modelos de src/templates (lidos uma vez e guardados em memória). */
function fileTemplateRenderer(dir = DIR) {
  const cache = new Map();
  const ler = (nome) => {
    if (!cache.has(nome)) cache.set(nome, fs.readFileSync(path.join(dir, nome), 'utf8'));
    return cache.get(nome);
  };

  return {
    /**
     * @param {import('../domain/notification').Notification} n
     * @param {{webUrl: string}} ctx
     */
    render(n, { webUrl }) {
      const m = MODELOS[n.template];
      const assunto = m.assunto(n);
      const vars = {
        assunto,
        nome: n.recipient.firstName(),
        video_name: n.videoName ?? '',
        motivo: n.readableReason(),
        link: m.link(n, webUrl),
      };
      const conteudo = preencher(ler(`${m.arquivo}.html`), vars, true);
      return {
        subject: assunto,
        html: preencher(ler('_layout.html'), { ...vars, conteudo }, true),
        text: preencher(ler(`${m.arquivo}.txt`), vars, false),
      };
    },
  };
}

module.exports = { fileTemplateRenderer, escapeHtml };
