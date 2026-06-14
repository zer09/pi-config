#!/usr/bin/env bash
# Estimate token count for a directory to determine Intent Node needs.
# Usage: ./estimate_tokens.sh <path>
# Token estimate: about 4 chars per token.

set -euo pipefail

TARGET_PATH="${1:-.}"

if [ ! -d "$TARGET_PATH" ]; then
  echo "Error: path not found: $TARGET_PATH" >&2
  exit 1
fi

DIR_NAME=$(basename "$TARGET_PATH")

SOURCE_NAME_EXPR=(
  -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx"
  -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java"
  -o -name "*.rb" -o -name "*.php" -o -name "*.swift" -o -name "*.kt"
  -o -name "*.c" -o -name "*.cpp" -o -name "*.h" -o -name "*.cs"
  -o -name "*.vue" -o -name "*.svelte" -o -name "*.astro"
  -o -name "*.md" -o -name "*.mdx" -o -name "*.json"
  -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml"
  -o -name "*.sql" -o -name "*.graphql" -o -name "*.prisma"
)

COUNT_NAME_EXPR=(
  -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx"
  -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java"
  -o -name "*.astro" -o -name "*.vue" -o -name "*.svelte"
  -o -name "*.md" -o -name "*.mdx"
)

PRUNE_ARGS=(
  -path "*/.git" -o -path "*/.worktrees" -o -path "*/.codegraph"
  -o -path "*/.codebase-memory" -o -path "*/.rtk" -o -path "*/node_modules"
  -o -path "*/dist" -o -path "*/.next" -o -path "*/build"
  -o -path "*/coverage" -o -path "*/logs" -o -path "*/tmp"
  -o -path "*/__pycache__" -o -path "*/.venv" -o -path "*/venv"
)

echo "=== Token Estimate: $DIR_NAME ==="
echo ""

BYTES=$(
  find "$TARGET_PATH" \( "${PRUNE_ARGS[@]}" \) -prune -o \
    -type f \( "${SOURCE_NAME_EXPR[@]}" \) -exec cat {} + 2>/dev/null | wc -c | tr -d ' '
)

TOKENS=$((BYTES / 4))

FILE_COUNT=$(
  find "$TARGET_PATH" \( "${PRUNE_ARGS[@]}" \) -prune -o \
    -type f \( "${COUNT_NAME_EXPR[@]}" \) -print 2>/dev/null | wc -l | tr -d ' '
)

FORMATTED=$(
  awk -v n="$TOKENS" 'BEGIN {
    if (n >= 1000000) printf "%.1fM", n / 1000000;
    else if (n >= 1000) printf "%.1fk", n / 1000;
    else printf "%d", n;
  }'
)

echo "Total tokens: ~$FORMATTED ($TOKENS)"
echo "File count: $FILE_COUNT"
echo ""

if [ "$TOKENS" -lt 20000 ]; then
  echo "Threshold: <20k"
  echo "Recommendation: No dedicated Intent Node needed"
elif [ "$TOKENS" -lt 64000 ]; then
  echo "Threshold: 20-64k"
  echo "Recommendation: Good candidate for 2-3k token Intent Node"
else
  echo "Threshold: >64k"
  echo "Recommendation: Consider splitting into child Intent Nodes"
fi
