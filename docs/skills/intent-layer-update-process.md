# Intent Layer skill update process

Use this process to update `agent/skills/intent-layer` from Crafter Station's upstream skill.

## Upstream source

- Repository: `https://github.com/crafter-station/skills`
- Runtime skill path: `context-engineering/intent-layer/`
- Current upstream commit checked locally: `24d77ce6365072c1699a20928e57a971abaa10f2`
- Primary files:
  - `SKILL.md`
  - `scripts/detect_state.sh`
  - `scripts/analyze_structure.sh`
  - `scripts/estimate_tokens.sh`
  - `references/templates.md`
  - `references/node-examples.md`
  - `references/capture-protocol.md`

Do not install upstream `README.md` into the runtime skill folder; keep long-lived maintenance notes in `docs/skills/`.

## Local classification

- Decision: `keep it`.
- Reason: the skill provides a compact, specific Intent Layer workflow plus reusable measurement scripts and templates for hierarchical `AGENTS.md` project context.

## Update steps

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Fetch upstream `context-engineering/intent-layer/` files.
5. Treat upstream content as input, not final truth.
6. Preserve local overlays:
   - Prefer `AGENTS.md` for this Pi setup unless an existing project convention or user instruction requires `CLAUDE.md`.
   - Keep `SKILL.md` frontmatter limited to `name` and `description`.
   - Keep `SKILL.md` compact and put examples/templates in `references/`.
   - Keep `agents/openai.yaml` with a `$intent-layer` default prompt.
   - Preserve global/project routing: scripts are measurement helpers; project file edits use native file tools.
   - Do not add hosted-service behavior or remote mutations.
7. Update `docs/skills/installed-skills-trim-verdict.md` if the classification or installed inventory changes.
8. Update `docs/skills/README.md` if this process document is renamed or replaced.
9. Validate the skill and local skill inventory.

## Validation

Run the target skill validator:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/intent-layer
```

Then run all local skill validators and metadata checks from `local-skill-update-invariants.md`.

For script changes, check shell syntax and run representative script smoke tests against a safe local fixture or repository. Do not run untrusted upstream scripts before reviewing their content.
