---
name: skill-creator
description: "Create, update, evaluate, and maintain coding-agent skills. Use whenever a user asks to build or improve a skill, add specialized workflows or tool guidance, test whether a skill improves results, optimize skill triggering, validate skill structure, or synchronize a local skill with upstream sources."
---

# Skill Creator

Create compact skills that provide measurable value beyond base-model behavior. Treat skill creation as an iterative engineering workflow: understand the intended behavior, design the smallest useful skill, validate it, compare it with a baseline when worthwhile, and improve it from evidence.

## Core principles

### Preserve context

Assume the consuming agent is capable. Include only knowledge, constraints, tool procedures, and reusable resources it is unlikely to infer reliably.

Use progressive disclosure:

1. `name` and `description` route the request.
2. `SKILL.md` carries the core workflow.
3. `references/`, `scripts/`, and `assets/` are loaded or used only when needed.

Keep `SKILL.md` under 500 lines where practical. Move long examples, command catalogs, schemas, troubleshooting, and variant-specific guidance into directly linked references.

### Match freedom to risk

- Use flexible prose for judgment-heavy tasks with many valid approaches.
- Use ordered workflows or pseudocode when a preferred pattern matters.
- Use deterministic scripts and strict checks for fragile, repetitive, security-sensitive, or format-sensitive work.

Explain why important constraints exist. Use rigid `ALWAYS` or `NEVER` rules only when violating them would create a real correctness, safety, or compatibility failure.

### Prove value

A plausible `SKILL.md` is not evidence that a skill helps. For objectively testable or high-risk skills, compare realistic runs with the skill against a baseline. Use human review for subjective quality and programmatic checks for deterministic outcomes.

Do not overfit instructions to a few examples. Generalize from failures and retain an untouched regression set for mature skills.

## Skill structure

```text
skill-name/
├── SKILL.md                  # Required runtime instructions
├── agents/openai.yaml        # Recommended cross-harness UI metadata
├── scripts/                  # Deterministic helpers
├── references/               # Details loaded on demand
├── assets/                   # Templates and output resources
└── evals/evals.json          # Optional source-controlled behavior tests
```

Do not add auxiliary files such as `README.md`, changelogs, installation guides, or process notes to the skill folder. Keep long-lived maintenance documentation in the host repository's documentation area and link to it from a short `## Maintenance` section.

## Workflow

### 1. Determine the request type

Classify the task before editing:

- **Create**: design a new skill.
- **Update**: synchronize or improve an existing skill while preserving local invariants.
- **Evaluate**: test behavior or trigger quality without redesigning prematurely.
- **Repair**: fix validation, routing, resource, or execution failures.

For updates, read the host repository's skill-maintenance policy and the skill's maintenance pointer before copying upstream content. Treat upstream as input, not automatic final truth.

### 2. Capture the skill contract

Derive answers from the conversation and existing workflow before asking the user. Clarify only gaps that materially affect implementation.

Establish:

1. What capability should the skill enable?
2. What realistic user requests should trigger it?
3. What adjacent requests should not trigger it?
4. What inputs, outputs, tools, and dependencies are involved?
5. Which safety, mutation, privacy, or compatibility boundaries matter?
6. How will success be recognized?
7. Is a qualitative review sufficient, or are comparative evaluations warranted?

Collect concrete examples. Include happy paths, meaningful edge cases, and near-miss triggers. Do not overwhelm the user with a long questionnaire when safe assumptions are available.

### 3. Research before drafting

Inspect:

- Existing project conventions and maintenance docs
- Similar installed skills and name collisions
- Current tool or API documentation when details may have changed
- Existing scripts, templates, and schemas that can be reused
- Applicable Agent Skills and harness-specific constraints

Prefer adapting established local patterns over inventing a second convention.

### 4. Plan reusable contents

For each concrete example, consider how an agent would execute it from scratch. Identify repeated or fragile work:

- Put deterministic repeated operations in `scripts/`.
- Put detailed domain knowledge and variants in `references/`.
- Put templates, icons, fonts, and boilerplate used in outputs in `assets/`.
- Keep only routing and core procedure in `SKILL.md`.

Do not create resource directories without a real use.

### 5. Initialize

For a new skill, run from this skill directory:

```bash
uv run --with pyyaml python scripts/init_skill.py <skill-name> \
  --path <output-directory> \
  [--resources scripts,references,assets] \
  [--with-evals] \
  [--interface key=value]
```

Generate a short, verb-led, lowercase hyphenated name no longer than 64 characters. Namespace by tool or platform when that improves routing.

Generate human-facing `display_name`, `short_description`, and `default_prompt` in `agents/openai.yaml`. Read [references/openai_yaml.md](references/openai_yaml.md) for its interface constraints.

Skip initialization when editing an existing skill.

### 6. Implement the runtime resources first

Build necessary scripts, references, and assets before finalizing `SKILL.md`. Test changed scripts with representative inputs. Remove all placeholders and unused example files.

Write instructions for another agent instance, not as user documentation. Use imperative language and include:

- Decision points the agent cannot infer safely
- Exact local commands or tool routing when required
- Error recovery for realistic failures
- Hosted-service mutation gates and secret-handling rules where applicable
- Clear instructions for when to read each reference

Avoid speculative features, duplicated explanations, and broad tutorials.

### 7. Write routing metadata

Frontmatter must contain only:

```yaml
---
name: skill-name
description: What it does. Use when these concrete intents, contexts, tools, or file types are involved.
---
```

The description is the primary trigger. Include both capability and usage contexts there; do not rely on a body section called “When to use,” because the body is unavailable before triggering.

Make the description broad enough to catch implicit but relevant requests and narrow enough to avoid adjacent skills. Describe user intent rather than internal implementation.

### 8. Validate

Run:

```bash
uv run --with pyyaml python scripts/quick_validate.py <path-to-skill>
```

Fix all reported structural, metadata, placeholder, and local-link errors. Then test changed helper scripts and inspect the final skill tree for unnecessary or sensitive files.

### 9. Evaluate proportionally

Use lightweight manual checks for simple or subjective skills. Use comparative evaluations when outputs are objectively verifiable, the workflow is fragile, the skill is foundational, or the user asks for benchmarking.

Read [references/evaluation.md](references/evaluation.md) before running evaluations. It defines:

- Realistic test design
- The Pi-native isolated runner
- Baseline selection
- Grading and blind comparison
- Benchmark aggregation
- Human review
- Trigger tests and regression sets

Do not run prompts that could mutate hosted services or real user data. Use local fixtures and explicit evaluation sandboxes.

### 10. Improve from evidence

When a run fails, identify the causal layer:

- **Routing failure**: revise the description or resolve a skill collision.
- **Instruction failure**: clarify decisions or explain why a constraint matters.
- **Resource failure**: add or fix a script, reference, or asset.
- **Tool/environment failure**: repair compatibility or setup guidance.
- **Evaluation failure**: strengthen weak or unverifiable assertions.

Inspect transcripts as well as final outputs. Repeated helper code across runs is a signal to bundle a script. Repeated ignored instructions are a signal to simplify or restructure them.

Rerun the affected cases and the untouched regression set. Stop when the user is satisfied, all meaningful checks pass, or further changes no longer produce meaningful gains.

### 11. Finalize

Before reporting completion:

- Confirm the skill name and folder are intentional for the target harness.
- Confirm `agents/openai.yaml` matches the final skill.
- Remove placeholders, generated output, caches, logs, and temporary evaluation workspaces.
- Keep reusable eval definitions only when they are intentional source artifacts.
- Run target validation and any host-repository validation suite.
- Update maintenance documentation when source provenance or update procedure changed.

Report changed paths and checks run. Do not package, install, commit, or publish unless the user requested that state change.

## Maintenance

This is a locally unified skill derived from OpenAI and Anthropic skill-creator workflows. For future synchronization, provenance rules, and source-specific update steps, read `../../../docs/skills/skill-creator-update-process.md`.
