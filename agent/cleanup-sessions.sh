#!/bin/bash
set -euo pipefail

# Prune old ignored runtime artifacts to keep ~/.pi clean.
# Usage:
#   bash ~/.pi/agent/cleanup-sessions.sh
#   bash ~/.pi/agent/cleanup-sessions.sh --days=14
#   bash ~/.pi/agent/cleanup-sessions.sh --aggressive
#   bash ~/.pi/agent/cleanup-sessions.sh --dry-run

DAYS=30
AGGRESSIVE=false
DRY_RUN=false
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
        --dry-run)
            DRY_RUN=true
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: $0 [--days=N] [--aggressive] [--dry-run]" >&2
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

# Verify sessions dir is not a symlink to somewhere unexpected
if [ -L "$SESSIONS_DIR" ]; then
    REAL_SESSIONS=$(readlink -f "$SESSIONS_DIR")
    case "$REAL_SESSIONS" in
        "$HOME/.pi/"*) ;; # OK, still under ~/.pi
        *)
            echo "ERROR: $SESSIONS_DIR is a symlink to $REAL_SESSIONS (outside ~/.pi). Refusing to delete." >&2
            exit 1
            ;;
    esac
fi

echo "Cleaning session artifacts older than $DAYS days..."
if [ "$DRY_RUN" = true ]; then
    echo "(dry-run mode: no files will be deleted)"
fi

if [ "$DRY_RUN" = true ]; then
    FILES_FOUND=$(find "$SESSIONS_DIR" -mindepth 1 -type f ! -type l -mtime +"$DAYS" -print 2>/dev/null | wc -l)
    echo "Session files that would be deleted: $FILES_FOUND"
else
    FILES_DELETED=$(find "$SESSIONS_DIR" -mindepth 1 -type f ! -type l -mtime +"$DAYS" -print -delete 2>/dev/null | wc -l)
    echo "Session files deleted: $FILES_DELETED"
fi

if [ "$DRY_RUN" = true ]; then
    DIRS_FOUND=$(find "$SESSIONS_DIR" -mindepth 1 -type d -empty -print 2>/dev/null | wc -l)
    echo "Empty session dirs that would be removed: $DIRS_FOUND"
else
    DIRS_DELETED=$(find "$SESSIONS_DIR" -mindepth 1 -type d -empty -print -delete 2>/dev/null | wc -l)
    echo "Empty session dirs removed: $DIRS_DELETED"
fi

if [ "$AGGRESSIVE" = true ] && [ -d "$TMP_DIR" ]; then
    # Verify tmp dir is not a symlink outside ~/.pi
    if [ -L "$TMP_DIR" ]; then
        REAL_TMP=$(readlink -f "$TMP_DIR")
        case "$REAL_TMP" in
            "$HOME/.pi/"*) ;; # OK
            *)
                echo "WARNING: $TMP_DIR is a symlink to $REAL_TMP (outside ~/.pi). Skipping aggressive cleanup." >&2
                ;;
        esac
    else
        if [ "$DRY_RUN" = true ]; then
            TMP_FOUND=$(find "$TMP_DIR" -mindepth 1 -type f ! -type l -mtime +7 -print 2>/dev/null | wc -l)
            echo "Aggressive tmp files that would be deleted: $TMP_FOUND"
        else
            TMP_DELETED=$(find "$TMP_DIR" -mindepth 1 -type f ! -type l -mtime +7 -print -delete 2>/dev/null | wc -l)
            echo "Aggressive tmp files deleted: $TMP_DELETED"
        fi
    fi
fi

echo "Session cleanup complete."
