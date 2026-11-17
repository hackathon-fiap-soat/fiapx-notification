'use strict';

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

/**
 * Configuração resolvida sob demanda e guardada em memória enquanto a Lambda estiver quente.
 *
 * Cada valor vem de uma variável de ambiente (o Terraform as preenche na AWS) ou, se ela não existir, do
 * SSM em /fiapx/<FIAPX_ENV>/... (ambiente local). As credenciais SMTP vêm do segredo
 * fiapx/<env>/notification/smtp (JSON {user, password, from}). Os SDKs da AWS respeitam AWS_ENDPOINT_URL,
 * o que aponta tudo para o LocalStack no ambiente local.
 */
function createConfig(env = process.env, clients = {}) {
  const ssm = clients.ssm || new SSMClient({});
  const secrets = clients.secrets || new SecretsManagerClient({});
  const prefixo = `/fiapx/${env.FIAPX_ENV || 'local'}`;
  const cache = new Map();

  function memo(chave, fn) {
    if (!cache.has(chave)) {
      cache.set(chave, fn().catch((e) => {
        cache.delete(chave);
        throw e;
      }));
    }
    return cache.get(chave);
  }

  async function parametro(nome) {
    const r = await ssm.send(new GetParameterCommand({ Name: `${prefixo}/${nome}` }));
    return r.Parameter.Value;
  }

  const deEnvOuSsm = (variavel, nome) => memo(variavel, async () => env[variavel] || parametro(nome));

  return {
    tableName: () => deEnvOuSsm('NOTIFICATION_TABLE_NAME', 'dynamodb/notifications/table_name'),
    sagaRepliesQueueUrl: () => deEnvOuSsm('SAGA_REPLIES_QUEUE_URL', 'sqs/saga-replies/url'),
    webUrl: () => memo('webUrl', async () => (await deEnvOuSsm('WEB_URL', 'web/url')).replace(/\/+$/, '')),
    /**
     * Servidor e credenciais SMTP. SMTP_HOST/SMTP_PORT sobrescrevem o SSM (ex.: "localhost" para quem roda
     * fora do compose, onde o SSM local diz "mailpit").
     */
    smtp: () => memo('smtp', async () => {
      const [host, porta, arn] = await Promise.all([
        deEnvOuSsm('SMTP_HOST', 'notification/smtp_host'),
        deEnvOuSsm('SMTP_PORT', 'notification/smtp_port'),
        deEnvOuSsm('SMTP_SECRET_ARN', 'notification/smtp_secret_arn'),
      ]);
      const r = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
      const s = JSON.parse(r.SecretString);
      return { host, port: Number(porta), user: s.user || '', password: s.password || '', from: s.from || '' };
    }),
  };
}

module.exports = { createConfig };
