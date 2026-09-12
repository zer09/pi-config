# Local skill update invariants

These invariants define what "update the skill" and "install the skill" mean in this Pi Config.

Canonical update meaning: sync from the relevant upstream source, then reapply local invariants before validation and commit. Upstream content is input, not final truth. Local Pi safety, routing, token-footprint, and OpenAI skill compatibility win unless the user explicitly asks to replace local behavior.

Canonical install meaning: add the skill as a Local Skill, treat upstream content as input when applicable, document future maintenance in `docs/skills/`, then apply these invariants before validation and commit.

Read this file before and after using any skill update-process document. [ADR 0020](../adr/0020-gpt-6-astra-skill-maintenance-policy.md) refines ADR 0001 with model-neutral routing, runtime, and completion policy for manual updates. All existing safety and compatibility rules remain mandatory.

## Update contract

When updating one or more Local Skills:

1. Read `docs/skills/README.md`.
2. Read this invariant document.
3. Read `docs/skills/skill-slimming-process.md`.
4. Read the relevant skill update-process document in `docs/skills/`.
5. Fetch or compare upstream runtime skill content.
6. Classify each affected skill as `keep it`, `make it slim`, or `remove it`.
7. Apply upstream changes only when they do not weaken these local invariants.
8. Reapply local overlays from this document.
9. Update `docs/skills/installed-skills-trim-verdict.md` when the installed-skill decision changes.
10. Run validation before committing.

## Install contract

When installing a new Local Skill:

1. Read `docs/skills/README.md`.
2. Read this invariant document.
3. Read `docs/skills/skill-slimming-process.md`.
4. Load `skill-creator`.
5. Classify the proposed skill as `keep it`, `make it slim`, or `remove it` before adding it.
6. Create `agent/skills/<skill-name>/` only when the classification supports installation or the user explicitly wants it installed.
7. Add `SKILL.md`, `agents/openai.yaml`, and any needed runtime `references/`, scripts, or assets.
8. Add hosted-service safety gates if the skill touches remote services.
9. Add a lightweight `## Maintenance` pointer in `SKILL.md`.
10. Add or update the relevant skill update-process document in `docs/skills/`.
11. Update `docs/skills/installed-skills-trim-verdict.md` when the installed-skill inventory changes.
12. Update `docs/skills/README.md`.
13. Run validation before committing.

## Local structure invariants

- Keep Local Skill frontmatter limited to `name` and `description` by default.
- Allow the Pi-only extension `disable-model-invocation: true` when a workflow must be explicit `/skill:name` only and should stay out of automatic model routing. It is not part of the portable Agent Skills standard.
- Omit `disable-model-invocation` instead of setting it to `false`.
- Every Local Skill must have `agents/openai.yaml`.
- `agents/openai.yaml` is UI metadata only unless a dependency or UI asset is intentionally needed.
- `interface.default_prompt` must mention the skill as `$skill-name`.
- `interface.short_description` should be 25-64 characters.
- Keep long-lived maintenance docs in `docs/skills/`.
- Keep durable installed-skill decisions in `docs/skills/installed-skills-trim-verdict.md`, not in `scratch/`.
- Skill folders should contain runtime instructions, runtime references, scripts, assets, and lightweight maintenance pointers only.

## Routing invariants

- Use the shortest sufficient description that states the capability and activating user intent. Do not add an arbitrary local character cap.
- Distinguish adjacent skills with precise scope boundaries. Include implicit requests only when they belong to the skill's actual workflow.
- Keep procedures, command catalogs, and reference lists out of descriptions; they belong in runtime instructions or linked resources.
- Check intended triggers and near-miss requests against adjacent installed skills before and after syncing upstream.

## Safety invariants

- Preserve hosted-service mutation gates. External hosted services are read-only by default.
- Require explicit user instruction for exact remote mutations such as GitHub writes, Linear changes, Figma writes, NotebookLM changes, Firebase/GCP deploys, database destructive operations, and similar hosted-service actions.
- Preserve GitHub routing through the `gh-cli` skill and authenticated `gh` CLI through Context Mode.
- Preserve Pi's global/project routing rules for shell commands, large output, code review, browser automation, and graph-first CodeGraph exploration without relying on a retired orchestration runtime skill.
- Preserve database safety gates in MySQL/Postgres skills.
- Use `<api-key>` or environment variable names as placeholders. Do not use realistic secret-looking values.
- Do not print, commit, or document secrets, cookies, tokens, private keys, OAuth headers, or user-specific home paths.

## Python execution invariants

- Prefer `uv run python <script.py>` in skill instructions, examples, and helper output when documenting Python script execution.
- Use `uv run --with <package> python <script.py>` when a script needs runtime dependencies that may not exist in the ambient interpreter.
- Use `uvx <tool>` for one-off Python CLI tools that are not project dependencies.
- Avoid bare `python <script.py>`, `python3 <script.py>`, and `pip install ...` in Local Skill runtime docs unless they are intentional bad examples, upstream quotations, or language/version metadata.
- Keep Python script shebangs such as `#!/usr/bin/env python3` when they are useful for direct executable use; the runtime docs should still prefer `uv run python ...`.

## Figma invariants

- Keep the local Figma skill set focused on design-to-code.
- Do not install or restore Figma canvas-writing, generation, or Code Connect skills unless the user explicitly asks for that capability.
- Preserve boundaries that reject Figma canvas writes by default.
- Preserve the Figma flow that requires design context plus screenshot before implementation.

## Token-footprint invariants

- Keep `SKILL.md` under 500 lines where practical.
- Apply `docs/skills/skill-slimming-process.md` during every update or install.
- Move examples, troubleshooting, command catalogs, API details, and long reference material into `references/` files.
- Keep core workflow, safety gates, and reference navigation in `SKILL.md`. For multi-workflow skills, use a minimal router root with shared constraints and task-specific pointers.
- Use progressive disclosure: load details only for the selected workflow, with safety gates visible before the actions they govern.
- Keep long content in one authoritative location; avoid duplication across roots, references, and maintenance docs.
- Do not reinstall retired orchestration skills such as `context-watcher` unless the user explicitly asks; keep foundational routing in global/project instructions instead.

## Runtime and completion invariants

- Remove rigid itineraries and model-era handholding unless correctness, safety, or compatibility depends on them. Preserve exact commands and necessary ordering.
- Preserve mixed-model and cross-harness compatibility. A capable model is not a reason to weaken a local safety invariant.
- Make decision boundaries proportional to risk. Distinguish already-authorized, reversible local work from actions requiring clarification or explicit approval.
- Do not require repeated approval for work already within the user's authorization. Never use this rule to bypass hosted-service mutation gates or broaden scope.
- Define completion where early stopping is likely: the agreed deliverable, relevant checks, and fixes for failures caused by the change.
- State real stop conditions such as missing authority, evidence, or dependencies. Report blocked or incomplete work instead of treating a first draft as completion.
- Validate useful behavior rather than optimizing context size alone. Use representative cases and baseline comparisons when the change or risk warrants them.

## Runtime artifact invariants

- Do not commit generated caches or runtime artifacts, including `__pycache__/`, `.pyc`, logs, temporary downloads, test output, or files under `scratch/`.
- If an upstream import includes generated artifacts, remove them unless they are explicitly required runtime assets.
- Before deleting directories, verify they are not symlinks outside the repo.

## Post-update validation checklist

Run these checks after every skill update:

```bash
for skill_dir in ~/.pi/agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Review changed skills semantically as well as structurally:

- Intended requests activate the skill; adjacent-skill near misses do not. The description contains no procedure or reference list.
- The root selects the relevant workflow without requiring unrelated references. Long content has one authoritative location.
- Any retained itinerary or extra scaffolding has a correctness, safety, or compatibility reason.
- Authorized local work can continue without repeated approval; gated or ambiguous actions still stop at the required boundary.
- Completion covers the agreed deliverable and relevant checks without premature success or unauthorized scope expansion.
- Representative cases preserve required outputs, tool routing, safety behavior, and supported-model compatibility. Record what was reviewed or tested and any behavior not exercised.
- Line and character counts are diagnostics, not proof of routing quality or task success.

Then verify:

- All Local Skills have `agents/openai.yaml`.
- All `agents/openai.yaml` files parse as YAML.
- No Local Skill frontmatter keys exist besides `name`, `description`, and intentional `disable-model-invocation: true` for explicit-only Pi workflows.
- No `default_prompt` is missing `$skill-name`.
- No `short_description` is outside 25-64 characters.
- No local markdown links are broken outside intentional examples in fenced code blocks.
- No literal home paths or secret-looking values appear in changed files.
- No tracked or untracked cache artifacts are present in skill folders.
- Python script execution examples prefer `uv run python ...` or `uv run --with ... python ...` over bare `python ...`.
- Update docs referenced from `docs/skills/README.md` still exist.
- `docs/skills/installed-skills-trim-verdict.md` is updated when a skill is retained, slimmed, removed, installed, or reclassified.
- Removed or grouped maintenance docs have no stale references.

## Commit discipline

Before committing:

1. Review staged files and confirm unrelated files, especially local settings, are not included.
2. Scan staged diff for secrets and home paths.
3. Mention any intentional local divergence from upstream in the commit message or follow-up notes.
4. Push only when the user explicitly asks.
