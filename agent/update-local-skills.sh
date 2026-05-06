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
TODAY="$(date -u +%Y-%m-%d)"
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
    (cd "$TMP_DIR" && npx -y skills add "$repo" --skill "${skills[@]}" --agent '*' -y --copy >/tmp/pi-skills-install.log 2>&1) || {
        cat /tmp/pi-skills-install.log >&2
        exit 1
    }
done

if [ ! -d "$TMP_DIR/.agents/skills" ]; then
    echo "Skills CLI did not produce $TMP_DIR/.agents/skills" >&2
    exit 1
fi

find "$TMP_DIR/.agents/skills" -mindepth 1 -maxdepth 1 -type d -print | while read -r skill_dir; do
    name="$(basename "$skill_dir")"
    rm -rf "$PI_SKILLS_DIR/$name"
    cp -a "$skill_dir" "$PI_SKILLS_DIR/$name"
done

# Remove old Firebase skill names replaced by current firebase-firestore skill.
rm -rf "$PI_SKILLS_DIR/firebase-firestore-standard" \
       "$PI_SKILLS_DIR/firebase-firestore-enterprise-native-mode"

# Safety: direct install means no symlinked installed skills should remain.
find "$PI_SKILLS_DIR" -maxdepth 1 -xtype l -print -delete

printf '%s' "$TODAY" > "$STAMP_FILE"
echo "Pi skills update complete ($TODAY)."
