# pp-posthog update process

Use this Skill Maintenance Doc for the local `pp-posthog` skill, which wraps the Printing Press PostHog CLI for Pi.

## Source of truth

- Upstream repo: `mvanhorn/printing-press-library`
- Runtime skill input: `library/developer-tools/posthog/SKILL.md`; compare the generated `cli-skills/pp-posthog/SKILL.md` mirror too.
- CLI/docs input: `README.md`, `CHANGELOG.md`, `.printing-press-release.json`, `internal/cli/root.go`, `internal/cli/helpers.go`, and `internal/client/client.go` under `library/developer-tools/posthog/`.
- Local installed skill: `agent/skills/pp-posthog/`
- Baseline local library checkout: `829c1619a79b5a91d3e3b03cd9fbb43e5355b0b3`
- Reviewed stamped release-ledger/build commit: `986b1df61eb325952a0a9fe0fed98c8bdd64e740`
- Reviewed PostHog release: `2026.10.1`, ledger source commit `ec9c86e0eb3a3cba12a001972231bbefa5d8ada3`. The source commit is not the stamped build commit.
- Current release fact: PR 2370 changes MCP upload handling, not the CLI target. The CLI root diff from the prior release is only the version stamp.
- Retained 2026.9.1 safety fact: PR 1978 limits ambiguous transport and 5xx retries to GET, HEAD, and OPTIONS. Authentication and rate-limit recovery keep their bounded retry budget.
- Installed CLI after this update: `posthog-pp-cli 2026.10.1`, built with Go 1.26.10, `-mod=readonly -trimpath`, and `vcs.modified=false`.
- Installed CLI SHA256: `8304e1db40e4d09b3e5d25bf6b520999c421d4d255dd52666b7ee0fec0b14e31`.

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

- Compared prior ledger `f2e23e0d5d161e7c97868355ff8daec7baebcbd2` with the reviewed stamped ledger. The library skill, generated mirror, README, and `go.mod` are unchanged. Their Git blob IDs remain `f05c0361e8bf83ac4454ea8f08a626a82bd803d6`, `fb7ba868dbc9dec60e8842cd1c42de34bd86deee`, `97b810b24a0f478d3660bb36893c5aa533473624`, and `a600c2be77e1a142eaf8a0fb326390da1874e586`, respectively.
- The generated mirror differs from the library skill only by its header. Retain the compact local runtime and UI metadata rather than importing unchanged upstream content.
- Installed `llm cost-attribution --help` confirms `--since`. Top-level `organizations` and `query` remain absent from the installed commands; this is drift against historical examples, not a claim about the current README.
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

Only when installation is separately authorized, build the exact reviewed stamped ledger in an independent temporary clone. Do not write to or create worktrees in the original source checkout. Never build unstamped source `ec9c86e0eb3a3cba12a001972231bbefa5d8ada3` and relabel it as `2026.10.1`. Use the existing Go toolchain and cached modules; stop if either is unavailable:

```bash
REVIEW_ROOT=$(mktemp -d)
gh repo clone mvanhorn/printing-press-library "$REVIEW_ROOT/source" -- --no-checkout
git -C "$REVIEW_ROOT/source" checkout --detach 986b1df61eb325952a0a9fe0fed98c8bdd64e740
cd "$REVIEW_ROOT/source/library/developer-tools/posthog"
test "$(GOTOOLCHAIN=local go env GOVERSION)" = go1.26.10
GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off go mod verify
GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off go build -mod=readonly -trimpath -o "$REVIEW_ROOT/posthog-pp-cli" ./cmd/posthog-pp-cli
go version -m "$REVIEW_ROOT/posthog-pp-cli"
```

Keep the output outside the clone so the embedded build revision stays clean. Verify `vcs.revision`, `vcs.modified=false`, version, and help before installing only the CLI target. Run help in a credential-free environment with no network:

```bash
mkdir -p "$REVIEW_ROOT"/{home,config,cache,data,state,cwd}
offline_cli() {
  env -i PATH="$PATH" HOME="$REVIEW_ROOT/home" \
    XDG_CONFIG_HOME="$REVIEW_ROOT/config" XDG_CACHE_HOME="$REVIEW_ROOT/cache" \
    XDG_DATA_HOME="$REVIEW_ROOT/data" XDG_STATE_HOME="$REVIEW_ROOT/state" \
    bwrap --unshare-net --die-with-parent --ro-bind / / --dev /dev --proc /proc \
    --tmpfs /tmp --bind "$REVIEW_ROOT" "$REVIEW_ROOT" --chdir "$REVIEW_ROOT/cwd" "$@"
}
offline_cli "$REVIEW_ROOT/posthog-pp-cli" --version
offline_cli "$REVIEW_ROOT/posthog-pp-cli" --help
install -m 0755 "$REVIEW_ROOT/posthog-pp-cli" "$HOME/.local/bin/posthog-pp-cli"
```

Use the same sandbox for both installed CLIs' version, root help, and representative subcommand help checks. Do not use an unrelated installer or install the MCP target. Do not add dependencies or service configuration to `agents/openai.yaml`. Remove only task-created temporary roots after checking for symlinks.

### Paired official CLI provenance

The separate npm-global `@posthog/cli` is `0.19.2` under Node `v24.22.1`. Tag `posthog-cli/v0.19.2` targets `9bf269939b2b45e61cf64b7db6e231140c72117e`. Installation used `--ignore-scripts`, then verified the native payload from the release archive instead of running the unauthenticated postinstall downloader. The x86_64 GNU/Linux archive SHA256 is `546ca169c578fe019c470a8719f2c0f66a0d23b485cd9b47bfbae86ecc077afc`; the installed native SHA256 is `516ada5ac14d0ab332dd24db9c622c9e0ccd6e33ae292f43103055022dcad550`. This provenance note does not change skill routing or authorize uploads, API calls, authentication, or configuration changes.

Usage changes from `0.18.12` to `0.19.2`, confirmed by the installed native `CHANGELOG.md` and help:

- `0.19.1` removed the `--env-file` alias. Use `--dotenv-file` or `POSTHOG_CLI_DOTENV_FILE` instead.
- `0.19.0` added Flutter AOT symbols and opt-in app source context support through the existing `posthog-cli symbol-sets upload` command, not a new top-level Flutter command. Its help exposes `--include-source` to bundle source code and `--source-root` to limit included files to a directory; the latter requires `--include-source`.

Require explicit user authorization for the exact upload and any source-code sharing. These notes add no official-CLI API routing to `pp-posthog` and authorize no upload.

## Validation

Validate a disposable copy of the current skills and docs, never the live Pi config. Preserve all current inputs, including baseline artifacts, and compare copied file hashes before and after validation. Select an existing cached Python/PyYAML environment with `VIRTUAL_ENV` if needed; do not install missing validator dependencies:

```bash
VALIDATION_ROOT=$(mktemp -d)
mkdir -p "$VALIDATION_ROOT/agent"
cp -a agent/skills "$VALIDATION_ROOT/agent/"
cp -a docs "$VALIDATION_ROOT/"
cd "$VALIDATION_ROOT"
PYTHONDONTWRITEBYTECODE=1 UV_PYTHON_DOWNLOADS=never uv run --no-project --offline --with pyyaml python -B agent/skills/skill-creator/scripts/quick_validate.py agent/skills/pp-posthog
for skill_dir in agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  PYTHONDONTWRITEBYTECODE=1 UV_PYTHON_DOWNLOADS=never uv run --no-project --offline --with pyyaml python -B agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also verify all Local Skills have valid `agents/openai.yaml` and frontmatter, changed Markdown links resolve, no changed file contains literal home paths or secret-looking values, and maintenance pointers and classification remain valid. Review the full accumulated diff and run `git diff --check`. Check live and mirrored skill folders for new artifacts without deleting pre-existing files. Never run `doctor`, identity reads, or sync during offline maintenance.

### Acceptance record and limits

#### Earlier provenance-only sync

- The target validator passed, and all 39 Local Skills passed in a byte-matched disposable copy using cached Python/PyYAML. All 39 UI YAML/frontmatter checks passed. Default offline dependency resolution failed; selecting an existing cached environment through `VIRTUAL_ENV` required no installation.
- Both installed versions and root help passed with `env -i`, temporary HOME/XDG/cwd, and `bwrap --unshare-net`. Printing Press passed 21 reference help checks, including `--since`; top-level `organizations` and `query` remain absent. Official CLI `api`, `sourcemap`, and `release` help passed. Both native hashes stayed unchanged. These help-existence checks did not establish every flag's meaning.
- Static before/after review covered reads, exact writes, ambiguous writes, write retries, cache hydration, offline maintenance, official-CLI near misses, and Klaviyo near misses. The runtime root, UI metadata, safety gates, and example commands stayed unchanged during that sync, before this flag-meaning correction.
- Changed-file links, secret/home-path scans, maintenance pointers, classification, and diff whitespace checks passed. No new task artifacts appeared in the repository. The ignored `agent/skills/skill-creator/scripts/__pycache__/quick_validate.cpython-314.pyc` predates this update and remains in live and mirrored inputs. Global artifact hygiene is baseline non-clean, not a pass.

#### Local flag-meaning correction

- The runtime root now limits output-filtering `--select` guidance to help-confirmed meanings. The events example omits the shadowing query flag, and the at-risk example now requires a cohort ID. Feature-flags output selection, routing, UI metadata, source pins, classification, and all safety gates remain unchanged.
- Eight read-only sandbox checks passed: both installed versions and root help, Printing Press `projects events list --help`, `projects feature-flags list --help`, and `persons at-risk --help`, plus official `symbol-sets upload --help`. Each used `env -i`, credential-free HOME/XDG/cwd, and `bwrap --unshare-net`. Installed help confirms the events query/output distinction, feature-flags output selection, cohort ID wording, and source-context options. The installed native official changelog confirms the alias removal and Flutter support. Both native hashes remain unchanged.
- The target validator and all 39 Local Skill validators passed in a byte-matched disposable copy of current skills/docs using cached Python/PyYAML, offline resolution, and disabled bytecode writes. All 39 metadata/frontmatter checks, changed-link and secret/home-path scans, maintenance pointers, classification, and `git diff --check` passed. Copy hashes stayed unchanged through validation; no new skill artifacts appeared. The pre-existing ignored bytecode remains, so global artifact hygiene is still not a pass.
- Twelve static semantic cases covered events versus feature-flags output, cohort IDs, read routing, exact writes, ambiguous-write retries, secrets, cache hydration, offline maintenance, official-CLI migration near misses, and Klaviyo near misses. These checks do not prove model compliance or hosted API success. No live model benchmark, PostHog API request, doctor, login, identity read, sync, or upload ran.

#### Unchanged upstream test limit

- The earlier pinned build passed `go mod verify`. The network-blocked `go test -mod=readonly -count=1 ./internal/...` passed four packages but reported 186 failures in `internal/store` for missing required SQLite parent IDs. The entire store source/test tree and `go.mod`/`go.sum` are identical between reviewed ledgers; a representative fixture lacks the schema-required `environments_id`. The full suite is NOT green. This documentation increment did not repair or rerun those unchanged upstream tests, fix source, or verify cache hydration at runtime.
