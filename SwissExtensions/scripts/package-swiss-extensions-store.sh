#!/usr/bin/env bash
# Сборка ZIP для Chrome Web Store: manifest.json в корне архива, без dev-файлов.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(grep -E '"version"' "$ROOT/manifest.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
OUT_DIR="$ROOT/dist"
ZIP_NAME="SwissExtensions-v${VERSION}-chrome-store.zip"
STAGE="$(mktemp -d)"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$OUT_DIR"

rsync -a "$ROOT/" "$STAGE/" \
  --exclude '.DS_Store' \
  --exclude 'dist/' \
  --exclude 'scripts/' \
  --exclude '_metadata/' \
  --exclude '*.md' \
  --exclude '.git/' \
  --exclude '.gitignore' \
  --exclude '.gitignore'

(
  cd "$STAGE"
  zip -r -q "$OUT_DIR/$ZIP_NAME" . -x '*.DS_Store'
)

echo "Created: $OUT_DIR/$ZIP_NAME"
unzip -l "$OUT_DIR/$ZIP_NAME" | head -20
echo "..."
echo "Total files: $(unzip -l "$OUT_DIR/$ZIP_NAME" | tail -1)"
