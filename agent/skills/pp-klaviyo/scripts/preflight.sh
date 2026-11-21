#!/bin/sh
set -eu

if ! command -v klaviyo-pp-cli >/dev/null 2>&1; then
  printf '%s\n' 'Klaviyo preflight failed: klaviyo-pp-cli is not on PATH.' >&2
  exit 1
fi

if [ -z "${KLAVIYO_API_KEY:-}" ]; then
  printf '%s\n' 'Klaviyo preflight failed: KLAVIYO_API_KEY is missing.' >&2
  exit 1
fi

# Require absence, not an empty override, to match the real-key safety rule.
if [ "${KLAVIYO_BASE_URL+x}" = x ]; then
  printf '%s\n' 'Klaviyo preflight failed: KLAVIYO_BASE_URL must be unset for authenticated access.' >&2
  exit 1
fi

# Commands pass --client-profile klaviyo; a different ambient selector signals a mix-up.
if [ -n "${PRINTING_PRESS_CLIENT_PROFILE:-}" ] && [ "$PRINTING_PRESS_CLIENT_PROFILE" != klaviyo ]; then
  printf '%s\n' 'Klaviyo preflight failed: PRINTING_PRESS_CLIENT_PROFILE selects a different client profile.' >&2
  exit 1
fi

profile_failed() {
  printf '%s\n' 'Klaviyo preflight failed: client profile "klaviyo" bound to env:KLAVIYO_API_KEY is missing.' >&2
  exit 1
}

# The CLI refuses data commands without this profile, and any extra profile
# setting (such as an additional credential) can change which key it uses.
# Ask the CLI's own offline parser for the whole Klaviyo source and allow only
# the three keys `client add` writes for an environment-bound key. `client show`
# does not read the key and exits nonzero for a missing or unsafe profile. The
# CLI prints one key per line and escapes string values, so a value cannot
# fake another line.
source_json=$(klaviyo-pp-cli client show klaviyo --json --select sources.klaviyo 2>/dev/null) || profile_failed
refs=0 accounts=0 orgs=0
while IFS= read -r line; do
  case $line in
    '{' | '  "sources": {' | '    "klaviyo": {' | '    }' | '  }' | '}') ;;
    '      "credential_ref": "env:KLAVIYO_API_KEY"' | '      "credential_ref": "env:KLAVIYO_API_KEY",') refs=$((refs + 1)) ;;
    '      "expected_account_id": "'*) accounts=$((accounts + 1)) ;;
    '      "expected_org_name": "'*) orgs=$((orgs + 1)) ;;
    *) profile_failed ;;
  esac
done <<EOF
$source_json
EOF
[ "$refs" = 1 ] && [ "$accounts" = 1 ] && [ "$orgs" = 1 ] || profile_failed

cli_path=$(command -v klaviyo-pp-cli)
cli_version=$("$cli_path" --version)
printf 'CLI path: %s\n' "$cli_path"
printf 'CLI version: %s\n' "$cli_version"
printf '%s\n' 'Client profile: klaviyo'
printf '%s\n' 'KLAVIYO_API_KEY is set'
