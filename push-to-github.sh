#!/usr/bin/env bash
# Requires: gh auth login -h github.com (one time)
set -e
cd "$(dirname "$0")"
git init -b main
git add .
git commit -m "Initial commit: GrokBot"
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/alenworcester-png/grokbot-open.git
git push -u origin main
echo "Published: https://github.com/alenworcester-png/grokbot-open"
