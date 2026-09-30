# Updating Astral Python tool skills

Purpose: keep the Astral Python tooling skills aligned with `astral-sh/claude-code-plugins` while preserving local OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/astral-sh/claude-code-plugins
- Current upstream commit checked locally: `f3ce88a7ba830f53afd6d944c1d0278ed318e142`
- Installed CLIs reviewed: `uv`/`uvx 0.12.21`, `ruff 0.16.9`, and `ty 0.0.84`

| Local skill | Upstream path |
| --- | --- |
| `uv` | `plugins/astral/skills/uv/SKILL.md` |
| `ruff` | `plugins/astral/skills/ruff/SKILL.md` |
| `ty` | `plugins/astral/skills/ty/SKILL.md` |

## Local files

- `agent/skills/uv/`: compact uv command routing and local Python tooling policy.
- `agent/skills/ruff/`: compact Ruff lint/format workflow with formatting-churn safeguards.
- `agent/skills/ty/`: compact ty type-checking workflow with docs-verification guidance for advanced flags.
- Each skill has local `agents/openai.yaml` UI metadata.

## Slimming policy

These skills are intentionally slim. Keep `SKILL.md` focused on triggers, preferred invocation, safety/scoping rules, core commands, docs links, and the maintenance pointer. Do not restore long migration tables or broad command catalogs unless the user explicitly asks for a more detailed runtime skill.

## uv routing and proportional discovery

Keep `uv` as `make it slim`. Activate it for uv commands, configuration, dependencies, environments, or package-manager work, and for Python execution/dependency handling in a uv-configured project. Generic Python code, a Python mention, or `pyproject.toml` alone is not enough.

Inspect only manager/configuration inputs that affect the task. Preserve uv project detection and existing Poetry/PDM ownership; do not migrate managers without a request. The project Python execution policy remains unchanged even when the uv skill is not needed.

Read-only advice does not authorize `uv init`, `uv add/remove/sync`, or other project/environment writes. Keep read-only checks in an existing environment without unrequested synchronization. Persistent tool installation requires an explicit request. Preserve `uv run`/`uvx` invocation conventions and exactly one `$uv` token in its metadata prompt. A routing-only pass does not change the source SHA or reviewed CLI versions.

## Increment 15: source no-op and CLI refresh

The cached authenticated GitHub comparison confirms the prior and current source commit are both `f3ce88a7ba830f53afd6d944c1d0278ed318e142`, with tree `f233c51a66e631ab64ddb765b0573317fdb544df`. The complete tree inventory contains the three mapped skill roots. Downloaded bytes match the tree's Git blob IDs and the comparison's SHA256 hashes; all three report `priorEqualsCurrent: true`.

**Adopt/retain:** adopt no runtime source changes. Retain `make it slim` for all three skills, with roots and `agents/openai.yaml` byte-identical. Local/source differences remain intentional slim overlays, not upstream drift. Preserve uv manager ownership, proportional discovery, no-sync and explicit install/mutation boundaries; Ruff scoped fixes and format previews; and ty docs/help verification and rule-specific suppression policy. Inventory and classification do not change.

### Parent-owned installations

The parent verified official latest GitHub releases and completed every installation. These release commits are CLI provenance, not new skill-source commits:

| CLI | Installed version | Official release commit | Existing owner |
| --- | --- | --- | --- |
| uv / uvx | `0.12.21` | `7af826859382eb191e47467540850caa8f493e5b` | Cargo |
| Ruff | `0.16.9` | `0be08a206f9c3180afd3e93bcc792ed5cb1f4db1` | uv tool |
| ty | `0.0.84` | `8dd9a7f7fa35a18275d82117e6593ba45507065f` | uv tool |

- The Cargo receipt established uv ownership. The parent ran `cargo install uv --version =0.12.21 --locked --root <cargo-root> --target-dir <evidence-dir>/cargo-target --jobs 2`. The build completed in 8m29 and replaced uv/uvx `0.12.10` at the existing paths. Future-compatibility warnings for `bytecheck 0.8.3`, `nix 0.31.3`, and `rkyv 0.8.18` remain a caveat, not a runtime-skill change.
- The parent verified cached Ruff/ty wheel sizes and SHA256 against official PyPI JSON and integrity records. The parent ran `uv tool upgrade 'ruff==0.16.9' 'ty==0.0.84' --offline --no-index --find-links <evidence-dir>/wheels --no-config`, preserving existing tool paths. Unrelated `notebooklm-mcp-cli 0.13.0` and `pylatexenc 2.11` remain installed.
- The initial delegate build was stopped before the parent reran it. This continuation did not install, build, upgrade, remove, or independently reproduce the Cargo build.

### Bounded offline validation

- Installed version/help reads confirmed the four binary versions and the documented uv execution, Ruff preview, and ty targeting/rule flags.
- Eight temporary-fixture smoke cases passed: Ruff positive/negative lint and lint/format diffs; ty positive/negative checks, targeting/rule flags, and rule-specific suppression. Expected negative and preview exits were `1`; positive exits were `0`. Fixture bytes and inventory remained unchanged.
- Python checks used `uv run --no-project --offline --no-config --no-python-downloads --python <existing-cached-python> python -B ...` with existing cached Python/PyYAML. No dependencies were fetched and no project was synchronized.
- Target validators and all 38 Local Skill validators passed, including metadata/frontmatter checks. Changed Markdown links, diff whitespace, secrets/home-path scan, and scoped artifact checks passed. Preservation checks confirmed unchanged runtime roots/metadata, other repository files, installed tools, cached environment, and Git index.

These checks do not prove model routing/compliance or exercise project synchronization, installs, fixes, language-server integration, or hosted services. No persistent test suite was added for unchanged roots. The update workflow and mandatory validators below remain unchanged.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode, for example:

```bash
gh api repos/astral-sh/claude-code-plugins/contents/plugins/astral/skills/uv/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders.
4. Copy upstream runtime changes only when they improve the compact local workflow and do not conflict with local Pi routing, OpenAI skill-creator rules, or token-footprint goals.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Preserve local Python tooling policy in project rules: use `uv`, prefer `uv run`, use `ruff` for lint/format, and use `ty` for type checking.
7. Preserve the scoped-fix safeguards in `ruff` and the docs-verification warning for advanced `ty` flags.
8. Regenerate or update `agents/openai.yaml` if a skill description changes.
9. Update the upstream commit SHA in this file when source content changes.
10. Validate all Astral skills:

```bash
for skill in uv ruff ty; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

11. Scan changed files for literal home paths and secret values before committing.
