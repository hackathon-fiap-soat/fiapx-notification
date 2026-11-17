# fiapx-notification

Notificação do FIAP X: fila SQS → Lambda que envia e-mail por SMTP (provedor externo, padrão Brevo), registra cada envio no DynamoDB (chave = e-mail) e responde à SAGA.

> Parte do **Hackathon FIAP X — Processador de Vídeos** (PÓS TECH SOAT, Fase 5).
> 🚧 Em construção. A documentação vem antes do código: a arquitetura, as decisões (ADRs/RFCs) e os
> contratos ficam em [`fiapx-docs`](https://github.com/hackathon-fiap-soat/fiapx-docs).

## Stack

Node.js 24 + Nodemailer (SMTP; Mailpit no ambiente local) + DynamoDB + SQS + Terraform

## Infraestrutura (`infra/`)

Já existe (antes da Lambda, para os outros serviços subirem na AWS):

- fila `fiapx-<env>-notification-commands` (Standard, visibility 60 s, retenção 4 dias) com DLQ após 3
  recebimentos e alarme da DLQ no tópico SNS do `fiapx-infra`;
- tabela `fiapx-<env>-notifications` (PK `email`, SK `message_id`, LSI `email-created_at-index`, TTL
  `expires_at`, PITR);
- parâmetros SSM `/fiapx/<env>/sqs/notification-commands/url`, `/arn`, `/sqs/notification-commands-dlq/url` e
  `/dynamodb/notifications/table_name`.

A Lambda (Etapa 6) envia por SMTP porque a AWS Academy não libera o SES
([ADR-019](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/04-adrs/ADR-019-deploy-na-aws-academy-learner-lab.md)).

## Deploy

- `deploy.yml`: `terraform apply` de `infra/` em todo merge na `main` e quando o `deploy-all` do `fiapx-infra`
  chama (ADR-018). Credenciais da AWS Academy nos Secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e
  `AWS_SESSION_TOKEN`; o state fica no bucket `fiapx-tfstate-<account_id>`, chave `fiapx-notification/prod.tfstate`.
- `destroy.yml`: chamado pelo `destroy-all`.
- `ci.yml`: `terraform fmt -check` e `validate` em todo PR.

## Como rodar

O código da Lambda chega na Etapa 6. No ambiente local, a fila e a tabela são criadas pelo
`fiapx-infra/local`.

## Links

- Documentação: [`fiapx-docs`](https://github.com/hackathon-fiap-soat/fiapx-docs)
- Todos os repositórios: [hackathon-fiap-soat](https://github.com/hackathon-fiap-soat)

## Contribuição

- A branch `main` é protegida: toda mudança entra por Pull Request (a aprovação é opcional; qualquer integrante, inclusive o autor, pode fazer o merge).
- O `README.md` deve estar sempre atualizado: toda mudança que afete propósito, stack, como rodar/testar,
  variáveis de ambiente ou links atualiza este arquivo no mesmo PR.
- Nunca commitar segredos (`.env`, chaves, tokens). Use `.env.example` com valores fictícios.
- Contexto para o Claude Code: [`CLAUDE.md`](CLAUDE.md) (projeto, regras e o papel deste repositório) e skills em
  [`.claude/skills/`](.claude/skills/) com os procedimentos deste repositório.

## Licença

[MIT](LICENSE)
