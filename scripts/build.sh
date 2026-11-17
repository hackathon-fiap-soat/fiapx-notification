#!/bin/bash
# Gera dist/fiapx-notification.zip: código de src/ (com templates e schemas) e dependências de produção.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf build dist
mkdir -p build dist
cp -R src package.json package-lock.json build/
(cd build && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error && find node_modules -type d -empty -delete)
(cd build && zip -qr ../dist/fiapx-notification.zip src node_modules package.json)
rm -rf build
echo "dist/fiapx-notification.zip ($(du -h dist/fiapx-notification.zip | cut -f1))"
