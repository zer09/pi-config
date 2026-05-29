#!/bin/bash
set -euo pipefail

# Prune old ignored runtime artifacts to keep ~/.pi clean.
# Safe mode is the default: only untracked files ignored by git are deleted.
# Usage:
#   bash ~/.pi/agent/extensions/session-cleanup/cleanup-sessions.sh
#   bash ~/.pi/agent/extensions/session-cleanup/cleanup-sessions.sh --safe
#   bash ~/.pi/agent/extensions/session-cleanup/cleanup-sessions.sh --days=14
#   bash ~/.pi/agent/extensions/session-cleanup/cleanup-sessions.sh --aggressive
#   bash ~/.pi/agent/extensions/session-cleanup/cleanup-sessions.sh --dry-run

DAYS=30
AGGRESSIVE=false
DRY_RUN=false
PI_DIR="$HOME/.pi"
SESSIONS_DIR="$PI_DIR/agent/sessions"
TMP_DIR="$PI_DIR/tmp"

for arg in "$@"; do
    case "$arg" in
        --safe)
            ;;
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
            echo "Usage: $0 [--safe] [--days=N] [--aggressive] [--dry-run]" >&2
            exit 2
            ;;
    esac
done

if ! [[ "$DAYS" =~ ^[0-9]+$ ]]; then
    echo "Invalid --days value: $DAYS" >&2
    exit 2
fi

relative_to_pi() {
    local path="$1"
    case "$path" in
        "$PI_DIR"/*) printf '%s\n' "${path#"$PI_DIR"/}" ;;
        *) return 1 ;;
    esac
}

verify_dir_under_pi() {
    local dir="$1"
    local real_dir
    if [ ! -d "$dir" ]; then
        return 1
    fi
    real_dir="$(readlink -f "$dir")"
    case "$real_dir" in
        "$PI_DIR"|"$PI_DIR"/*) return 0 ;;
        *)
            echo "ERROR: $dir resolves to $real_dir (outside ~/.pi). Refusing cleanup." >&2
            exit 1
            ;;
    esac
}

is_untracked_ignored_path() {
    local path="$1"
    local rel
    rel="$(relative_to_pi "$path")" || return 1
    if git -C "$PI_DIR" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
        return 1
    fi
    git -C "$PI_DIR" check-ignore -q -- "$rel"
}

cleanup_files() {
    local dir="$1"
    local days="$2"
    local label="$3"
    local count=0
    local file

    verify_dir_under_pi "$dir" || return 0

    while IFS= read -r -d '' file; do
        if is_untracked_ignored_path "$file"; then
            count=$((count + 1))
            if [ "$DRY_RUN" != true ]; then
                rm -f -- "$file"
            fi
        fi
    done < <(find "$dir" -mindepth 1 -type f ! -type l -mtime +"$days" -print0 2>/dev/null)

    if [ "$DRY_RUN" = true ]; then
        echo "$label files that would be deleted: $count"
    else
        echo "$label files deleted: $count"
    fi
}

cleanup_empty_dirs() {
    local dir="$1"
    local label="$2"
    local count=0
    local empty_dir

    verify_dir_under_pi "$dir" || return 0

    while IFS= read -r -d '' empty_dir; do
        if is_untracked_ignored_path "$empty_dir"; then
            count=$((count + 1))
            if [ "$DRY_RUN" != true ]; then
                rmdir -- "$empty_dir" 2>/dev/null || true
            fi
        fi
    done < <(find "$dir" -mindepth 1 -depth -type d -empty -print0 2>/dev/null)

    if [ "$DRY_RUN" = true ]; then
        echo "$label empty dirs that would be removed: $count"
    else
        echo "$label empty dirs removed: $count"
    fi
}

if [ ! -d "$SESSIONS_DIR" ]; then
    echo "No sessions directory found: $SESSIONS_DIR"
    exit 0
fi

verify_dir_under_pi "$SESSIONS_DIR"

echo "Cleaning ignored session artifacts older than $DAYS days..."
if [ "$DRY_RUN" = true ]; then
    echo "(dry-run mode: no files will be deleted)"
fi

cleanup_files "$SESSIONS_DIR" "$DAYS" "Session"
cleanup_empty_dirs "$SESSIONS_DIR" "Session"

if [ "$AGGRESSIVE" = true ] && [ -d "$TMP_DIR" ]; then
    cleanup_files "$TMP_DIR" 7 "Aggressive tmp"
    cleanup_empty_dirs "$TMP_DIR" "Aggressive tmp"
fi

echo "Session cleanup complete."
