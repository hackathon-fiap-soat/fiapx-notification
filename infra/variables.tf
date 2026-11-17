variable "env" {
  description = "Ambiente (prefixo fiapx-<env> e /fiapx/<env>/)."
  type        = string
  default     = "prod"
}

variable "region" {
  description = "Região da AWS."
  type        = string
  default     = "us-east-1"
}

variable "lambda_zip" {
  description = "Pacote gerado por `npm run build`."
  type        = string
  default     = "../dist/fiapx-notification.zip"
}

variable "log_retention_days" {
  description = "Retenção dos logs da Lambda no CloudWatch."
  type        = number
  default     = 14
}

variable "max_concurrency" {
  description = "Máximo de execuções simultâneas da Lambda pela fila (protege a cota do provedor SMTP)."
  type        = number
  default     = 5
}

# Provedor SMTP (ADR-019). Host e porta são públicos; usuário, senha e remetente chegam dos GitHub Secrets
# SMTP_USER, SMTP_PASSWORD e SMTP_FROM como TF_VAR_* no deploy.yml e vão para o Secrets Manager.
variable "smtp_host" {
  description = "Host do provedor SMTP."
  type        = string
  default     = "smtp-relay.brevo.com"
}

variable "smtp_port" {
  description = "Porta SMTP (587 com STARTTLS; 465 com TLS direto)."
  type        = number
  default     = 587
}

variable "smtp_user" {
  description = "Usuário (login) do provedor SMTP."
  type        = string
  default     = ""
  sensitive   = true
}

variable "smtp_password" {
  description = "Senha (chave SMTP) do provedor."
  type        = string
  default     = ""
  sensitive   = true
}

variable "smtp_from" {
  description = "Remetente verificado no provedor (single sender). Vazio grava um marcador que deixa claro que falta configurar."
  type        = string
  default     = ""
  sensitive   = true
}
