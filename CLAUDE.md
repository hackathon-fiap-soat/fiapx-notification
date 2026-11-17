# CLAUDE.md — fiapx-notification

Contexto para o Claude Code (e para quem chega agora). Este arquivo é carregado em toda sessão aberta neste
repositório. Ele resume o projeto e aponta para a documentação completa; não a substitui.

## O projeto

**Hackathon FIAP X** (PÓS TECH SOAT, Fase 5): processador de vídeos. O usuário envia vídeos, o sistema extrai
1 frame por segundo e devolve um zip com as imagens. Requisitos do enunciado: processar vários vídeos ao mesmo
tempo, não perder requisições em picos (fila), acesso com usuário e senha, lista de status por usuário e
e-mail em caso de erro. Entregáveis: documentação da arquitetura, script do banco, links dos repositórios e
vídeo de até 10 minutos.

Stack escolhida pelo time: AWS + Terraform, EKS + KEDA, Laravel 13 (PHP 8.4.27), Lambdas Node.js 24, Aurora
MySQL Serverless v2, SQS (Standard, FIFO e DLQ), S3 com POST pré-assinado, SAGA orquestrada com outbox,
DynamoDB, e-mail por SMTP externo (Brevo, Nodemailer; Mailpit no local), New Relic + CloudWatch, React + Vite
em S3 static website (API Gateway em outra origem, com CORS).

O `prod` roda na **AWS Academy Learner Lab** (ADR-019): sem OIDC (credenciais do lab em GitHub Secrets,
atualizadas a cada sessão de ~4 h), sem roles próprias (tudo usa a `LabRole`), sem SES, CloudFront,
Route 53, spot nem CloudWatch Metric Streams.

Repositórios na organização [hackathon-fiap-soat](https://github.com/hackathon-fiap-soat), clonados lado a lado na mesma pasta:

| Repositório | Papel | Stack | Etapa |
|---|---|---|---|
| [`fiapx-docs`](https://github.com/hackathon-fiap-soat/fiapx-docs) | Documentação: arquitetura, ADRs, RFCs, contratos, OpenAPI, diagramas e entrega | Markdown + Mermaid + JSON Schema | Etapa 1 ✅ |
| [`fiapx-infra`](https://github.com/hackathon-fiap-soat/fiapx-infra) | VPC, EKS, Aurora, S3 (vídeos e site), SQS, ECR, API Gateway, SSM, orquestrador de deploy e ambiente local | Terraform + Helm + docker-compose | Etapa 2 ✅ (local), Etapas 7–8 |
| [`fiapx-auth`](https://github.com/hackathon-fiap-soat/fiapx-auth) | Lambdas de cadastro, login, senha e authorizer JWT | Node.js 24 + Terraform | Etapa 3 ✅ |
| [`fiapx-video-api`](https://github.com/hackathon-fiap-soat/fiapx-video-api) | API de vídeos, URLs pré-assinadas, orquestrador da SAGA e outbox | PHP 8.4.27 + Laravel 13 no EKS | Etapa 4 ✅ |
| [`fiapx-video-processor`](https://github.com/hackathon-fiap-soat/fiapx-video-processor) | Worker que extrai os frames com ffmpeg e gera o zip | PHP 8.4.27 + Laravel 13 no EKS + KEDA | Etapa 5 |
| **fiapx-notification** | E-mails por SMTP (Brevo) com histórico e idempotência no DynamoDB | Node.js 24 + Terraform | Etapa 6 (código pronto, falta o teste na AWS) |
| [`fiapx-web`](https://github.com/hackathon-fiap-soat/fiapx-web) | Front-end: cadastro, login, senha, upload, status e download | React + Vite + TypeScript + Tailwind | Etapa 6.5 |

## Onde está a verdade

1. **[`fiapx-docs`](https://github.com/hackathon-fiap-soat/fiapx-docs)** (versionado, `../fiapx-docs`): arquitetura C4, Domain
   Storytelling, ADRs, RFCs, contratos das mensagens (`contracts/`), OpenAPI (`api/openapi.yaml`), modelo
   de dados, ambientes, [parâmetros SSM](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/06-deploy/parametros-ssm.md) e
   [fluxo de deploy](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/06-deploy/fluxo-de-deploy.md).
2. **[Especificação](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/00-especificacao/Projeto-hackton.md)** (`fiapx-docs/00-especificacao/Projeto-hackton.md`):
   especificação completa do time (decisões, plano em etapas §12, regras §13). Na pasta de trabalho local,
   `../Projeto-hackton.md` é um link simbólico para ela.
3. **[Painel de progresso](https://claude.ai/artifact/BNesZU4D21nB7cqUoQp2rL)**: tarefas por etapa e status. Atualize ao concluir uma tarefa.

Se o código e a documentação divergirem, ou algo estiver ambíguo, **pergunte ao time** antes de assumir.
Decisão nova ou que contrarie uma existente vira ADR no `fiapx-docs`.

## Andamento (2026-11-17)

Etapas 0 a 4 concluídas. Etapa 7 (infra AWS) aplicada na AWS Academy: notification (fila e tabela), auth e
video-api implantados e testados com o smoke do `deploy-all`; ambiente derrubado depois do teste.
Etapa 6 (este repositório) implementada na branch `feat/etapa-6-notification`: Lambda, testes (cobertura
100% de linhas) e Terraform; DoD local provado com o pacote do build. Falta o PR, o deploy testado na AWS
(com os Secrets `SMTP_*` configurados) e o smoke do `deploy-all` com item `SENT`.
Ordem do plano: 3 auth → 4 video-api → 5 processor → 6 notification → 6.5 web → 7 infra AWS 🛑 → 8 CI/CD →
9 observabilidade → 10 carga e entregáveis 🛑. O estado atualizado está no painel.

## Regras do time

- **Documentação antes do código.** Mudou contrato, rota, fila ou decisão? Atualize o `fiapx-docs` primeiro.
- **`README.md` sempre atualizado**: toda mudança em propósito, stack, como rodar/testar, variáveis ou links
  atualiza o README no mesmo PR.
- **Nunca commitar segredos** (`.env`, chaves JWT, credenciais). Use `.env.example` com valores fictícios.
- **`terraform apply`/`destroy` na AWS só pelo GitHub Actions, sem exceção** (merge na `main`, ou
  `deploy-all.yml` e `destroy-all.yml` no `fiapx-infra`, ADR-016, ADR-018 e ADR-019). Apply local só no
  LocalStack. Antes de um deploy, iniciar a sessão do lab e atualizar os Secrets `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY` e `AWS_SESSION_TOKEN` (nunca em Variables: os repositórios são públicos).
- **Toda implementação termina com o deploy testado na AWS** (deploy, smoke verde, verificação e
  `destroy-all`). Infraestrutura nova é conferida antes contra as restrições do lab
  (`06-deploy/ambientes.md#restrições-conhecidas-do-lab`).
- **Todo merge na `main` faz deploy** do serviço (decisão do time). O ambiente `prod` é destruído fora das
  demonstrações; nesse período o deploy do merge falha ao ler o SSM, e é esperado.
- `main` protegida: só por PR, aprovação opcional, squash merge, histórico linear. Use a skill `fiapx-pr`.
- Conventional Commits; textos, README e mensagens ao usuário em **português do Brasil** com acentuação;
  identificadores de código em inglês.
- DDD + Clean Architecture: domínio sem framework nem SDK da AWS; dependências apontam para dentro.
- Testes com cobertura ≥ 80% e lint antes de cada commit.

## Ambiente local

`../fiapx-infra/local` sobe MySQL 8.0 (`localhost:3306`), LocalStack 4.14.0 (`http://localhost:4566`) e
Mailpit (UI `http://localhost:8025`, SMTP `localhost:1025`):

```bash
cd ../fiapx-infra/local && docker compose up -d --wait && ./scripts/verificar.sh
```

Para um serviço usar o LocalStack: `AWS_ENDPOINT_URL=http://localhost:4566`, `AWS_ACCESS_KEY_ID=test`,
`AWS_SECRET_ACCESS_KEY=test`, `AWS_REGION=us-east-1`. Os nomes dos recursos vêm do SSM em `/fiapx/local/...`
(mesmas chaves de produção, com `<env>` = `local`).

## Este repositório (Etapa 6)

Serviço autônomo, dono da própria fila, Lambda e tabela (spec §8.6, ADR-013, ADR-017, ADR-019):

- `src/handlers/sqs-handler.js` consome `SendNotification` da `notification-commands` (batch 10,
  `ReportBatchItemFailures`, DLQ após 3). Valida o payload contra o schema (cópia em `src/contracts/`,
  conferida pelo contract test; `npm run contracts:sync` atualiza); inválido vira `FAILED` sem reenvio e, com
  `saga_id`, `NotificationFailed`.
- Caso de uso `src/application/send-notification.js`: idempotência no DynamoDB `fiapx-<env>-notifications`
  (PK `email`, SK `message_id`) com `PutItem` condicional `attribute_not_exists(message_id) OR #status =
  :failed` (mais `PENDING` abandonado há 60 s); já `SENT` → só repete o `NotificationSent`. Falha no SMTP:
  `FAILED` e volta para a fila; na 3ª tentativa (`ApproximateReceiveCount`), `NotificationFailed` e DLQ.
- Respostas na `saga-replies.fifo` só quando `saga_id` não é nulo, com `message_id` UUID v7 determinístico
  (comando + tipo), para a FIFO e o `video-api` deduplicarem.
- Templates pt-BR em `src/templates/` (HTML + texto): `VIDEO_FAILED`, `VIDEO_COMPLETED`, `PASSWORD_RESET`
  (`action_url`, nunca em log nem no DynamoDB) e `PASSWORD_CHANGED`.
- SMTP com Nodemailer (`src/infrastructure/smtp-email-sender.js`): Mailpit no local (`SMTP_HOST=localhost`
  fora do compose), Brevo na AWS (587, STARTTLS), credenciais no segredo `fiapx/<env>/notification/smtp`.
- `infra/`: fila, DLQ, alarme e tabela (já existiam), Lambda `fiapx-<env>-notification` (LabRole, VPC),
  event source mapping, segredo SMTP (variáveis sensíveis `smtp_*` ← GitHub Secrets `SMTP_*`) e os parâmetros
  `notification/smtp_host`, `/smtp_port`, `/smtp_secret_arn`. Sem chave KMS gerenciada.
- Testes: `tests/unit`, `tests/contract` (schemas do `../fiapx-docs`) e `tests/integration` (LocalStack +
  Mailpit, com fila FIFO própria do teste). `npm run dev` consome a fila local como o event source mapping.
- Sobe antes do `fiapx-auth` e do `fiapx-video-api` na ordem de deploy. Chamado pelo `deploy-all`, recebe os
  Secrets do `fiapx-infra`: os `SMTP_*` precisam estar lá (ou na organização).

**DoD da Etapa 6:** vídeo inválido no fluxo local gera e-mail no Mailpit, item `SENT` no DynamoDB do
LocalStack com PK = e-mail, e a saga termina em `NOTIFIED`. Mensagem duplicada não gera segundo e-mail.

## Skills deste repositório

| Skill | Quando usar |
|---|---|
| `contratos-de-mensagens` | ao produzir ou consumir mensagens SQS |
| `deploy-aws` | ao terminar uma implementação (testar o deploy na AWS e derrubar), antes de PR com Terraform, Dockerfile ou manifests novos, e quando um deploy falhar |
| `fiapx-pr` | ao abrir e mergear o PR |
