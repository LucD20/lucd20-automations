#!/usr/bin/env bash
# Prepares the browser test harness: installs its page libraries and links the
# module into modules/ so the page loads it from /modules/lucd20-automations/.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
mkdir -p modules
ln -sfn ../../.. modules/lucd20-automations
echo "Ready. Serve with: (cd tools/harness && python3 -m http.server 8765)"
