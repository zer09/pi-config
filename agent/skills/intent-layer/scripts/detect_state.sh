#!/usr/bin/env bash
# Detect Intent Layer state in a project.
# Usage: ./detect_state.sh [path]
# Returns: none | partial | complete

set -euo pipefail

TARGET_PATH="${1:-.}"

if [ ! -d "$TARGET_PATH" ]; then
  echo "Error: path not found: $TARGET_PATH" >&2
  exit 1
fi

ROOT_FILE=""
HAS_INTENT_SECTION=false
HAS_AGENTS=false
HAS_CLAUDE=false
HAS_DUPLICATE_ROOTS=false
CHILD_NODES=()

if [ -f "$TARGET_PATH/AGENTS.md" ]; then
  HAS_AGENTS=true
fi

if [ -f "$TARGET_PATH/CLAUDE.md" ]; then
  HAS_CLAUDE=true
fi

if [ "$HAS_AGENTS" = true ]; then
  ROOT_FILE="AGENTS.md"
elif [ "$HAS_CLAUDE" = true ]; then
  ROOT_FILE="CLAUDE.md"
fi

if [ "$HAS_AGENTS" = true ] && [ "$HAS_CLAUDE" = true ]; then
  HAS_DUPLICATE_ROOTS=true
fi

if [ -n "$ROOT_FILE" ] && grep -q "## Intent Layer" "$TARGET_PATH/$ROOT_FILE" 2>/dev/null; then
  HAS_INTENT_SECTION=true
fi

while IFS= read -r file; do
  CHILD_NODES+=("$file")
done < <(
  find "$TARGET_PATH" \
    \( -path "*/.git" -o -path "*/.worktrees" -o -path "*/.codegraph" -o -path "*/.codebase-memory" -o -path "*/.rtk" -o -path "*/node_modules" -o -path "*/dist" -o -path "*/.next" -o -path "*/build" -o -path "*/coverage" -o -path "*/logs" -o -path "*/tmp" -o -path "*/__pycache__" -o -path "*/.venv" -o -path "*/venv" \) -prune -o \
    -type f -name "AGENTS.md" ! -path "$TARGET_PATH/AGENTS.md" -print 2>/dev/null
)

echo "=== Intent Layer State ==="
echo "root_file: ${ROOT_FILE:-none}"
echo "has_intent_section: $HAS_INTENT_SECTION"
echo "duplicate_root_files: $HAS_DUPLICATE_ROOTS"
echo "child_nodes: ${#CHILD_NODES[@]}"

if [ "${#CHILD_NODES[@]}" -gt 0 ]; then
  for node in "${CHILD_NODES[@]}"; do
    echo "  - $node"
  done
fi

echo ""
if [ -z "$ROOT_FILE" ]; then
  echo "state: none"
  echo "action: initial setup required"
elif [ "$HAS_INTENT_SECTION" = false ]; then
  echo "state: partial"
  if [ "$HAS_DUPLICATE_ROOTS" = true ]; then
    echo "action: resolve duplicate root files, then add Intent Layer section to $ROOT_FILE"
  else
    echo "action: add Intent Layer section to $ROOT_FILE"
  fi
else
  echo "state: complete"
  echo "action: maintenance mode (audit/candidates/both)"
fi
