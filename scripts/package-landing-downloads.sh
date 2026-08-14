#!/usr/bin/env bash
# Build clean standalone-extension ZIPs used by the landing page.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/downloads"
STAGE_ROOT="$(mktemp -d)"

cleanup() { rm -rf "$STAGE_ROOT"; }
trap cleanup EXIT

EXTENSIONS=(
  SwissCommand
  PdfExtensions
  TabHibernate
  TabMemoryCleaner
  SiteBlocker
  SiteDataClear
)

mkdir -p "$OUT_DIR"

for extension in "${EXTENSIONS[@]}"; do
  source_dir="$ROOT/$extension"
  manifest="$source_dir/manifest.json"
  if [[ ! -f "$manifest" ]]; then
    echo "Missing manifest: $manifest" >&2
    exit 1
  fi

  version="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$manifest")"
  zip_name="${extension}-v${version}.zip"
  stage="$STAGE_ROOT/$extension"
  archive="$STAGE_ROOT/$zip_name"

  mkdir -p "$stage"
  rsync -a "$source_dir/" "$stage/" \
    --exclude '.DS_Store' \
    --exclude '.git/' \
    --exclude '.gitignore' \
    --exclude 'tests/' \
    --exclude '*.md' \
    --exclude '*.txt'

  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$stage/manifest.json"
  (
    cd "$stage"
    zip -r -q "$archive" . -x '*.DS_Store'
  )

  mv -f "$archive" "$OUT_DIR/$zip_name"
  echo "Created: downloads/$zip_name"
done
