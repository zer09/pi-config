# Updating the Linear CLI skill

Purpose: keep `agent/skills/linear-cli` aligned with the Linear CLI upstream skill while preserving local Pi mutation gates and OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/schpet/linear-cli
- Upstream skill path: `skills/linear-cli/SKILL.md`
- Current upstream commit checked locally: `e855b51f9cf85ae26780453381b2b7b7bc343bcb` (v2.3.0)
- The locally installed CLI and generated command references were updated to v2.3.0 at this review.

## Local files

- `agent/skills/linear-cli/SKILL.md`: compact Linear CLI workflow.
- `agent/skills/linear-cli/SKILL.template.md`: compact generation template used by `scripts/generate-docs.ts`; keep it aligned with `SKILL.md`.
- `agent/skills/linear-cli/references/`: runtime references.
- `agent/skills/linear-cli/scripts/`: runtime scripts.
- `agent/skills/linear-cli/evals/evals.json`: non-mutating behavior regression cases.
- `agent/skills/linear-cli/agents/openai.yaml`: local UI metadata.

## Local safety rule

Linear is an external hosted service. Keep reads allowed, but require explicit user instruction for create, update, delete, comment, assign, label, close, reopen, auth changes, or any other Linear mutation. Never run `linear auth token` in a way that prints or records the token value.

## Slimming policy

Keep `SKILL.md` and `SKILL.template.md` concise. Runtime instructions should contain only safety gates, discovery workflow, reference navigation, Markdown/body-file rules, known gotchas, GraphQL fallback guidance, and the maintenance pointer. Keep command catalogs and generated help in `references/`; do not reintroduce the full command list into `SKILL.md`.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream with authenticated `gh` CLI through Context Mode:

```bash
gh api repos/schpet/linear-cli/contents/skills/linear-cli/SKILL.md?ref=main
```

3. Compare the installed `linear --version`, upstream release, and upstream runtime files with the local skill files.
4. Copy version-independent upstream guidance that preserves local invariants. Regenerate or copy command references only when they match the installed CLI; treat a CLI package upgrade as a separate change requiring explicit user instruction.
5. Keep frontmatter limited to `name` and `description`.
6. If regenerating references with `scripts/generate-docs.ts`, keep `SKILL.template.md` slim before generation and re-check the generated `SKILL.md` afterward. Preserve the local generator overlays for the reference-first syntax index, terminal right-padding cleanup, and standalone formatting flags.
7. Regenerate or update `agents/openai.yaml` if the skill description changes.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate:

```bash
uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/linear-cli
```

10. For command-discovery behavior changes, run the non-mutating cases in `evals/evals.json` against the previous skill snapshot and inspect tool calls as well as final responses.
11. Scan changed files for literal home paths and secret values before committing.
