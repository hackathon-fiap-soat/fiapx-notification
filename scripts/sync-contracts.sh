#!/bin/bash
# Copia de ../fiapx-docs/contracts os schemas que a Lambda usa em tempo de execução (validação do
# SendNotification). O contract test falha se a cópia divergir do fiapx-docs; rode este script e commite.
set -euo pipefail
cd "$(dirname "$0")/.."

ORIGEM="${CONTRACTS_DIR:-../fiapx-docs/contracts}"
for f in envelope.schema.json send-notification.v1.schema.json; do
  cp "$ORIGEM/$f" "src/contracts/$f"
done
echo "schemas copiados de $ORIGEM para src/contracts/"
