# Outpour MCP update process

## Source ownership and classification

`outpour-mcp` is a custom Local Skill. This repository owns its runtime instructions, UI metadata, headless helper, and offline tests under `agent/skills/outpour-mcp/`; there is no upstream skill to copy or package to install. Start with the [maintenance README](README.md), [local invariants](local-skill-update-invariants.md), [slimming process](skill-slimming-process.md), and [custom local process](custom-local-skills-update-process.md).

Classification: **keep it**. The custom headless tooling, current niche MCP schemas, financial/contact privacy rules, and exact hosted-write gates warrant retention. Keep the name unchanged and the root compact. Maintenance instructions belong here, not in the runtime folder.

Authoritative inputs are the [official setup guide](https://outpour.app/help/set-up-outpour-mcp), its [public article API](https://outpour.app/api/help/articles/set-up-outpour-mcp), and current official MCP tool schemas. Treat these as inputs to local guidance, not blind upstream replacements. Reuse supplied verified evidence for local-only changes; do not imply a fresh source review or invent which features are new without a prior baseline.

The official guide recommends OAuth and manual keys only when OAuth is unavailable. The helper intentionally supplies that manual-key fallback, not OAuth. Only owners enable MCP/create/revoke keys; admins can connect once enabled. Point interactive users to the official guide. OAuth migration, MCP-client setup, login/configuration changes, and token persistence each require a separate explicit request; maintenance never authorizes automatic setup.

## Preserve the local contract

- Keep two-key frontmatter, quoted UI strings, a 25–64 character short description, and the exact `$outpour-mcp` token in a read-only default prompt. Route Outpour data/schema requests and explicitly requested contact/task changes, not generic CRM, writing, or other services.
- Recommend Node.js 22+. The offline suite is tested on 24.22.1; Node 18 compatibility is not established. Do not turn an untested runtime floor into a tested claim.
- Require only environment-key presence. Never print or persist a key or put credentials in commands, logs, files, examples, or documentation. Preserve redaction of raw, JSON-escaped, and nested diagnostics; redaction does not make ministry records safe to retain.
- Pin the exact endpoint `https://mcp.outpour.app/mcp`. Accept `OUTPOUR_MCP_URL` only when absent, empty, or exactly that string. Reject all alternatives and redirects before forwarding credentials; never relax this for troubleshooting.
- Preserve the 30-second request deadline, 8 MiB response limit, 100-page catalog cap, validated `2025-03-26` negotiation, matching response IDs, and streaming server-sent event handling. Discover the complete validated tool catalog before selecting a tool, without enumerating ministry records.
- Preserve inline, `@file`, stdin, and omitted-object argument parsing. Prefer stdin for complex/sensitive arguments; any necessary argument file must be a securely created unique private OS-temp file with prompt cleanup, including on failure. Do not retain sensitive arguments or results.
- Preserve the strict `readOnlyHint === true` rule. Missing/nonboolean hints count as writes. `--allow-write` must be the final CLI flag and never substitutes for the user's exact write authorization. Keep nonzero `isError` handling and no automatic write retry.
- Keep discovery ordered: list tools, describe the selected schema, then make only a small requested read. Use low useful limits, no details/content by default, filter options before guessing tag/status IDs, no whole-ministry enumeration by default, minimal personal data, and currency formatting for integer `Cents` fields.
- Preserve the supported-scope and exclusion boundaries in the [runtime root](../../agent/skills/outpour-mcp/SKILL.md). Before note/task writes, explain note replacement versus append/clear and task omitted-versus-null effects using the current schema. Do not add executable live-write examples or write smoke tests.

## Safe update workflow

1. Inspect the working tree and applicable instructions before editing. Preserve existing staged entries, user edits, helper tests, metadata, and unrelated files. No staging, Git transitions, installs, or hosted writes follow from a maintenance request alone.
2. Identify the smallest requested change and the evidence it needs. For local-only work, reuse verified official evidence. If a fresh public-source comparison is explicitly authorized, compare only relevant guide/schema behavior; do not fetch sources or call Outpour when the task forbids network access.
3. Separate official product guidance from local helper behavior. Keep the manual-key fallback intentional. A catalog change does not authorize setup changes, broader reads, or writes. Missing authority, required evidence, or prepared dependencies means stop and report what remains unverified.
4. Reapply the local contract above. Do not replace the helper/tests with copied prose or weaken transport, parser, privacy, or write safeguards. Helper changes require focused synthetic regressions, including failure paths, before the full suite.
5. Run the offline checks below after each coherent change. No live Outpour call is an acceptance check. Synthetic mocked write-guard cases are permitted offline; real write tests are not.
6. Review intended triggers and near misses, selective loading, exact authorization, failure handling, and completion. Confirm that a feature study cannot become setup, broad export, or mutation. Check metadata and every local link in changed documents, whitespace, sensitive-looking values, literal home paths, and generated artifacts.
7. Keep the runtime Maintenance pointer, README process entry, and inventory classification/count consistent. Report actual checks and limits, preserve the index when changes must stay unstaged, and stop at the assigned increment. Offline success does not approve later work or establish live correctness.

If a separately requested runtime read needs live evidence, retain the root's list/describe/small-sample sequence and privacy limits. Do not make live calls merely to complete maintenance or test a write path.

## Offline acceptance checks

Run from the repository root with inherited Outpour key/endpoint variables unset. These commands check syntax and use only injected synthetic credentials and mocked transports; the test suite disables native fetch:

```bash
env -u OUTPOUR_API_KEY -u OUTPOUR_MCP_URL node --check agent/skills/outpour-mcp/scripts/outpour-mcp.mjs
env -u OUTPOUR_API_KEY -u OUTPOUR_MCP_URL node --check agent/skills/outpour-mcp/scripts/outpour-mcp.test.mjs
env -u OUTPOUR_API_KEY -u OUTPOUR_MCP_URL node --test agent/skills/outpour-mcp/scripts/outpour-mcp.test.mjs
```

Use an existing cached Python/PyYAML environment for target and all-skill validation. The prescribed offline form is:

```bash
PYTHONDONTWRITEBYTECODE=1 UV_PYTHON_DOWNLOADS=never uv run --no-project --offline --with pyyaml python -B agent/skills/skill-creator/scripts/quick_validate.py agent/skills/outpour-mcp

validated=0
for skill_dir in agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  PYTHONDONTWRITEBYTECODE=1 UV_PYTHON_DOWNLOADS=never uv run --no-project --offline --with pyyaml python -B agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
  validated=$((validated + 1))
done
test "$validated" -eq 39
```

The current installed root count is 39. Update the expected count only after an intentionally authorized inventory change. Validators cover structure, frontmatter, all UI metadata, and skill-local Markdown links; inspect changed maintenance-document links separately.

Do not install, sync packages, download Python, or retry online to satisfy validation. If the prescribed form cannot reuse prepared resources, an already prepared interpreter containing PyYAML is an acceptable no-install fallback: replace `--with pyyaml` with `--python <prepared-interpreter>` in both validator commands. Do not record a machine-specific interpreter/cache path here. If neither form has the required offline resources, stop and report validation as unverified, not passed.

Also confirm that only intended files changed, no new caches/logs/generated output appeared, and staged entries remain unchanged when required. Preserve pre-existing artifacts and unrelated user changes rather than cleaning them as part of maintenance.

## Evidence limits

The current baseline has 229 passing offline tests covering exact endpoint/redirect restrictions, argument sources and failures, strict write gates, tool errors, credential redaction, deadlines/response limits, protocol/response validation, streaming responses, and complete bounded catalog pagination. The tests inject synthetic credentials and block native fetch. They do not establish live access, current tool availability, OAuth behavior, or behavior across Node versions.

Supplied prior read-only evidence reported 13 tools (9 read, 4 write) on one page and acceptance of protocol `2025-03-26`. This is not a permanent tool snapshot, a fresh maintenance read, or evidence of newly introduced features. Keep current schemas authoritative. No live Outpour reads/writes, transactions, OAuth/login/configuration changes, or package installs are required for offline acceptance.
