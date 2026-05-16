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

validate_skill_name() {
  local name="$1"
  if ! [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Invalid skill name: $name" >&2
    exit 2
  fi
}

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
INSTALL_LOG="$TMP_DIR/skills-install.log"

extract_missing_skills() {
  node -e '
const fs = require("fs");
const log = fs.readFileSync(process.argv[1], "utf8")
  .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
const requested = new Set(process.argv.slice(2));
const missing = new Set();
for (const line of log.split(/\r?\n/)) {
  const match = line.match(/No matching skills found for:\s*(.+)$/);
  if (!match) continue;
  for (const raw of match[1].split(/[, ]+/)) {
    const skill = raw.trim().replace(/[^A-Za-z0-9._-].*$/, "");
    if (requested.has(skill)) missing.add(skill);
  }
}
for (const skill of missing) console.log(skill);
' "$INSTALL_LOG" "$@"
}

install_skills_from_repo() {
  local repo="$1"
  shift
  local requested=("$@")
  local missing=()
  local next=()
  local skill=""
  local missing_skill=""
  local skip=false

  while [ "${#requested[@]}" -gt 0 ]; do
    : >"$INSTALL_LOG"
    if (cd "$TMP_DIR" && npx -y skills add "$repo" --skill "${requested[@]}" --agent '*' -y --copy </dev/null >"$INSTALL_LOG" 2>&1); then
      return 0
    fi

    mapfile -t missing < <(extract_missing_skills "${requested[@]}")
    if [ "${#missing[@]}" -eq 0 ]; then
      return 1
    fi

    for missing_skill in "${missing[@]}"; do
      if [ ! -d "$PI_SKILLS_DIR/$missing_skill" ]; then
        echo "Error: $repo no longer provides skill '$missing_skill' and no local copy exists." >&2
        return 1
      fi
      echo "Warning: $repo no longer provides skill '$missing_skill'; keeping existing local copy." >&2
      echo "[$TIMESTAMP] [WARN] repo=$repo missing_skill=$missing_skill kept=local" >>"$AUDIT_LOG"
    done

    next=()
    for skill in "${requested[@]}"; do
      skip=false
      for missing_skill in "${missing[@]}"; do
        if [ "$skill" = "$missing_skill" ]; then
          skip=true
          break
        fi
      done
      if [ "$skip" != true ]; then
        next+=("$skill")
      fi
    done

    if [ "${#next[@]}" -eq "${#requested[@]}" ]; then
      return 1
    fi
    requested=("${next[@]}")
  done

  return 0
}

while read -r group; do
  mapfile -t parts < <(node -e 'const a=JSON.parse(process.argv[1]); for (const x of a) console.log(x)' "$group")
  repo="${parts[0]}"
  skills=("${parts[@]:1}")
  for skill in "${skills[@]}"; do
    validate_skill_name "$skill"
  done
  echo "Installing from $repo: ${skills[*]}"
  echo "[$TIMESTAMP] [INSTALL] repo=$repo skills=${skills[*]}" >>"$AUDIT_LOG"
  install_skills_from_repo "$repo" "${skills[@]}" || {
    echo "[$TIMESTAMP] [ERROR] repo=$repo install failed" >>"$AUDIT_LOG"
    cat "$INSTALL_LOG" >&2
    exit 1
  }
done < <(node -e '
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const external = manifest.external || manifest;
for (const [repo, skills] of Object.entries(external)) {
  if (["version", "custom"].includes(repo)) continue;
  if (!Array.isArray(skills) || skills.length === 0) throw new Error("No skills for " + repo);
  console.log(JSON.stringify([repo, ...skills]));
}
' "$MANIFEST")

if [ ! -d "$TMP_DIR/.agents/skills" ]; then
  echo "Skills CLI did not produce $TMP_DIR/.agents/skills" >&2
  echo "[$TIMESTAMP] [ERROR] no output from Skills CLI" >>"$AUDIT_LOG"
  exit 1
fi

# Atomic install: copy to staging dir first, then swap
STAGING_DIR="$(mktemp -d -p "$PI_DIR/agent" .skills-staging.XXXXXX)"
trap 'rm -rf "$TMP_DIR" "$STAGING_DIR"' EXIT

find "$TMP_DIR/.agents/skills" -mindepth 1 -maxdepth 1 -type d -print | while read -r skill_dir; do
  name="$(basename "$skill_dir")"
  validate_skill_name "$name"
  cp -a "$skill_dir" "$STAGING_DIR/$name"
  echo "[$TIMESTAMP] [STAGED] skill=$name" >>"$AUDIT_LOG"
done

# Now swap: remove old, move staged into place
find "$STAGING_DIR" -mindepth 1 -maxdepth 1 -type d -print | while read -r staged_skill; do
  name="$(basename "$staged_skill")"
  validate_skill_name "$name"
  rm -rf "${PI_SKILLS_DIR:?}/$name"
  mv "$staged_skill" "$PI_SKILLS_DIR/$name"
  echo "[$TIMESTAMP] [INSTALLED] skill=$name" >>"$AUDIT_LOG"
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

printf '%s' "$TODAY" >"$STAMP_FILE"
echo "[$TIMESTAMP] [COMPLETE] update finished" >>"$AUDIT_LOG"
echo "Pi skills update complete ($TODAY)."
