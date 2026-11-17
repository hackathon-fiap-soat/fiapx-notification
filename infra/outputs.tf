output "queue_url" {
  value = aws_sqs_queue.commands.url
}

output "table_name" {
  value = aws_dynamodb_table.notifications.name
}
