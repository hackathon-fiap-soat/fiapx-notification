'use strict';

const nodemailer = require('nodemailer');

const NOME_REMETENTE = 'FIAP X';
const TIMEOUT_MS = 10_000;

/**
 * Remetente com nome de exibição "FIAP X". Aceita só o e-mail ("time@exemplo.com") ou já formatado
 * ("Nome <time@exemplo.com>").
 */
function remetente(from) {
  return from.includes('<') ? from : { name: NOME_REMETENTE, address: from };
}

/** Message-ID devolvido pelo envio, sem os sinais < >. */
function idDoProvedor(info) {
  const id = (info && info.messageId) || '';
  return id.replace(/^<|>$/g, '') || null;
}

/**
 * Envio por SMTP com Nodemailer (ADR-019), o mesmo adaptador nos dois ambientes: Mailpit no local (sem
 * autenticação nem TLS) e o provedor externo na AWS (OCI Email Delivery, ADR-020, porta 587 com STARTTLS obrigatório quando há
 * usuário). Porta 465 usa TLS direto.
 *
 * @param {() => Promise<{host: string, port: number, user: string, password: string, from: string}>} smtpConfig
 * @param {(opts: object) => {sendMail: Function}} [createTransport]
 */
function smtpEmailSender(smtpConfig, createTransport = nodemailer.createTransport) {
  let transporte;
  let de;

  async function preparar() {
    if (transporte) return;
    const c = await smtpConfig();
    if (!c.from) throw new Error('Remetente SMTP (from) não configurado no segredo fiapx/<env>/notification/smtp.');
    const autenticado = Boolean(c.user);
    transporte = createTransport({
      host: c.host,
      port: c.port,
      secure: c.port === 465,
      requireTLS: autenticado && c.port !== 465,
      auth: autenticado ? { user: c.user, pass: c.password } : undefined,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    de = remetente(c.from);
  }

  return {
    /** @param {import('../application/ports').EmailMessage} m */
    async send(m) {
      await preparar();
      const info = await transporte.sendMail({
        from: de,
        to: { name: m.to.name, address: m.to.email },
        subject: m.subject,
        html: m.html,
        text: m.text,
      });
      return { providerMessageId: idDoProvedor(info) };
    },
  };
}

module.exports = { smtpEmailSender };
