# Delegated Pi loop update process

Purpose: maintain `agent/skills/delegated-pi-loop` as the local source of truth for orchestrating fresh Pi implementation, independent review, finding verification, and focused remediation delegates on one shared working tree.

## Classification and provenance

- Classification: **keep it**, implemented slimly through progressive disclosure.
- Source of truth: this Pi config, ADR 0007, and observed successful delegated implementation/review workflows.
- Harness authority: the Pi CLI reference installed with `@earendil-works/pi-coding-agent` for `--print`, `--no-session`, `--approve`, provider/model/thinking flags, context-file loading, and process environment behavior.
- Project execution guides and accepted architecture decisions remain authoritative for project-specific role prompts, finding taxonomies, gates, and release transitions.

This skill is retained because role isolation, neutral-review handling, direct-spawn constraints, shared-tree mutation safety, and the verification/remediation loop are easy to weaken when reconstructed ad hoc.

## Owned surfaces

| Path | Responsibility |
|---|---|
| `agent/AGENTS.md` | Compact trigger and global safety invariants |
| `agent/skills/delegated-pi-loop/SKILL.md` | Runtime orchestration workflow and role boundaries |
| `agent/skills/delegated-pi-loop/references/prompt-contracts.md` | Exact spawn commands, fingerprints, and role prompt contracts |
| `agent/skills/delegated-pi-loop/agents/openai.yaml` | Human-facing skill metadata |
| `docs/skills/delegated-pi-loop-update-process.md` | Long-lived provenance, update process, and validation contract |

## Invariants

Preserve all of these unless the user explicitly changes the workflow:

1. The parent session is the sole orchestrator; delegates do not recursively spawn Pi.
2. Delegates run through direct `bash`, not Context Mode, and the spawning tool call has no timeout.
3. Every delegate uses a fresh ephemeral `--no-session` process.
4. At most one mutating delegate runs on a shared working tree, with no concurrent parent edits.
5. Implementation and remediation default to `openai-codex/gpt-5.6-luna` at `max` thinking.
6. Independent review and finding verification default to `openai-codex/gpt-5.6-sol` at `high` thinking.
7. Reviewers and verifiers are read-only, neutral, and checked against pre/post tree fingerprints.
8. A project-provided verification template must be instantiated before focused remediation; parent analysis is not a substitute.
9. A fresh independent review follows every remediation round.
10. Git transitions and hosted-service writes retain their separate explicit-authorization gates.
11. Temporary prompts and reports remain outside tracked project paths and contain no secrets.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Read this document and every owned surface above.
3. Read the installed Pi `README.md`, `docs/skills.md`, `docs/sessions.md`, and `docs/environment-variables.md` before changing CLI/session behavior.
4. Compare proposed behavior against at least one current project execution guide when project-template precedence or role separation changes.
5. Confirm configured model IDs and supported thinking levels from the current Pi catalog before changing defaults.
6. Keep the global `AGENTS.md` section compact; move detailed commands and prompt formats into the runtime reference.
7. Keep `SKILL.md` under 500 lines and preserve its maintenance pointer.
8. Update `agents/openai.yaml` when the description or user-facing invocation changes.
9. Update the installed-skill inventory, skill-maintenance README, root README, config-context-cost attribution, and changelog when applicable.
10. Validate without paid model inference by default. Run a real delegate smoke only when CLI/model semantics changed and the user authorizes its cost and mutation scope.

## Required checks

Validate the target skill:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/delegated-pi-loop
```

Then validate all Local Skills using the command in `local-skill-update-invariants.md`.

Also verify:

- `agents/openai.yaml` parses and its `default_prompt` mentions `$delegated-pi-loop`.
- The runtime skill and reference contain no unresolved scaffold/TODO placeholders or user-specific home paths; generic prompt fields are clearly marked for replacement.
- All changed local Markdown links resolve.
- No caches, logs, delegate transcripts, temporary prompts, or evaluation artifacts were added.
- The global rule and skill agree on direct bash routing, no timeout, fresh sessions, role models, reviewer neutrality, and mutation gates.
- Existing unrelated dirty config files remain untouched.

## Evaluation guidance

The workflow has objective structural checks but real behavior evaluation can spend provider tokens and mutate a test tree. Prefer a disposable local Git fixture when evaluation is warranted. Test these cases:

1. Explicit delegated implementation triggers the skill and produces one Luna/max spawn contract.
2. Independent review produces a fresh Sol/high read-only contract with no remediation steering.
3. A reproduced finding routes through verification, focused remediation, and a fresh review.
4. A non-reproduced finding does not trigger speculative mutation.
5. Architecture ambiguity stops for user input.
6. A read-only delegate tree change invalidates the delegation instead of being silently reverted.
7. Requests for ordinary coding without delegation do not force an unnecessary spawned loop.

Do not run hosted-service mutations, use a real user project as an evaluation fixture, or persist provider credentials or delegate command lines in evaluation artifacts.
