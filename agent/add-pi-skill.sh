#!/bin/bash
set -euo pipefail

# Add one or more skills directly to ~/.pi/agent/skills and record them in
# ~/.pi/agent/skills-manifest.json for daily updates.
# Usage:
#   bash ~/.pi/agent/add-pi-skill.sh OWNER/REPO SKILL_NAME [SKILL_NAME...]
# Example:
#   bash ~/.pi/agent/add-pi-skill.sh github/awesome-copilot gh-cli

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 OWNER/REPO SKILL_NAME [SKILL_NAME...]" >&2
    exit 2
fi

PI_DIR="$HOME/.pi"
PI_SKILLS_DIR="$PI_DIR/agent/skills"
MANIFEST="$PI_DIR/agent/skills-manifest.json"
AUDIT_LOG="$PI_DIR/logs/skills-update.log"
REPO="$1"
shift
SKILLS=("$@")
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TMP_DIR="$(mktemp -d)"

validate_skill_name() {
    local name="$1"
    if ! [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
        echo "Invalid skill name: $name" >&2
        exit 2
    fi
}

for skill in "${SKILLS[@]}"; do
    validate_skill_name "$skill"
done
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$PI_SKILLS_DIR"
mkdir -p "$(dirname "$AUDIT_LOG")"

if [ ! -f "$MANIFEST" ]; then
    printf '{}\n' > "$MANIFEST"
fi

echo "Installing directly into Pi skills from $REPO: ${SKILLS[*]}"
echo "[$TIMESTAMP] [ADD] repo=$REPO skills=${SKILLS[*]}" >> "$AUDIT_LOG"
(cd "$TMP_DIR" && npx -y skills add "$REPO" --skill "${SKILLS[@]}" --agent '*' -y --copy >/tmp/pi-add-skill.log 2>&1) || {
    echo "[$TIMESTAMP] [ERROR] repo=$REPO install failed" >> "$AUDIT_LOG"
    cat /tmp/pi-add-skill.log >&2
    exit 1
}

for name in "${SKILLS[@]}"; do
    if [ ! -d "$TMP_DIR/.agents/skills/$name" ]; then
        echo "Installed skill not found in temp workspace: $name" >&2
        echo "[$TIMESTAMP] [ERROR] skill=$name not found after install" >> "$AUDIT_LOG"
        exit 1
    fi
    rm -rf "$PI_SKILLS_DIR/$name"
    cp -a "$TMP_DIR/.agents/skills/$name" "$PI_SKILLS_DIR/$name"
    echo "[$TIMESTAMP] [INSTALLED] skill=$name from $REPO" >> "$AUDIT_LOG"
done

node - "$MANIFEST" "$REPO" "${SKILLS[@]}" <<'NODE' || {
const fs = require('fs');
const [manifestPath, repo, ...skills] = process.argv.slice(2);
let manifest;
try {
  manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, external: {}, custom: [] };
} catch (e) {
  console.error('ERROR: Failed to parse manifest JSON:', e.message);
  process.exit(1);
}
if (!manifest.external) {
  const old = { ...manifest };
  delete old.version;
  delete old.custom;
  manifest.version = 1;
  manifest.external = old;
  manifest.custom = manifest.custom || [];
}
manifest.external[repo] = Array.from(new Set([...(manifest.external[repo] || []), ...skills])).sort();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
NODE
    echo "[$TIMESTAMP] [ERROR] manifest update failed" >> "$AUDIT_LOG"
    exit 1
}

rm -f "$PI_DIR/agent/.skills-update-stamp"
echo "[$TIMESTAMP] [COMPLETE] added skills: ${SKILLS[*]}" >> "$AUDIT_LOG"
echo "Added Pi skill(s): ${SKILLS[*]}"
echo "Recorded in $MANIFEST for daily updates."
