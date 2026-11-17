---
name: contratos-de-mensagens
description: Como este serviço produz e consome mensagens SQS seguindo os contratos do fiapx-docs (envelope, schemas versionados, idempotência, contract tests). Use ao escrever produtores, consumidores ou testes de mensagens.
---

# Contratos de mensagens

Os contratos (JSON Schema draft 2020-12) ficam em `fiapx-docs/contracts/`, com exemplos válidos em
`contracts/examples/`. Eles são a fonte da verdade: este repositório não define formato de mensagem por conta
própria.

## Este serviço

- **Consome** `SendNotification` (`notification-commands`): templates `VIDEO_FAILED`, `VIDEO_COMPLETED`, `PASSWORD_RESET`, `PASSWORD_CHANGED`.
- **Produz** `NotificationSent` e `NotificationFailed` na `saga-replies.fifo`, só quando `saga_id` não é nulo.
- Idempotência no DynamoDB (PK `email`, SK `message_id`); payload inválido vira `FAILED` sem reenvio.
- O `message_id` das respostas é um UUID v7 determinístico (comando + tipo): repetir a resposta gera o mesmo id.

## Regras

- **Envelope padrão** em toda mensagem nossa: `message_id` (UUID v7, chave de idempotência), `type`,
  `version`, `saga_id`, `video_id`, `correlation_id`, `occurred_at` (UTC), `payload`. Só o
  `SendNotification` aceita `saga_id`/`video_id` nulos (e-mails de senha).
- **Produtor estrito:** a mensagem produzida valida contra o schema, sem campos extras.
- **Consumidor tolerante:** ignora campos desconhecidos e aceita as versões em transição.
- **Idempotência:** processar a mesma mensagem duas vezes não pode duplicar efeito.
- Mensagens são JSON puro e versionado; nunca jobs serializados do Laravel entre serviços.
- Na `saga-replies.fifo`, `MessageGroupId = saga_id` e `MessageDeduplicationId = message_id`.
- Propague o `correlation_id` em logs (JSON) e eventos do New Relic.

## Contract tests

- Validar as mensagens produzidas contra o schema e consumir os exemplos de `contracts/examples/` nos
  testes.
- Testes e CI leem os schemas de `../fiapx-docs/contracts` (ou `CONTRACTS_DIR`); o CI faz checkout do
  `fiapx-docs` ao lado. Em tempo de execução, a Lambda usa a cópia em `src/contracts/`
  (`envelope.schema.json` e `send-notification.v1.schema.json`); o contract test falha se ela divergir.
  Mudou o schema no `fiapx-docs`? `npm run contracts:sync` e commite a cópia.
- O consumidor ignora erros `additionalProperties` (tolerância); o produtor valida estrito nos testes.
- Mudança incompatível: nova `version`. O consumidor passa a aceitar as duas versões antes de o produtor mudar
  (`fiapx-docs/06-deploy/fluxo-de-deploy.md`, "Mudanças de contrato").

## Mudar um contrato

Abra o PR no `fiapx-docs` primeiro (skill `contratos` de lá), depois ajuste produtor e consumidores.
