#!/usr/bin/env bash
# Chrome Web Store ZIP: manifest.json at archive root, no dev/metadata files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="${ROOT}/SwissExtensions"
OUT="${ROOT}/dist"
VER="$(grep -m1 '"version"' "${EXT}/manifest.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')"
ZIP="${OUT}/SwissExtensions-v${VER}-chrome-store.zip"
STAGE="$(mktemp -d)"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$OUT"
rm -f "$ZIP"

rsync -a "${EXT}/" "${STAGE}/" \
  --exclude '.DS_Store' \
  --exclude 'dist/' \
  --exclude 'scripts/' \
  --exclude '_metadata/' \
  --exclude '*.md' \
  --exclude '.git/' \
  --exclude '.gitignore'

(
  cd "$STAGE"
  zip -r -q "$ZIP" . -x '*.DS_Store'
)

echo "OK: $ZIP"
unzip -l "$ZIP" | head -30
echo "..."
echo "Total: $(unzip -l "$ZIP" | tail -1)"
