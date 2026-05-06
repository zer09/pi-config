#!/bin/bash
set -euo pipefail

# Update Pi skills at most once per day.
# Skills are installed into a temporary Skills CLI workspace, then copied directly
# into ~/.pi/agent/skills. No ~/.agents global skills and no persistent symlinks.
# Source of truth: ~/.pi/agent/skills-manifest.json
# Usage:
#   bash ~/.pi/agent/update-local-skills.sh
#   bash ~/.pi/agent/update-local-skills.sh --force

PI_DIR="$HOME/.pi"
PI_SKILLS_DIR="$PI_DIR/agent/skills"
MANIFEST="$PI_DIR/agent/skills-manifest.json"
STAMP_FILE="$PI_DIR/agent/.skills-update-stamp"
AUDIT_LOG="$PI_DIR/logs/skills-update.log"
TODAY="$(date -u +%Y-%m-%d)"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FORCE=false

for arg in "$@"; do
    case "$arg" in
        --force) FORCE=true ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: $0 [--force]" >&2
            exit 2
            ;;
    esac
done

if [ ! -f "$MANIFEST" ]; then
    echo "Missing skills manifest: $MANIFEST" >&2
    exit 1
fi

if [ "$FORCE" != true ] && [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$TODAY" ]; then
    echo "Pi skills already checked today ($TODAY)."
    exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$PI_SKILLS_DIR"
mkdir -p "$(dirname "$AUDIT_LOG")"

node -e '
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const external = manifest.external || manifest;
for (const [repo, skills] of Object.entries(external)) {
  if (["version", "custom"].includes(repo)) continue;
  if (!Array.isArray(skills) || skills.length === 0) throw new Error(`No skills for ${repo}`);
  console.log(JSON.stringify([repo, ...skills]));
}
' "$MANIFEST" | while read -r group; do
    mapfile -t parts < <(node -e 'const a=JSON.parse(process.argv[1]); for (const x of a) console.log(x)' "$group")
    repo="${parts[0]}"
    skills=("${parts[@]:1}")
    echo "Installing from $repo: ${skills[*]}"
    echo "[$TIMESTAMP] [INSTALL] repo=$repo skills=${skills[*]}" >> "$AUDIT_LOG"
    (cd "$TMP_DIR" && npx -y skills add "$repo" --skill "${skills[@]}" --agent '*' -y --copy >/tmp/pi-skills-install.log 2>&1) || {
        echo "[$TIMESTAMP] [ERROR] repo=$repo install failed" >> "$AUDIT_LOG"
        cat /tmp/pi-skills-install.log >&2
        exit 1
    }
done

if [ ! -d "$TMP_DIR/.agents/skills" ]; then
    echo "Skills CLI did not produce $TMP_DIR/.agents/skills" >&2
    echo "[$TIMESTAMP] [ERROR] no output from Skills CLI" >> "$AUDIT_LOG"
    exit 1
fi

# Atomic install: copy to staging dir first, then swap
STAGING_DIR="$(mktemp -d -p "$PI_DIR/agent" .skills-staging.XXXXXX)"
trap 'rm -rf "$TMP_DIR" "$STAGING_DIR"' EXIT

find "$TMP_DIR/.agents/skills" -mindepth 1 -maxdepth 1 -type d -print | while read -r skill_dir; do
    name="$(basename "$skill_dir")"
    cp -a "$skill_dir" "$STAGING_DIR/$name"
    echo "[$TIMESTAMP] [STAGED] skill=$name" >> "$AUDIT_LOG"
done

# Now swap: remove old, move staged into place
find "$STAGING_DIR" -mindepth 1 -maxdepth 1 -type d -print | while read -r staged_skill; do
    name="$(basename "$staged_skill")"
    rm -rf "$PI_SKILLS_DIR/$name"
    mv "$staged_skill" "$PI_SKILLS_DIR/$name"
    echo "[$TIMESTAMP] [INSTALLED] skill=$name" >> "$AUDIT_LOG"
done

# Clean up staging dir (should be empty now)
rmdir "$STAGING_DIR" 2>/dev/null || rm -rf "$STAGING_DIR"
# Reset trap to only clean TMP_DIR
trap 'rm -rf "$TMP_DIR"' EXIT

# Remove old Firebase skill names replaced by current firebase-firestore skill.
rm -rf "$PI_SKILLS_DIR/firebase-firestore-standard" \
       "$PI_SKILLS_DIR/firebase-firestore-enterprise-native-mode"

# Safety: direct install means no symlinked installed skills should remain.
# Only remove broken symlinks, not valid ones.
find "$PI_SKILLS_DIR" -maxdepth 1 -xtype l -print -delete

printf '%s' "$TODAY" > "$STAMP_FILE"
echo "[$TIMESTAMP] [COMPLETE] update finished" >> "$AUDIT_LOG"
echo "Pi skills update complete ($TODAY)."
