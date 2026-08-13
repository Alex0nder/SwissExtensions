#!/usr/bin/env bash
# Compatibility entry point; the extension-owned script builds UI and both ZIPs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/SwissExtensions/scripts/package-swiss-extensions-store.sh"
