# pp-klaviyo update process

Use this Skill Maintenance Doc for the local `pp-klaviyo` skill, which wraps the Printing Press Klaviyo CLI for Pi.

## Source of truth

- Upstream repo: `mvanhorn/printing-press-library`
- Runtime skill input: `library/marketing/klaviyo/SKILL.md`; compare the generated `cli-skills/pp-klaviyo/SKILL.md` mirror too.
- CLI/docs input: `README.md`, `AGENTS.md`, `CHANGELOG.md`, `.printing-press-release.json`, `internal/config/config.go`, `internal/client/client.go`, `internal/cli/root.go`, `internal/cli/helpers.go`, `internal/cli/novel_klaviyo.go`, `internal/cli/campaigns_create.go`, `internal/cli/promoted_campaign-message-assign-template.go`, and related tests under `library/marketing/klaviyo/`.
- CLI build target: `library/marketing/klaviyo/cmd/klaviyo-pp-cli`
- Local installed skill: `agent/skills/pp-klaviyo/`
- Baseline local library checkout: `829c1619a79b5a91d3e3b03cd9fbb43e5355b0b3`
- Reviewed release-ledger checkout: `f2e23e0d5d161e7c97868355ff8daec7baebcbd2`
- Reviewed Klaviyo release: `2026.9.3`, source commit `5bb1f7fc0d5df8cd83e88201be56458811c0eb00`
- Release facts: PR 2051 adds unsubscribe findings to `plan qa-gate` and blocks invalid HTML in `campaigns deploy` before API activity. Cumulative changes limit ambiguous-failure retries to GET, HEAD, and OPTIONS, percent-encode path parameters, and preserve nested campaign-creation and template-assignment bodies.
- Installed CLI after this update: `klaviyo-pp-cli 2026.9.3`
- Generated API revision: `2026-04-15`
- Classification: `make it slim`

Treat upstream as input, not final truth. Local Pi secret handling, customer-data controls, mutation gates, compactness, and installed-binary behavior win.

## 2026.11.7 installed on 2026-11-21

The user chose to keep `KLAVIYO_API_KEY` as the only credential, gate every new write command per request, stay CLI-only with no MCP, and allow one read-only live check. 2026.11.7 remains the latest Klaviyo release (no later Klaviyo commits on `main` through 2026-11-20).

- **Build:** ledger commit `1d0f487fb308e46275a10cb714de6061f8e3c258` (stamps 2026.11.7 on source `33f9f600…`, PR 2459: `campaigns ab-test create` and `results`). All 90 `go.sum` entries pass `go mod verify`. `go build -trimpath`, `go vet` and `go test ./...` pass offline with Go 1.26.11. Binary SHA-256 `4b077b944af29ed61fe6c7ded4e0c6b37c62c5f1cf84e71f144333c1bda86261`. No prebuilt upstream binary exists.
- **Client profile required:** every command except `--help`, `--version` and `agent-context` refuses to run without a tenant-gated client profile, including `--dry-run` and local HTML QA. A profile can reference `env:KLAVIYO_API_KEY`, so the key stays in the environment. `client add` writes only the reference and the expected identity to `~/.config/printing-press/clients/<name>/profile.toml` (mode 600).
- **Identity gate:** before each command the CLI calls `GET /api/accounts` and compares the account ID and organization name. The original key returned HTTP 403 `permission_denied` on that endpoint. The user replaced it with a read-only key that includes Accounts read access.
- **Expected identity:** account ID `WikR2W` (the public API key / site ID), organization `Switchboard`, supplied by the user.
- **Skill changes prepared:** `--client-profile klaviyo` on every command; the preflight asks the CLI's own offline `client show klaviyo --json --select sources.klaviyo` for the parsed Klaviyo source and accepts only the three keys `client add` writes (`credential_ref = env:KLAVIYO_API_KEY`, `expected_account_id`, `expected_org_name`), so any extra setting that could change the key, such as an additional credential, fails; it also rejects a different `PRINTING_PRESS_CLIENT_PROFILE`; new campaign model and examples; report inputs; final confirmation for `campaigns test-send`, `campaigns ab-test create`, `forms publish/unpublish` and `flows insert-step --apply`; `--deliver`, `--audit-dir`, `--home` and `--config` forbidden; learning commands treated as local storage; no `client set-default`, because that default is shared by every Printing Press CLI.

Installation as executed: the 2026.9.3 binary moved to `~/.cli-rollback-klaviyo-2026.9.3/` (deleted later the same day at the user's request), then, at the user's request for the latest version:

```bash
GOFLAGS=-trimpath GOBIN=~/.local/bin go install \
  github.com/mvanhorn/printing-press-library/library/marketing/klaviyo/cmd/klaviyo-pp-cli@latest
klaviyo-pp-cli client add klaviyo --credential-ref env:KLAVIYO_API_KEY \
  --expected-account-id WikR2W --expected-org-name 'Switchboard'
klaviyo-pp-cli --client-profile klaviyo whoami
```

`@latest` resolved to `main` at `d86680f` (2026-11-20), whose Klaviyo source is identical to the reviewed release `1d0f487`; the binary reports 2026.11.7. `whoami` returned gate `verified` with matching `WikR2W` / `Switchboard`, and the skill preflight passes. The updated skill files are live. The user separately installed the official Klaviyo CLI (`klaviyo`, `github.com/klaviyo/klaviyo-cli` v0.6.0) in `~/go/bin`; Pi does not use it.

## Pi 1.5.2 preparation: retain 2026.9.3, hold 2026.11.7

The existing user-local binary still reports 2026.9.3 and remains unchanged. Its private byte-identical copy passes version, root/representative help and Go build-info checks; the existing preflight regression passes without real credentials. The binary records Go 1.26.8 but omits VCS revision, so these checks are not exact build-source attestation or live API/cache acceptance.

Authenticated source reads verify release 2026.11.7 at stamped build commit `1d0f487fb308e46275a10cb714de6061f8e3c258`, ledger source commit `33f9f600c1cb2c06f751a0c18cb6b645adae2f31`. Its released credential/config relocation and platform cache/session changes exceed this compatibility-first update; hold the migration rather than relabeling the existing binary or building/installing it automatically. The held source also hardens credential routing from untrusted configuration; that protection is not backported. Help checks do not certify the retained binary's real credential routing. Review the migration before future credentialed use. Preserve current key/base-URL, customer-cache, ambiguous-write and exact send/mutation gates.

See the [full preparation record](../changelogs/pi-1.5.2-full-setup-maintenance-preparation.md). Public source snapshots, exact native hashes and safe command logs are under `RUN/reports/local-audit`. No customer/API/doctor/sync/auth operation, global update or deployment ran. The source/install facts below remain historical reviewed inputs, not a claim that the held release was installed.

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Load the local `skill-creator` skill.
5. Record the baseline checkout commit and status. Review the exact release source, mirror, and release-ledger changes without changing the baseline checkout. The generated mirror can lag the library skill at the source commit.
6. Compare upstream runtime guidance with the installed CLI using a credential-free environment and an isolated temporary home:
   ```bash
   klaviyo-pp-cli --version
   klaviyo-pp-cli --help
   klaviyo-pp-cli agent-context --pretty
   klaviyo-pp-cli <resource> <command> --help
   ```
7. Keep the current `make it slim` classification unless exact routing or safety value no longer justifies the runtime skill.
8. Keep `SKILL.md` focused on preflight, live read flags, data boundaries, mutation gates, UI fallback, and reference navigation.
9. Keep tested command shapes, current caveats, and the 2026.9.3 unsubscribe-preflight and ambiguous-write safety notes in `agent/skills/pp-klaviyo/references/commands.md`.
10. Preserve `agents/openai.yaml` and update the installed-skill inventory when classification or install status changes.
11. Run all validation below.

## Reviewed upstream differences

- Adopt unsubscribe QA guidance without copying the upstream recipe's live `--campaign-id` read. Local HTML QA needs no credentials or API call.
- `plan qa-gate` reports findings in JSON but can exit 0 when the verdict is `fail`. Missing HTML reports an unsubscribe warning. Inspect findings, resolve failures, and review warnings; exit status alone is not a launch gate.
- `campaigns deploy` reads files through `--template-file`. Its `--template-html` flag takes literal HTML despite the generated example showing a filename.
- Retain the report-input caveat: installed report shortcut help still lacks query-body flags. Nested campaign-write fixes do not repair these report shortcuts.
- Do not import upstream automatic installation, MCP setup, token persistence, implicit customer-data caching, or generic `--agent` templates. Preserve the compact root, current routing description, and UI metadata. The installed-skill classification is unchanged.

## CLI-only installation

Only when installation is separately authorized, build the exact reviewed release-ledger checkout in an isolated temporary checkout or worktree and install only the CLI target. The ledger checkout stamps the runtime version after the source commit; do not build the unchanged baseline and label it as the new release:

```bash
cd "$REVIEW_ROOT/library/marketing/klaviyo"
go build -trimpath -o "$REVIEW_ROOT/klaviyo-pp-cli" ./cmd/klaviyo-pp-cli
"$REVIEW_ROOT/klaviyo-pp-cli" --version
"$REVIEW_ROOT/klaviyo-pp-cli" --help >/dev/null
install -m 0755 "$REVIEW_ROOT/klaviyo-pp-cli" "$HOME/.local/bin/klaviyo-pp-cli"
command -v klaviyo-pp-cli
klaviyo-pp-cli --version
```

Do not use an unrelated installer or build targets that install other components. Do not add dependencies or service configuration to `agents/openai.yaml`.

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
- For campaign HTML, use `plan qa-gate --html <file>` before authorized deployment or launch. Use `{% unsubscribe %}` as standalone text or `{% unsubscribe_link %}` inside an anchor's `href`. With nonempty HTML, missing or misplaced tags fail the unsubscribe finding; tags only in comments or non-rendered template content do not count. Preview rendered visibility separately. Raw campaign/template writes do not inherit the deploy check.
- Preserve fail-closed write behavior: ambiguous transport and 5xx failures are not automatically retried for writes. Authentication and rate-limit recovery remain bounded. Inspect target state before any separately authorized retry.
- Trust installed `--help` over generated command prose.

## Revision review

The API revision is compiled into the binary. On every upgrade, compare the generated revision and release notes. Recheck command names, flags, sparse fields, pagination limits, report query behavior, authentication, cache behavior, mutation confirmation behavior, and campaign unsubscribe validation before updating examples.

## Validation

```bash
sh -n agent/skills/pp-klaviyo/scripts/preflight.sh
uv run python -B agent/skills/pp-klaviyo/scripts/test_preflight.py -v
PP_KLAVIYO_TEST_CLI="$(command -v klaviyo-pp-cli)" uv run python -B agent/skills/pp-klaviyo/scripts/test_preflight.py -v
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/pp-klaviyo
for skill_dir in agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

The preflight regression covers missing CLI, missing/empty key, set/empty base URL, a conflicting client-profile selector, missing/other/unselected references, extra or duplicate keys, a missing identity value, success, and version-command failure with a fake CLI and no inherited credentials. With `PP_KLAVIYO_TEST_CLI` set, it also runs the real CLI offline against crafted profiles: double quotes and a table-header comment pass; another reference, a reference in another table, an additional credential, a base-URL override, and a reference only inside a multiline string fail. Retain it to protect the requirement that `KLAVIYO_BASE_URL` be absent, not merely empty. Resolve the runtime helper relative to the skill directory, not a hardcoded installation path.

Check Python syntax without generating bytecode. Exercise HTML QA with synthetic local files and no `--campaign-id`; check unsubscribe findings and exit behavior. Then verify all Local Skills have valid `agents/openai.yaml`, changed Markdown links resolve, no changed file contains secrets or literal user-specific home paths, diffs are clean, and no runtime artifact remains in skill folders. Offline validation does not authorize product API calls. Only with separate authenticated-read authorization may installation verification use a bounded `accounts get`; never retain or print its raw response.
