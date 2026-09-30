# pp-posthog update process

Use this Skill Maintenance Doc for the local `pp-posthog` skill, which wraps the Printing Press PostHog CLI for Pi.

## Source of truth

- Upstream repo: `mvanhorn/printing-press-library`
- Runtime skill input: `library/developer-tools/posthog/SKILL.md`; compare the generated `cli-skills/pp-posthog/SKILL.md` mirror too.
- CLI/docs input: `README.md`, `CHANGELOG.md`, `.printing-press-release.json`, `internal/cli/root.go`, `internal/cli/helpers.go`, and `internal/client/client.go` under `library/developer-tools/posthog/`.
- Local installed skill: `agent/skills/pp-posthog/`
- Baseline local library checkout: `829c1619a79b5a91d3e3b03cd9fbb43e5355b0b3`
- Reviewed release-ledger checkout: `f2e23e0d5d161e7c97868355ff8daec7baebcbd2`
- Reviewed PostHog release: `2026.9.1`, source commit `81f5764eda401077520268afe74913c0f21f5b7e`
- Release fact: PR 1978 limits ambiguous transport and 5xx retries to GET, HEAD, and OPTIONS. Authentication and rate-limit recovery keep their bounded retry budget.
- Installed CLI after this update: `posthog-pp-cli 2026.9.1`

Treat upstream as input, not final truth. Local Pi safety gates, compactness, and installed-binary behavior win.

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Record the baseline checkout status. Review the exact source commit and release-ledger changes without changing that checkout. Compare the upstream runtime skill, mirror, README, and changed source against the installed binary. Use help and version checks during offline maintenance; do not use `doctor` or other commands that can contact PostHog without separate authenticated-read authorization:
   ```bash
   posthog-pp-cli --version
   posthog-pp-cli --help
   posthog-pp-cli <resource> <command> --help
   ```
5. Classify the skill. Current decision: `make it slim` because the skill is useful for exact PostHog CLI routing and safety gates, but upstream command catalogs and examples are too long for `SKILL.md`.
6. Keep `agent/skills/pp-posthog/SKILL.md` focused on:
   - binary/auth verification
   - hosted-service mutation gates
   - safe read workflow
   - cache hydration rules
   - reference navigation
7. Keep command examples, drift notes, and the 2026.9.1 write-retry safety note in `agent/skills/pp-posthog/references/commands.md`.
8. Normalize `SKILL.md` frontmatter to only `name` and `description`.
9. Preserve `agents/openai.yaml`; regenerate only if the description or UI prompt becomes stale.
10. Update `docs/skills/installed-skills-trim-verdict.md` if classification or install status changes.
11. Validate the skill and all Local Skills.

## Reviewed upstream differences

- The source commit corrects the LLM cost recipe from `--days` to `--since`; the local reference uses installed help syntax.
- The mirror at the source commit lags the library skill. At the reviewed ledger checkout, only the generated header differs. Prefer the library source when the mirror lags.
- Retain installed-help overrides where generated README examples name absent top-level `organizations` or `query` commands.
- Do not import upstream token-in-argument examples, automatic installation, MCP setup, or broad `--agent` guidance for writes.
- Preserve compact roots, existing routing descriptions, and UI metadata. The installed-skill classification is unchanged.

## Local safety overlays

- PostHog is a hosted service: default to read-only.
- Preserve the 2026.9.1 fail-closed write behavior: do not assume an ambiguous transport or 5xx write failed safely, and do not replay it automatically. Inspect the target state before any separately authorized retry.
- Remote writes require explicit user instruction for the exact create/update/delete/import/bulk action.
- Do not print secrets, OAuth headers, PostHog personal keys, config files, team `api_token`, cookies, or full `users retrieve @me` responses.
- Use `--agent` for read-only commands, but avoid casual `--agent` on destructive commands because it includes `--yes`.
- Treat `posthog-pp-cli sync` as local cache hydration: run when requested, summarize `sync_summary`, and do not dump large JSONL output.
- Trust the installed binary's `--help` over generated README examples when they disagree.

## CLI-only installation

Only when installation is separately authorized, build the exact reviewed release-ledger checkout in an isolated temporary checkout or worktree. The ledger checkout stamps the runtime version after the source commit; do not build the unchanged baseline and label it as the new release. Install only the PostHog CLI target after its version and help checks pass:

```bash
cd "$REVIEW_ROOT/library/developer-tools/posthog"
go build -trimpath -o "$REVIEW_ROOT/posthog-pp-cli" ./cmd/posthog-pp-cli
"$REVIEW_ROOT/posthog-pp-cli" --version
"$REVIEW_ROOT/posthog-pp-cli" --help >/dev/null
install -m 0755 "$REVIEW_ROOT/posthog-pp-cli" "$HOME/.local/bin/posthog-pp-cli"
```

Do not use an unrelated installer or install the MCP target. Do not add dependencies or service configuration to `agents/openai.yaml`.

## Validation

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/pp-posthog
for skill_dir in agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also verify all Local Skills have valid `agents/openai.yaml`, no changed Markdown contains literal home paths or secret-looking values, and local Markdown links resolve. Check diffs and skill folders for generated artifacts. Keep version/help checks credential-free with an isolated temporary home; never run `doctor`, identity reads, or sync during offline maintenance.
