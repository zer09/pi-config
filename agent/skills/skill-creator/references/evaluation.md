# Skill evaluation workflow

Use this workflow to determine whether a skill improves real behavior rather than merely looking plausible.

## Contents

- [Choose the evaluation level](#choose-the-evaluation-level)
- [Design useful cases](#design-useful-cases)
- [Create the eval set](#create-the-eval-set)
- [Select a baseline](#select-a-baseline)
- [Run behavior evaluations](#run-behavior-evaluations)
- [Grade outcomes](#grade-outcomes)
- [Aggregate and review](#aggregate-and-review)
- [Improve without overfitting](#improve-without-overfitting)
- [Test trigger quality](#test-trigger-quality)

## Choose the evaluation level

| Level | Use when | Method |
| --- | --- | --- |
| Smoke | Simple workflow or early draft | Run 1-2 representative prompts and inspect results |
| Qualitative | Style, design, architecture, or judgment dominates | Human review, optionally blind |
| Comparative | Outputs have meaningful objective requirements | With-skill versus baseline plus assertions |
| Regression | Foundational, safety-sensitive, or mature skill | Repeated comparative runs plus untouched holdout cases |

Do not force subjective quality into weak quantitative assertions. Do not skip human review merely because objective assertions pass.

## Design useful cases

Start with 3-5 realistic prompts. Expand coverage before claiming broad reliability.

Cover relevant dimensions:

- Common happy paths
- Ambiguous wording and implicit intent
- Meaningful edge cases
- Invalid or incomplete inputs
- Tool or dependency failure
- Recovery behavior
- Read-only versus mutation requests
- Near-miss requests that should use another skill
- Different input sizes or formats

Use concrete names, paths, fields, and constraints. Avoid toy prompts such as “process this file.”

Assertions should be objectively verifiable, difficult to satisfy accidentally, and focused on outcomes. Mark safety- or correctness-critical assertions with `"critical": true`. Any critical failure blocks release regardless of average pass rate.

## Create the eval set

Store intentional source-controlled cases at `<skill>/evals/evals.json`, or keep ad hoc cases outside the skill. See [eval-schemas.md](eval-schemas.md).

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "name": "preserves-formulas",
      "prompt": "Update the provided workbook and preserve its formulas.",
      "expected_output": "An updated workbook with formulas intact.",
      "files": ["files/input.xlsx"],
      "assertions": [
        {"text": "All original formulas remain present", "critical": true}
      ]
    }
  ]
}
```

Eval IDs must be non-negative integers or strict 1-64 character slugs. Fixture paths must be relative to an explicit fixture root; absolute paths, traversal, symlinks, and non-regular entries are rejected.

Keep generated runs outside the skill:

```text
example-skill-workspace/
└── iteration-1/
    ├── .skill-eval-workspace.json
    ├── manifest.json
    ├── eval-1-preserves-formulas/
    │   ├── eval_metadata.json
    │   ├── arm-<opaque>/run-1/
    │   └── arm-<opaque>/run-1/
    ├── benchmark.json
    └── feedback.json
```

Never commit generated workspaces, logs, caches, or downloaded feedback to a runtime skill.

## Select a baseline

- New skill: no skill instructions.
- Existing skill: an immutable snapshot of the previous version.
- Competing designs: compare explicit snapshots and use blind review.

Keep model, tools, fixtures, and user prompt identical. The only intended difference is the mandatory skill instruction block.

## Run behavior evaluations

The behavior runner does not test routing. It injects the complete selected `SKILL.md` as mandatory system instructions in the treatment arm and injects no skill—or the old snapshot—in the baseline arm. This ensures every treatment run receives the body even when its description would not trigger naturally.

```bash
uv run python scripts/run_skill_evals.py <path-to-skill> \
  --eval-set <path-to-evals.json> \
  --fixture-root <path-to-contained-fixtures> \
  --workspace <new-iteration-workspace>
```

Useful options:

```text
--baseline-skill <path>    Compare against an old skill snapshot
--runs 3                  Repeat stochastic cases
--max-workers 2           Run multiple process-isolated sessions
--provider <provider>     Pin provider
--model <model>           Pin model
--thinking <level>        Pin thinking effort
--timeout 900             Per-run wall-time limit
--max-output-mb 10        Combined stdout/stderr cap
--tools read,write,edit   Override safe default; add bash only when required
--seed 42                 Reproduce arm mapping and balanced schedule
--pi-arg=--offline        Allowed extra Pi flags: --offline and --verbose only
```

The runner:

- Rejects unsafe workspace deletion unless a valid runner-owned marker is present
- Rejects protected, ancestor, symlinked, and unowned overwrite targets
- Copies only contained regular fixtures with deterministic collision-free names
- Uses opaque, equally shaped arm directories
- Counterbalances arm execution order and records the seed and schedule
- Adds `--no-approve` and disables discovered skills, context, extensions, prompts, and sessions
- Rejects CLI flags that could override trust, tools, prompts, resources, or credentials
- Streams subprocess output into capped files
- Terminates the runner-owned process group on timeout or output overflow and closes lingering pipes after a bounded drain period
- Requires a valid LF-delimited Pi stream, terminal `agent_end`, and successful final stop reason
- Records unavailable usage as `null`, never as synthetic zero
- Writes arm identities and the manifest only after model execution finishes

This isolates context, registries, sessions, working directories, and the original process group; it is not an operating-system sandbox. A deliberately self-daemonizing descendant can leave that process group, although the runner still returns within its pipe-drain bound. Enabled tools retain the user's filesystem permissions. Use a container or cgroup-backed sandbox when hostile skills, fixtures, or complete descendant cleanup are in scope.

`--overwrite` is intentionally strict. It replaces only a workspace containing a valid `.skill-eval-workspace.json` marker that identifies that exact resolved path.

## Grade outcomes

Grade every completed arm against the same assertions. Prefer deterministic scripts for machine-checkable facts such as file parseability, required values, formulas, schemas, and mutation boundaries.

Use an independent agent or human for semantic assertions. Do not reveal arm identity. Every verdict needs evidence; unverifiable assertions fail.

Write `grading.json` in each run directory using [eval-schemas.md](eval-schemas.md). The aggregator derives counts from `expectations`; it does not trust a contradictory summary.

Also critique the eval:

- Would a clearly wrong output pass?
- Is an important result untested?
- Is an assertion impossible to verify from saved artifacts?
- Does it reward implementation details rather than user value?

## Aggregate and review

```bash
uv run python scripts/aggregate_benchmark.py <iteration-workspace> \
  --skill-name <skill-name>
```

Aggregation uses `manifest.json` as the job contract. Missing or malformed artifacts remain missing. Only completed, valid, graded `(eval_id, run_number)` pairs enter comparative deltas. Configuration summaries and matched-pair deltas report their own sample counts.

Critical failures are listed prominently in JSON, Markdown, and the viewer.

Generate a local review UI:

```bash
uv run python scripts/generate_review.py <iteration-workspace> \
  --benchmark <iteration-workspace>/benchmark.json
```

Generate a blind standalone review:

```bash
uv run python scripts/generate_review.py <iteration-workspace> \
  --benchmark <iteration-workspace>/benchmark.json \
  --blind \
  --static <iteration-workspace>/review.html
```

Blind mode randomizes labels and removes known raw arm names, mappings, current and previous skill paths, commands, evaluation wrappers, and structural identifiers from client data. Output text containing those exact tokens is scrubbed. Blinding reduces obvious identity leakage but cannot guarantee that semantically distinctive treatment output will not reveal itself. The server rejects unsafe feedback targets and replaces regular `feedback.json` atomically. Static mode downloads feedback instead.

The viewer rejects output symlinks and non-regular files, enforces per-file and total embedding limits, uses no remote dependencies, and safely embeds JSON.

Examine:

- Critical failures
- Assertions passing in both configurations
- Assertions failing in both configurations
- Unmatched or invalid runs
- High variance
- Quality improvements that cost excessive time or tokens
- Errors hidden by aggregate averages

## Improve without overfitting

Identify the causal layer: routing, instructions, resources, environment, or evaluation design. Make the smallest general change that addresses it.

Do not add a narrow rule for every failed prompt. Explain the underlying decision, add a reusable script, or restructure guidance.

For mature evaluations, use:

- Development set: visible during iteration
- Selection set: compares candidates
- Final holdout: untouched until the candidate is selected

Reusing a “test” set to select each iteration makes it a validation set, not an unbiased final test.

## Test trigger quality

Behavior evaluation force-loads instructions, so test routing separately using raw production-style user requests.

```json
{"id": 1, "query": "A realistic user request", "should_trigger": true}
```

Run:

```bash
uv run python scripts/run_trigger_evals.py <path-to-skill> \
  --eval-set <path-to-trigger-evals.json> \
  --output <path-to-results.json> \
  --runs 3
```

Use `--competing-skill <path>` for adjacent skills. Skill names must be distinct because Pi resolves collisions first-wins. A seeded shuffled base registry is rotated across runs so each skill occupies each position as evenly as possible.

The runner sends each raw query unchanged, allows only `read`, and records whether Pi read the target `SKILL.md`. It does not announce an evaluation or instruct the model to choose a skill. Run counts must be odd so ties cannot be mislabeled.

If any requested run for a query has an infrastructure error, malformed stream, timeout, or unsuccessful stop reason, the whole query remains unscored. Do not reuse Anthropic's `.claude/commands` trigger runner for Pi; it tests a different registry.

Revise descriptions using development failures, compare candidates on a selection set, and reserve a final untouched trigger holdout before claiming accuracy.
