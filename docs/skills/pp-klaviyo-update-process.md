# pp-klaviyo update process

Use this Skill Maintenance Doc for the local `pp-klaviyo` skill, which wraps the Printing Press Klaviyo CLI for Pi.

## Source of truth

- Upstream repo: `mvanhorn/printing-press-library`
- Runtime skill input: `library/marketing/klaviyo/SKILL.md`
- CLI/docs input: `library/marketing/klaviyo/README.md`, `AGENTS.md`, `CHANGELOG.md`, `.printing-press-release.json`, `internal/config/config.go`, `internal/client/client.go`, and `internal/cli/root.go`
- CLI build target: `library/marketing/klaviyo/cmd/klaviyo-pp-cli`
- Local installed skill: `agent/skills/pp-klaviyo/`
- Upstream checkout commit inspected: `829c1619a79b5a91d3e3b03cd9fbb43e5355b0b3`
- CLI release inspected: `2026.8.1`
- Installed CLI checked locally: `klaviyo-pp-cli 2026.8.1`
- Generated API revision: `2026-04-15`
- Classification: `make it slim`

Treat upstream as input, not final truth. Local Pi secret handling, customer-data controls, mutation gates, compactness, and installed-binary behavior win.

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Load the local `skill-creator` skill.
5. Record the upstream checkout commit and status. Review changes to the listed CLI and runtime source files before installation.
6. Compare upstream runtime guidance with the installed CLI:
   ```bash
   klaviyo-pp-cli --version
   klaviyo-pp-cli --help
   klaviyo-pp-cli agent-context --pretty
   klaviyo-pp-cli <resource> <command> --help
   ```
7. Keep the current `make it slim` classification unless exact routing or safety value no longer justifies the runtime skill.
8. Keep `SKILL.md` focused on preflight, live read flags, data boundaries, mutation gates, UI fallback, and reference navigation.
9. Keep tested command shapes and current caveats in `agent/skills/pp-klaviyo/references/commands.md`.
10. Preserve `agents/openai.yaml` and update the installed-skill inventory when classification or install status changes.
11. Run all validation below.

## CLI-only installation

Build the exact reviewed checkout and install only the CLI target:

```bash
cd "$HOME/development/printing-press-library/library/marketing/klaviyo"
mkdir -p "$HOME/.local/bin"
go build -trimpath \
  -o "$HOME/.local/bin/klaviyo-pp-cli" \
  ./cmd/klaviyo-pp-cli
command -v klaviyo-pp-cli
klaviyo-pp-cli --version
```

Do not use installer or build targets that install other components. Do not add dependencies or service configuration to `agents/openai.yaml`.

## Local safety overlays

- Use only the existing `KLAVIYO_API_KEY` environment variable. Never print, persist, copy, inspect, or pass its value as an argument.
- Never run `auth set-token`.
- Require `KLAVIYO_BASE_URL` to be unset before real-key access, without printing its value.
- Require `--data-source live --no-cache` for normal reads because JSON caching and automatic SQLite write-through are independent.
- Require separate explicit consent before `sync`, local search, local analytics, or `--data-source auto` stores customer data.
- Minimize PII with API sparse fields, `--select`, bounded pages, restrictive temporary files, and summaries.
- Treat Klaviyo as read-only unless the latest request authorizes the exact hosted-service mutation.
- Never use `--agent` for writes because it enables `--yes`.
- Require final confirmation for broad, destructive, consent-related, campaign-send, flow-live, privacy, and new-webhook operations.
- Trust installed `--help` over generated command prose.

## Revision review

The API revision is compiled into the binary. On every upgrade, compare the generated revision and release notes. Recheck command names, flags, sparse fields, pagination limits, report query behavior, authentication, cache behavior, and mutation confirmation behavior before updating examples.

## Validation

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/pp-klaviyo
for skill_dir in agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also test every preflight branch with isolated fake environments. Then verify all Local Skills have valid `agents/openai.yaml`, changed Markdown links resolve, no changed file contains secrets or literal user-specific home paths, and no runtime artifact remains in the skill directory. Permit only a bounded `accounts get` authenticated read for installation verification, and never retain or print its raw response.
