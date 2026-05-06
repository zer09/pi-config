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
REPO="$1"
shift
SKILLS=("$@")
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$PI_SKILLS_DIR"

if [ ! -f "$MANIFEST" ]; then
    printf '{}\n' > "$MANIFEST"
fi

echo "Installing directly into Pi skills from $REPO: ${SKILLS[*]}"
(cd "$TMP_DIR" && npx -y skills add "$REPO" --skill "${SKILLS[@]}" --agent '*' -y --copy >/tmp/pi-add-skill.log 2>&1) || {
    cat /tmp/pi-add-skill.log >&2
    exit 1
}

for name in "${SKILLS[@]}"; do
    if [ ! -d "$TMP_DIR/.agents/skills/$name" ]; then
        echo "Installed skill not found in temp workspace: $name" >&2
        exit 1
    fi
    rm -rf "$PI_SKILLS_DIR/$name"
    cp -a "$TMP_DIR/.agents/skills/$name" "$PI_SKILLS_DIR/$name"
done

node - "$MANIFEST" "$REPO" "${SKILLS[@]}" <<'NODE'
const fs = require('fs');
const [manifestPath, repo, ...skills] = process.argv.slice(2);
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, external: {}, custom: [] };
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

rm -f "$PI_DIR/agent/.skills-update-stamp"
echo "Added Pi skill(s): ${SKILLS[*]}"
echo "Recorded in $MANIFEST for daily updates."
