#!/usr/bin/env bash
# scripts/cleanup-artifacts.sh — local maintenance for accumulated test/run artifacts.
# Run via `npm run cleanup`. Safe to re-run; nothing here touches source code or git state.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

print_size() {
  if [ -d "$1" ]; then
    du -sh "$1" 2>/dev/null | cut -f1
  else
    echo "(absent)"
  fi
}

echo "Before: runs=$(print_size runs) e2e-artifacts=$(print_size e2e-artifacts) web/.next=$(print_size web/.next)"

if [ -d runs ]; then
  find runs -type f -name 'review-fix-*.json' -mtime +30 -delete 2>/dev/null || true
  find runs -type f -name 'review-fix-*.result.json' -mtime +30 -delete 2>/dev/null || true
fi

if [ -d e2e-artifacts ]; then
  find e2e-artifacts -type f -mtime +14 -delete 2>/dev/null || true
  find e2e-artifacts -type d -empty -delete 2>/dev/null || true
fi

echo "After:  runs=$(print_size runs) e2e-artifacts=$(print_size e2e-artifacts) web/.next=$(print_size web/.next)"
echo
echo "Tip: web/.next is dev cache; rm -rf web/.next when it exceeds 5GB."
