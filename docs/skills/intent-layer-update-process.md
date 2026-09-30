# Intent Layer skill update process

Use this process to update `agent/skills/intent-layer` from Crafter Station's upstream skill.

## Upstream source

- Repository: `https://github.com/crafter-station/skills`
- Runtime skill path: `context-engineering/intent-layer/`
- Current canonical default branch checked in Increment 17 (2026-09-30): `main`, commit `f0fe474d76ed3f04113664095ff1b9e9844e8020`, tree `e33b2ef4446a309586f8a79df08ac8465e58e75a`.
- Prior checkout reviewed: `304057192b795d3b0d3b718092983046facd2664`.
- Last commit containing the runtime path: `24d77ce6365072c1699a20928e57a971abaa10f2`
- Current upstream main deleted `context-engineering/intent-layer/`; retain the local snapshot until a replacement source or an explicit retirement decision exists.
- Snapshot files:
  - `SKILL.md`
  - `scripts/detect_state.sh`
  - `scripts/analyze_structure.sh`
  - `scripts/estimate_tokens.sh`
  - `references/templates.md`
  - `references/node-examples.md`
  - `references/capture-protocol.md`

Do not install upstream `README.md` into the runtime skill folder; keep long-lived maintenance notes in `docs/skills/`.

### Increment 17 retained-source verification

Authenticated `gh` GET verified the canonical repository, default-branch commit, and complete recursive tree. `context-engineering/intent-layer/` remains absent, as at the prior reviewed checkout. The retained commit `24d77ce6365072c1699a20928e57a971abaa10f2` has tree `048fe309afecfafa7d71a9335c8064d9f1a854be` and mapped subtree `df42a406dbac9940445c93aa7c13dea65d744760`. Verified all eight source blobs and compared the seven runtime files with the local snapshot and overlays; the upstream README stays outside runtime.

**Result: retained path absent, no runtime edit.** Preserve the local last-containing snapshot and UI metadata byte-identically. No replacement-source search, adoption, rewrite, or retirement occurred. Target/all 38 validators, metadata/changed links, scoped diff/secret/artifact checks, and runtime/index preservation fingerprints passed. No script behavior, model evaluation, installation, or build was exercised; validation does not establish a current replacement source.

## Local classification

- Decision: `keep it`.
- Reason: the skill provides a compact, specific Intent Layer workflow plus reusable measurement scripts and templates for hierarchical `AGENTS.md` project context.

## Update steps

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Fetch upstream and check whether `context-engineering/intent-layer/` still exists. If it is absent, do not delete the retained local snapshot solely because upstream removed the path.
5. Treat upstream content as input, not final truth. Compare from the last commit that contains the path when necessary.
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
