# Updating the unified skill creator

Purpose: maintain `agent/skills/skill-creator` as a Pi-native synthesis of OpenAI's skill scaffolding, Anthropic's evaluation workflow, and local Pi maintenance and safety invariants.

The local skill keeps the public name `skill-creator`. It is not a verbatim mirror of either upstream. Upstream content is evidence and input; the local runtime contract wins when behavior conflicts.

## Current provenance

| Source | Repository | Upstream path | Reviewed checkout commit | Last path-specific commit observed |
| --- | --- | --- | --- | --- |
| OpenAI | https://github.com/openai/skills | `skills/.system/skill-creator` | `49f948faa9258a0c61caceaf225e179651397431` | `4ab6e0f` |
| Anthropic | https://github.com/anthropics/skills | `skills/skill-creator` | `fa0fa64bdc967915dc8399e803be67759e1e62b8` | `b9e19e6` |
| Pi | Pi documentation installed with `@earendil-works/pi-coding-agent` | `docs/skills.md`, `README.md`, and `docs/json.md` | Local installed package | N/A |

Common local checkouts:

- OpenAI: `~/development/skills/skills/.system/skill-creator/`
- Anthropic: `~/development/claude-skills/skills/skill-creator/`
- Installed unified skill: `agent/skills/skill-creator/`

Update the reviewed commit fields only after examining source changes relevant to this skill.

## Ownership map

Use this map to avoid replacing local files blindly.

| Local area | Primary influence | Local rule |
| --- | --- | --- |
| Skill anatomy, progressive disclosure, degrees of freedom | OpenAI | Preserve concise scaffolding and reusable-resource guidance |
| `scripts/init_skill.py` | OpenAI plus local extensions | Rebase useful upstream changes; preserve `uv`, default UI metadata, and optional eval scaffolding |
| `scripts/generate_openai_yaml.py` and `references/openai_yaml.md` | OpenAI | Preserve local requirement that generated `default_prompt` mentions `$skill-name` |
| Evaluation methodology and schemas | Anthropic | Port concepts, not Claude-specific command/subagent mechanics |
| `scripts/eval_utils.py` | Pi-native shared boundary | Preserve strict LF-framed event validation, null usage semantics, process-group cleanup, output caps, CLI allowlisting, and non-persistence of commands or credentials |
| `scripts/run_skill_evals.py` | Pi-native | Force mandatory skill instructions, use safe marked workspaces and contained fixtures, hide arm identity during execution, and counterbalance scheduling |
| `scripts/run_trigger_evals.py` | Pi-native adaptation of Anthropic's trigger-eval idea | Test actual Pi skill reads, isolate registries, and keep infrastructure errors separate from non-triggers |
| `scripts/aggregate_benchmark.py` | Local rewrite of Anthropic concept | Keep expected-job manifests, matched-pair deltas, null/missing semantics, and prominent critical failures |
| `scripts/generate_review.py` | Local rewrite of Anthropic concept | Keep symlink-safe output reads, atomic feedback, free ports, safe JSON, offline operation, size limits, and structurally blind client data |
| `scripts/quick_validate.py` | OpenAI plus local invariants | Keep strict local frontmatter, metadata, placeholder, and link checks; retain portable profile |
| Runtime `SKILL.md` | Unified | Keep under 500 lines and route details into references |

## Known upstream behavior not to reintroduce

Do not copy these Anthropic implementation details without redesign:

- Shared temporary `.claude/commands` files during parallel trigger tests
- Treating the first unrelated tool call, timeout, or subprocess failure as a non-trigger
- A documented direct-run workspace layout that disagrees with the aggregator's `run-*` requirement
- Inferring primary/baseline order alphabetically
- Hard-coded run counts or token fallbacks based on character counts
- Killing an arbitrary process occupying a fixed viewer port
- Injecting unescaped model output into executable HTML script content
- Remote CDN dependencies in a supposedly standalone viewer

Do not weaken the Pi-native safety and validity layer by reintroducing:

- Unmarked recursive workspace deletion, path-derived eval directories, or symlink-following artifact reads/writes
- Absolute, escaping, symlinked, or non-regular fixture inputs
- Unbounded captured subprocess output or direct-process-only timeout cleanup
- Behavior tests that merely register a skill instead of force-loading its body
- Trigger meta-prompts that announce routing evaluation or instruct the model to select a skill
- Raw arm names in model-visible paths or blind client data
- Aggregation over unmatched, failed, missing, invalid, or ungraded arm pairs
- Success classification based only on process exit code rather than complete Pi event semantics
- Persisted command lines, credentials, or treatment identity in per-run artifacts

Do not reintroduce these OpenAI/local scaffold regressions:

- Frontmatter fields beyond `name` and `description` in local skills
- Bare `python` execution examples
- Generated `agents/openai.yaml` without a `$skill-name` default prompt
- Validators that accept empty names, empty descriptions, or unresolved starter placeholders

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Read this document completely.
5. Inspect both upstream checkouts and record their current commits:

   ```bash
   git -C ~/development/skills rev-parse HEAD
   git -C ~/development/claude-skills rev-parse HEAD
   ```

6. Compare each source from the previously reviewed commit, scoped to its skill directory. Review all changed runtime files, not only `SKILL.md`.
7. Classify each upstream change:
   - **Adopt directly**: portable correctness or documentation improvement with no local conflict.
   - **Adapt**: valuable behavior that needs Pi commands, local safety, or local schemas.
   - **Reject**: Claude/Codex-specific behavior, duplication, regression, or excessive runtime context.
8. Apply changes according to the ownership map. Never replace the unified folder wholesale.
9. Keep `SKILL.md` compact. Put evaluation details in `references/evaluation.md`, schemas in `references/eval-schemas.md`, and durable provenance here.
10. Update this document's commits and ownership notes when the integration changes.
11. Update `docs/skills/openai-skills-update-process.md` if the OpenAI source commit changes.
12. Update `docs/skills/installed-skills-trim-verdict.md` only if classification or rationale changes.
13. Run the checks below.

## Required checks

Compile bundled scripts without writing cache files into the skill directory:

```bash
for script in agent/skills/skill-creator/scripts/*.py; do
  PYTHONPYCACHEPREFIX="${TMPDIR:-/tmp}/skill-creator-pycache" uv run python -m py_compile "$script"
done
```

Keep the temporary bytecode cache outside the skill folder and remove it after the check.

Validate the unified skill first:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/skill-creator
```

Exercise initializer and validator behavior in a temporary directory:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/init_skill.py sample-skill --path <temp-dir> --with-evals
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py <temp-dir>/sample-skill
```

The starter should fail strict validation until its TODO placeholders are replaced. After replacing them, validation should pass.

Run the bundled adversarial regression suite:

```bash
env PYTHONDONTWRITEBYTECODE=1 uv run --with pyyaml python agent/skills/skill-creator/scripts/test_skill_creator.py -v
```

The suite covers protected workspace replacement, path traversal, symlinks, fixture containment, process-group timeouts, output caps, strict Pi event streams, matched aggregation, critical failures, neutral metadata, trigger IDs, validator profiles, and blind HTML structure.

Test evaluation utilities with synthetic fake-Pi fixtures. Spend model tokens only when runner or routing semantics changed enough to justify a small real-Pi smoke test.

Then validate all Local Skills using the command in `local-skill-update-invariants.md`. Also verify:

- Every local `agents/openai.yaml` parses.
- No changed markdown links are broken.
- No generated caches, logs, test workspaces, or downloads remain in skill folders.
- No literal user-specific home path or secret-looking value appears in changed files.
- Evaluation scripts never mutate hosted services during tests.

## Merge philosophy

The OpenAI source is strongest at constructing a compact, compatible skill. The Anthropic source is strongest at testing whether the skill adds value. Pi provides the actual execution and isolation model. Future updates should preserve this separation rather than allowing one upstream's harness assumptions to dominate the unified implementation.
