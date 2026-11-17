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
