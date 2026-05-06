#!/bin/bash
set -euo pipefail

# Prune old ignored runtime artifacts to keep ~/.pi clean.
# Usage:
#   bash ~/.pi/agent/cleanup-sessions.sh
#   bash ~/.pi/agent/cleanup-sessions.sh --days=14
#   bash ~/.pi/agent/cleanup-sessions.sh --aggressive

DAYS=30
AGGRESSIVE=false
SESSIONS_DIR="$HOME/.pi/agent/sessions"
TMP_DIR="$HOME/.pi/tmp"

for arg in "$@"; do
    case "$arg" in
        --aggressive)
            AGGRESSIVE=true
            ;;
        --days=*)
            DAYS="${arg#--days=}"
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: $0 [--days=N] [--aggressive]" >&2
            exit 2
            ;;
    esac
done

if ! [[ "$DAYS" =~ ^[0-9]+$ ]]; then
    echo "Invalid --days value: $DAYS" >&2
    exit 2
fi

if [ ! -d "$SESSIONS_DIR" ]; then
    echo "No sessions directory found: $SESSIONS_DIR"
    exit 0
fi

echo "Cleaning session artifacts older than $DAYS days..."

FILES_DELETED=$(find "$SESSIONS_DIR" -mindepth 1 -type f -mtime +"$DAYS" -print -delete 2>/dev/null | wc -l)
echo "Session files deleted: $FILES_DELETED"

DIRS_DELETED=$(find "$SESSIONS_DIR" -mindepth 1 -type d -empty -print -delete 2>/dev/null | wc -l)
echo "Empty session dirs removed: $DIRS_DELETED"

if [ "$AGGRESSIVE" = true ] && [ -d "$TMP_DIR" ]; then
    TMP_DELETED=$(find "$TMP_DIR" -mindepth 1 -type f -mtime +7 -print -delete 2>/dev/null | wc -l)
    echo "Aggressive tmp files deleted: $TMP_DELETED"
fi

echo "Session cleanup complete."
