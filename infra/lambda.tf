# Lambda que consome a notification-commands (spec §8.6). Na AWS Academy não é possível criar roles, então
# ela usa a LabRole (ADR-019). Fica na VPC (subnets privadas) e sai pelo NAT para o provedor SMTP; o
# security group das Lambdas (fiapx-infra) libera toda a saída.
data "aws_ssm_parameter" "private_subnet_ids" {
  name = "${local.ssm}/vpc/private_subnet_ids"
}

data "aws_ssm_parameter" "lambda_security_group_id" {
  name = "${local.ssm}/vpc/lambda_security_group_id"
}

data "aws_ssm_parameter" "saga_replies_url" {
  name = "${local.ssm}/sqs/saga-replies/url"
}

data "aws_ssm_parameter" "web_url" {
  name = "${local.ssm}/web/url"
}

data "aws_iam_role" "lab" {
  name = "LabRole"
}

locals {
  lambda_name = "${local.prefix}-notification"
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "notification" {
  function_name    = local.lambda_name
  role             = data.aws_iam_role.lab.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = local.newrelic ? "newrelic-lambda-wrapper.handler" : "src/handlers/sqs-handler.handler"
  layers           = local.newrelic ? [local.newrelic_layer] : []
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  memory_size      = 256
  # Menor que o visibility timeout da fila (60 s), como a AWS exige; cada envio SMTP tem timeout de 10 s.
  timeout = 30

  environment {
    variables = merge({
      FIAPX_ENV               = var.env
      NOTIFICATION_TABLE_NAME = aws_dynamodb_table.notifications.name
      SAGA_REPLIES_QUEUE_URL  = data.aws_ssm_parameter.saga_replies_url.value
      WEB_URL                 = data.aws_ssm_parameter.web_url.value
      SMTP_HOST               = var.smtp_host
      SMTP_PORT               = tostring(var.smtp_port)
      SMTP_SECRET_ARN         = aws_secretsmanager_secret.smtp.arn
      MAX_ATTEMPTS            = "3" # igual ao maxReceiveCount da fila
      }, local.newrelic_env,
      local.newrelic ? { NEW_RELIC_LAMBDA_HANDLER = "src/handlers/sqs-handler.handler" } : {},
    )
  }

  vpc_config {
    subnet_ids         = split(",", nonsensitive(data.aws_ssm_parameter.private_subnet_ids.value))
    security_group_ids = [data.aws_ssm_parameter.lambda_security_group_id.value]
  }

  logging_config {
    log_format = "Text" # o handler já escreve uma linha JSON por evento
    log_group  = aws_cloudwatch_log_group.lambda.name
  }

  # O segredo precisa ter versão antes da primeira invocação.
  depends_on = [aws_secretsmanager_secret_version.smtp, aws_secretsmanager_secret_version.newrelic]
}

resource "aws_lambda_event_source_mapping" "commands" {
  event_source_arn                   = aws_sqs_queue.commands.arn
  function_name                      = aws_lambda_function.notification.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  # Só as mensagens que falharam voltam para a fila; depois de 3 recebimentos vão para a DLQ.
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.max_concurrency
  }
}
