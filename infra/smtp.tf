# Credenciais do provedor SMTP (spec §8.6.4, ADR-019): a Lambda lê o segredo na inicialização. Usa a chave
# padrão do Secrets Manager (aws/secretsmanager, já usada na conta do lab); nenhuma chave KMS gerenciada nova.
locals {
  # Sem o GitHub Secret SMTP_FROM o apply não quebra: o remetente fica num marcador visível (domínio
  # reservado .invalid), o provedor recusa o envio e o erro aparece em last_error e no log.
  smtp_from = var.smtp_from != "" ? var.smtp_from : "configure-o-secret-SMTP_FROM@fiapx.invalid"
}

resource "aws_secretsmanager_secret" "smtp" {
  name        = "fiapx/${var.env}/notification/smtp"
  description = "Credenciais SMTP do fiapx-notification: JSON {user, password, from}."
  # O ambiente é destruído e recriado entre as demonstrações: sem janela de recuperação, o nome fica livre.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "smtp" {
  secret_id = aws_secretsmanager_secret.smtp.id
  secret_string = jsonencode({
    user     = var.smtp_user
    password = var.smtp_password
    from     = local.smtp_from
  })
}

resource "aws_ssm_parameter" "smtp" {
  for_each = {
    "notification/smtp_host"       = var.smtp_host
    "notification/smtp_port"       = tostring(var.smtp_port)
    "notification/smtp_secret_arn" = aws_secretsmanager_secret.smtp.arn
  }
  name  = "${local.ssm}/${each.key}"
  type  = "String"
  value = each.value
}
