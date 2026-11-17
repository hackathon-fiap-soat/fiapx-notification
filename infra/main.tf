# Recursos que pertencem a este repositório (spec §8.6): a fila notification-commands com DLQ e alarme, e a
# tabela de histórico. A Lambda que consome a fila chega na Etapa 6; até lá, os comandos esperam na fila
# (retenção de 4 dias). Os outros repositórios encontram tudo pelo SSM (ADR-001).
locals {
  prefix = "fiapx-${var.env}"
  ssm    = "/fiapx/${var.env}"
}

data "aws_ssm_parameter" "alerts_topic_arn" {
  name = "${local.ssm}/sns/alerts_topic_arn"
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${local.prefix}-notification-commands-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "commands" {
  name                       = "${local.prefix}-notification-commands"
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  alarm_name          = "${aws_sqs_queue.dlq.name}-com-mensagens"
  alarm_description   = "Mensagem na DLQ ${aws_sqs_queue.dlq.name}: investigar e reprocessar."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [nonsensitive(data.aws_ssm_parameter.alerts_topic_arn.value)]
}

# Histórico e idempotência dos e-mails (spec §8.6.2): PK email, SK message_id.
resource "aws_dynamodb_table" "notifications" {
  name         = "${local.prefix}-notifications"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"
  range_key    = "message_id"

  attribute {
    name = "email"
    type = "S"
  }
  attribute {
    name = "message_id"
    type = "S"
  }
  attribute {
    name = "created_at"
    type = "S"
  }

  # Histórico em ordem cronológica por e-mail (LSI só pode ser criado junto com a tabela).
  local_secondary_index {
    name            = "email-created_at-index"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled = true
  }
}

resource "aws_ssm_parameter" "this" {
  for_each = {
    "sqs/notification-commands/url"     = aws_sqs_queue.commands.url
    "sqs/notification-commands/arn"     = aws_sqs_queue.commands.arn
    "sqs/notification-commands-dlq/url" = aws_sqs_queue.dlq.url
    "dynamodb/notifications/table_name" = aws_dynamodb_table.notifications.name
  }
  name  = "${local.ssm}/${each.key}"
  type  = "String"
  value = each.value
}
