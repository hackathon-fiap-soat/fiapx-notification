# New Relic nas Lambdas (Etapa 9, ADR-011 e 07-observabilidade): layer oficial com a extensão e o agente
# Node.js. O handler passa a ser o wrapper do New Relic, que chama o handler original
# (NEW_RELIC_LAMBDA_HANDLER). A extensão envia invocações, traces e logs direto ao New Relic com a license
# key, sem integração da conta AWS (que o lab não permite, ADR-019). Sem a license key (ambiente local ou
# Secret ausente), nada muda: sem layer, sem wrapper, sem segredo.
locals {
  newrelic = var.newrelic_license_key != ""
  # Layer para nodejs24.x arm64. Versão fixa (65 = extensão 2.7.3 e agente 14.10.0); atualize de propósito.
  newrelic_layer = "arn:aws:lambda:us-east-1:451483290750:layer:NewRelicNodeJS24XARM64:65"
}

# A extensão lê a license key do Secrets Manager (JSON {"LicenseKey": "..."}) com a LabRole; a chave nunca
# fica em variável de ambiente da Lambda.
resource "aws_secretsmanager_secret" "newrelic" {
  count                   = local.newrelic ? 1 : 0
  name                    = "fiapx/${var.env}/notification/newrelic"
  description             = "License key do New Relic para a extensão das Lambdas do fiapx-notification."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "newrelic" {
  count         = local.newrelic ? 1 : 0
  secret_id     = aws_secretsmanager_secret.newrelic[0].id
  secret_string = jsonencode({ LicenseKey = var.newrelic_license_key })
}

# Variáveis da extensão, somadas às de cada Lambda quando o New Relic está ligado.
locals {
  newrelic_env = local.newrelic ? {
    NEW_RELIC_ACCOUNT_ID                   = var.newrelic_account_id
    NEW_RELIC_TRUSTED_ACCOUNT_KEY          = var.newrelic_account_id
    NEW_RELIC_LICENSE_KEY_SECRET           = aws_secretsmanager_secret.newrelic[0].name
    NEW_RELIC_LAMBDA_EXTENSION_ENABLED     = "true"
    NEW_RELIC_EXTENSION_SEND_FUNCTION_LOGS = "true"
    NEW_RELIC_EXTENSION_LOG_LEVEL          = "INFO"
  } : {}
}
