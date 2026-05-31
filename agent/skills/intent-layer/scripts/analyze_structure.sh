#!/usr/bin/env bash
# Analyze codebase structure for Intent Layer placement.
# Usage: ./analyze_structure.sh [path]

set -euo pipefail

TARGET_PATH="${1:-.}"

if [ ! -d "$TARGET_PATH" ]; then
  echo "Error: path not found: $TARGET_PATH" >&2
  exit 1
fi

PRUNE_ARGS=(
  -path "*/.git" -o -path "*/.worktrees" -o -path "*/.codegraph"
  -o -path "*/.codebase-memory" -o -path "*/.rtk" -o -path "*/node_modules"
  -o -path "*/dist" -o -path "*/.next" -o -path "*/build"
  -o -path "*/coverage" -o -path "*/logs" -o -path "*/tmp"
  -o -path "*/__pycache__" -o -path "*/.venv" -o -path "*/venv"
)

echo "=== Intent Layer Structure Analysis ==="
echo "Target: $TARGET_PATH"
echo ""

echo "## Directory Structure (depth 3)"
find "$TARGET_PATH" -maxdepth 3 \( "${PRUNE_ARGS[@]}" \) -prune -o -type d -print 2>/dev/null | head -50

echo ""
echo "## Existing Intent Nodes"
find "$TARGET_PATH" \( "${PRUNE_ARGS[@]}" \) -prune -o \
  \( -name "AGENTS.md" -o -name "CLAUDE.md" \) -type f -print 2>/dev/null | head -20

echo ""
echo "## Large Directories (potential boundaries)"
echo "(Directories with >20 files)"
find "$TARGET_PATH" \( "${PRUNE_ARGS[@]}" \) -prune -o -type d -exec sh -c '
  count=$(find "$1" -maxdepth 1 -type f | wc -l | tr -d " ")
  [ "$count" -gt 20 ] && echo "$count files: $1"
' _ {} \; 2>/dev/null | sort -rn | head -15

echo ""
echo "## Package/Config Files (semantic boundaries)"
find "$TARGET_PATH" -maxdepth 4 \( "${PRUNE_ARGS[@]}" \) -prune -o \
  \( -name "package.json" -o -name "Cargo.toml" -o -name "go.mod" -o -name "pyproject.toml" \) \
  -type f -print 2>/dev/null | head -20

echo ""
echo "## Suggested Intent Node Locations"
echo "1. Root: $TARGET_PATH/AGENTS.md (required unless CLAUDE.md is chosen)"

rank=2
for dir in src lib app packages services api; do
  if [ -d "$TARGET_PATH/$dir" ]; then
    echo "$rank. Source: $TARGET_PATH/$dir/AGENTS.md"
    rank=$((rank + 1))
  fi
done

echo ""
echo "Run estimate_tokens.sh on specific directories to determine if they need their own node."
