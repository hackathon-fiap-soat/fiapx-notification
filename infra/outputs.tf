output "queue_url" {
  value = aws_sqs_queue.commands.url
}

output "table_name" {
  value = aws_dynamodb_table.notifications.name
}

output "lambda_name" {
  description = "Nome da Lambda de notificação."
  value       = aws_lambda_function.notification.function_name
}

output "smtp_secret_arn" {
  description = "ARN do segredo fiapx/<env>/notification/smtp (também em /fiapx/<env>/notification/smtp_secret_arn)."
  value       = aws_secretsmanager_secret.smtp.arn
}
