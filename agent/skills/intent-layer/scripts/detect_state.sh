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
CHILD_NODES=()

if [ -f "$TARGET_PATH/CLAUDE.md" ]; then
  ROOT_FILE="CLAUDE.md"
elif [ -f "$TARGET_PATH/AGENTS.md" ]; then
  ROOT_FILE="AGENTS.md"
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
echo "child_nodes: ${#CHILD_NODES[@]}"

for node in "${CHILD_NODES[@]}"; do
  echo "  - $node"
done

echo ""
if [ -z "$ROOT_FILE" ]; then
  echo "state: none"
  echo "action: initial setup required"
elif [ "$HAS_INTENT_SECTION" = false ]; then
  echo "state: partial"
  echo "action: add Intent Layer section to $ROOT_FILE"
else
  echo "state: complete"
  echo "action: maintenance mode (audit/candidates/both)"
fi
