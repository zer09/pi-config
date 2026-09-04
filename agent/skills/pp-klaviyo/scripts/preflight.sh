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

if [ -n "${KLAVIYO_BASE_URL:-}" ]; then
  printf '%s\n' 'Klaviyo preflight failed: KLAVIYO_BASE_URL must be unset for authenticated access.' >&2
  exit 1
fi

cli_path=$(command -v klaviyo-pp-cli)
cli_version=$("$cli_path" --version)
printf 'CLI path: %s\n' "$cli_path"
printf 'CLI version: %s\n' "$cli_version"
printf '%s\n' 'KLAVIYO_API_KEY is set'
