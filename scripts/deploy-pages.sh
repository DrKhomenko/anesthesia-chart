#!/usr/bin/env bash
# Публикация dist в ветку gh-pages. Токен берётся из $GH_TOKEN и не печатается.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${GH_TOKEN:-}" ] || { echo "GH_TOKEN не задан"; exit 1; }
AUTH="Authorization: Basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
TMP=$(mktemp -d)
cp -r dist/. "$TMP"/ && touch "$TMP/.nojekyll"
cd "$TMP" && git init -q -b gh-pages && git add -A && git -c user.name="anesthesia-chart" -c user.email="bot@localhost" commit -qm "deploy $(date -Iseconds)"
git -c http.extraheader="$AUTH" push -q -f https://github.com/DrKhomenko/anesthesia-chart.git gh-pages 2>&1 | sed 's/x-access-token[^@]*@//g'
rm -rf "$TMP"; echo "pushed gh-pages"
