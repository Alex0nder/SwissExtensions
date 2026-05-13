#!/usr/bin/env bash
# Сборка ZIP для Chrome Web Store: только runtime-файлы, manifest в корне архива.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="${ROOT}/SwissExtensions"
OUT="${ROOT}/dist"
mkdir -p "$OUT"
VER="$(grep -m1 '"version"' "${EXT}/manifest.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')"
ZIP="${OUT}/SwissExtensions-v${VER}-chrome-store.zip"
rm -f "$ZIP"
(
  cd "$EXT"
  zip -r "$ZIP" . \
    -x "*.md" \
    -x ".DS_Store" \
    -x "index.html" \
    -x "_metadata/*" \
    -x "_metadata/*/*" \
    -x "_metadata/*/*/*" \
    -x "lib/*" \
    -x "lib/*/*"
)
echo "OK: $ZIP"
unzip -l "$ZIP" | head -45
