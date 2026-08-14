#!/usr/bin/env bash
# Сборка ZIP для Chrome Web Store: сначала UI (React/shadcn), затем пакет.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
FRONTEND="$REPO_ROOT/frontend"

if [[ -d "$FRONTEND" ]]; then
  echo "Building Swiss UI (shadcn)…"
  (cd "$FRONTEND" && npm run build -w swiss-ui)
fi

VERSION="$(grep -E '"version"' "$ROOT/manifest.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
OUT_DIR="$ROOT/dist"
ZIP_NAME="SwissExtensions-v${VERSION}-chrome-store.zip"
PUBLIC_OUT_DIR="$REPO_ROOT/downloads"
PUBLIC_ZIP_NAME="SwissExtensions-v${VERSION}.zip"
STAGE="$(mktemp -d)"
ARCHIVE_STAGE="$(mktemp -d)"

cleanup() { rm -rf "$STAGE" "$ARCHIVE_STAGE"; }
trap cleanup EXIT

mkdir -p "$OUT_DIR"
mkdir -p "$PUBLIC_OUT_DIR"

# Keep only the package for the manifest version. Old ZIPs are easy to upload by mistake.
find "$OUT_DIR" -maxdepth 1 -type f -name 'SwissExtensions-v*-chrome-store.zip' ! -name "$ZIP_NAME" -delete
find "$PUBLIC_OUT_DIR" -maxdepth 1 -type f -name 'SwissExtensions-v*.zip' ! -name "$PUBLIC_ZIP_NAME" -delete

if [[ ! -d "$ROOT/ui-dist" ]]; then
  echo "Missing ui-dist/. Build frontend/apps/swiss-ui first." >&2
  exit 1
fi

rsync -a "$ROOT/" "$STAGE/" \
  --exclude '.DS_Store' \
  --exclude 'dist/' \
  --exclude 'store-assets/' \
  --exclude 'scripts/' \
  --exclude 'tests/' \
  --exclude '_metadata/' \
  --exclude '*.md' \
  --exclude '.git/' \
  --exclude '.gitignore'

for required in manifest.json service_worker.js core_logic.js content.js ui-dist/side_panel.html ui-dist/suspended.html; do
  if [[ ! -f "$STAGE/$required" ]]; then
    echo "Missing required packaged file: $required" >&2
    exit 1
  fi
done
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$STAGE/manifest.json"

(
  cd "$STAGE"
  zip -r -q "$ARCHIVE_STAGE/$ZIP_NAME" . -x '*.DS_Store'
)

mv -f "$ARCHIVE_STAGE/$ZIP_NAME" "$OUT_DIR/$ZIP_NAME"
cp "$OUT_DIR/$ZIP_NAME" "$PUBLIC_OUT_DIR/$PUBLIC_ZIP_NAME"

echo "Created: $OUT_DIR/$ZIP_NAME"
echo "Created: $PUBLIC_OUT_DIR/$PUBLIC_ZIP_NAME"
unzip -l "$OUT_DIR/$ZIP_NAME" | head -30
echo "..."
echo "Total files: $(unzip -l "$OUT_DIR/$ZIP_NAME" | tail -1)"
