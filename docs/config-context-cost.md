# Config context cost

Quantitative calibration date: 2026-07-01

Structural inventory refresh: 2026-07-19 (Pi 0.80.10; `pi-browser-harness` 0.8.3; 57 registered tools, 54 active tools including 36 browser tools). Provider calibration was not rerun; current tool schema and guideline attribution was measured offline.

Skill-catalog-only update: 2026-07-09 (added `directus-browser`; provider calibration was not rerun)

Global-instruction and skill-catalog incremental update: 2026-08-03 (added `delegated-pi-loop`; provider calibration and the full extension/tool inventory were not rerun)

Delegated environment-contract update: 2026-08-09 (added scoped parent-session marker scrubbing; provider calibration and the full extension/tool inventory were not rerun)

Skill and CLI synchronization update: 2026-08-09 (refreshed current CLI references and selected upstream runtime guidance; provider calibration and the full extension/tool inventory were not rerun)

Delegated Z.AI model-alternative update: 2026-08-15 (added explicit GLM 5.3/max role selection; provider calibration and the full extension/tool inventory were not rerun)

Delegated process-supervisor update: 2026-08-15 (added bounded child execution and durable failure diagnostics; provider calibration and the full extension/tool inventory were not rerun)

Delegated role-effort update: 2026-08-16 (adopted Luna/xhigh implementation, Sol/medium verification, and retained Sol/high review; provider calibration and the full extension/tool inventory were not rerun)

Delegated implementation-routing update: 2026-08-16 (made GLM 5.3/max the implementation default and restricted Luna/xhigh to classified small tasks; provider calibration and the full extension/tool inventory were not rerun)

Delegated activity-monitoring update: 2026-08-16 (added private Pi JSON liveness monitoring and structured terminal outcomes; provider calibration and the full extension/tool inventory were not rerun)

Delegated provider-fallback update: 2026-08-16 (added guarded small-task fallback and a concurrent independent-review pair; provider calibration and the full extension/tool inventory were not rerun)

Delegated Z.AI role-alignment update: 2026-08-16 (clarified GLM 5.3/max availability for any assigned role while preserving assigned-role mutation limits; provider calibration and the full extension/tool inventory were not rerun)

Delegated provider-credential guidance update: 2026-08-16 (documented parent-process credential inheritance and restart requirements; provider calibration and the full extension/tool inventory were not rerun)

Delegated solution-investigation update: 2026-08-16 (added a concurrent read-only pre-implementation solution pair and orchestrator synthesis contract; provider calibration and the full extension/tool inventory were not rerun)

Delegated SeekAI role-routing update: 2026-08-16 (replaced three default GoRouter roles with SeekAI Claude Opus 5, Claude Opus 4.8, and Claude Fable 5; provider calibration and the full extension/tool inventory were not rerun)

Delegated terminal-cleanup update: 2026-08-17 (accepted valid completed Pi lifecycles before process exit and cleaned up lingering process groups; provider calibration and the full extension/tool inventory were not rerun)

Delegated client-cancellation update: 2026-08-19 (recognized provider-side `client_gone` and `context canceled` signals while preserving the post-tool fallback cutoff; provider calibration and the full extension/tool inventory were not rerun)

Delegated error-envelope update: 2026-08-19 (recognized the machine-rendered provider `[error]` envelope returned as the complete assistant report as a route-unavailability signal; provider calibration and the full extension/tool inventory were not rerun)

Delegated single-line envelope refinement: 2026-08-19 (restricted that recognition to a one-line `[error]` envelope and kept multi-section `[error]`-prefixed reports terminal; provider calibration and the full extension/tool inventory were not rerun)

CWD measured: `/home/gc/.pi`

Pi version for quantitative calibration: `0.80.2`

Pi version for the historical structural inventory: `0.80.10`

Current tracked upgrade target: `0.84.1` (full structural inventory not rerun)

Model/provider calibrated against: `openai-codex/gpt-5.5`, thinking `xhigh`

Local tokenizer used for attribution: Python `tiktoken` `o200k_base`

This document tracks the model-context cost of this Pi configuration at harness startup / first request.

Important correction: Pi extensions may register tools and inject prompt text during lifecycle hooks. A static SDK snapshot taken before `session_start` undercounts this config because `pi-browser-harness` registers its `browser_*` tools during `session_start`.

## What is authoritative?

Provider usage is authoritative for input/output token cost. Pi receives it from the provider response and stores it in the local session JSONL for that run.

This snapshot records the portable calibration values, not a machine-local session filename. On another machine, rerun the calibration protocol and use that machine's newly reported usage.

Calibration values for prompt `hi`:

| Field | Tokens | Meaning |
|---|---:|---|
| `usage.input` | 14,704 | Input tokens counted by OpenAI/Codex: instructions, active tools, user prompt, and provider request framing |
| `usage.output` | 14 | Assistant response tokens |
| `usage.cacheRead` | 0 | Cached input tokens read |
| `usage.cacheWrite` | 0 | Cached input tokens written |
| `usage.totalTokens` | 14,718 | Provider total for this response |

Pi maps provider usage from the OpenAI/Codex response, then stores it. Pi does not compute this 14.7k locally with `tiktoken`.

### Reproduce the provider calibration

Run from the cwd/config being measured. The output file is only scratch evidence for that machine; the portable result is the extracted `usage` object.

```bash
OUT=/tmp/pi-full-hi.jsonl
pi --mode json --no-session \
  --model openai-codex/gpt-5.5 \
  --thinking xhigh \
  hi > "$OUT"

node - "$OUT" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];

for (const line of fs.readFileSync(file, "utf8").split(/\n/)) {
  if (!line.trim()) continue;
  const event = JSON.parse(line);
  if (event.type === "message_end" && event.message?.role === "assistant") {
    console.log(JSON.stringify(event.message.usage, null, 2));
    break;
  }
}
NODE
```

For this snapshot, that usage object contained:

```json
{
  "input": 14704,
  "output": 14,
  "cacheRead": 0,
  "cacheWrite": 0,
  "totalTokens": 14718
}
```

The calibration number is `usage.input` for input context. `usage.totalTokens` includes output tokens too.

To reproduce the probe table below, run the same extraction against these variants:

```bash
COMMON=(--mode json --no-session --model openai-codex/gpt-5.5 --thinking xhigh)

# Minimal baseline: no tools, context files, skills, prompt templates, or extensions.
pi "${COMMON[@]}" --no-context-files --no-skills --no-prompt-templates --no-extensions --no-tools hi \
  > /tmp/pi-minimal-hi.jsonl

# Core tools only.
pi "${COMMON[@]}" --no-context-files --no-skills --no-prompt-templates --no-extensions \
  --tools read,bash,edit,write hi \
  > /tmp/pi-core-tools-hi.jsonl

# Global/project context files only-ish.
pi "${COMMON[@]}" --no-skills --no-prompt-templates --no-extensions --no-tools hi \
  > /tmp/pi-context-only-hi.jsonl

# Core tools + context files + skill catalog, no extensions or prompt templates.
pi "${COMMON[@]}" --no-prompt-templates --no-extensions --tools read,bash,edit,write hi \
  > /tmp/pi-core-context-skills-hi.jsonl

# Full normal config.
pi "${COMMON[@]}" hi > /tmp/pi-full-hi.jsonl
```

## Scope and caveats

- Counts reflect the working tree at measurement time, including existing uncommitted config changes.
- Provider-reported usage is the billing/context source of truth.
- Local `tiktoken` counts are used for attribution: which config surfaces are large, which extension/tool/skill contributes text, and how counts move after a config change.
- Local `tiktoken` totals are not guaranteed to equal provider totals. Provider tokenization, Responses API framing, tool framing, and hidden/backend protocol all differ from plain local string counting.
- Token counts are not always additive because BPE token boundaries change when sections are joined.
- Prompt templates, extension command metadata, full `SKILL.md` files, tool results, and prior session history are not startup model context unless invoked/read/sent in a later turn.

## 2026-08-03 delegated-loop incremental attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration was run. The earlier provider-calibrated totals and structural tool inventory below remain historical baselines rather than current totals.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 1,843 | 2,142 | +299 | Always loaded through the context-file block |
| Local Skill directories | 33 | 34 | +1 | Only catalog metadata is loaded at startup |
| `delegated-pi-loop` description | — | 74 | +74 before catalog framing | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | — | 1,671 | On demand | Loaded only when the skill is read |
| `references/prompt-contracts.md` | — | 1,857 | On demand | Loaded only when the skill routes to a delegated spawn |

The compact global rule intentionally carries only the trigger, backend-selection rule, and safety invariants. Pi/Claude role commands, prompt formats, fingerprints, and troubleshooting remain progressively disclosed through the skill and its reference.

## 2026-08-09 delegated environment-contract attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration was run. The skill catalog description and active tool inventory did not change.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,479 | 2,529 | +50 | Always loaded through the context-file block |
| `delegated-pi-loop/SKILL.md` | 1,671 | 1,721 | +50 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 1,857 | 2,111 | +254 | Loaded only before a delegate spawn |

The startup delta is limited to the 50-token global safety rule. Exact `env -u` commands remain on demand.

## 2026-08-09 skill and CLI synchronization attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration was run. Four catalog descriptions changed. Across all reviewed target descriptions, the subtotal moved from 690 to 704 tokens, a net startup increase of 14 tokens.

Runtime body and reference changes remain on demand. The largest body deltas were `crit-cli` +105, `firebase-ai-logic-basics` +88, `crit` +87, `nlm-skill` +78, and `improve-codebase-architecture` +51 tokens. Generated GitHub/Linear help, NotebookLM references, and Directus release guidance add no startup context unless a matching skill loads those references.

## 2026-08-15 delegated Z.AI alternative attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration was run. The full extension/tool inventory was not rerun.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,529 | 2,571 | +42 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 74 | 83 | +9 before catalog framing | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 1,721 | 1,894 | +173 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 2,111 | 2,433 | +322 | Loaded only before a delegate spawn |

The startup increase is limited to the compact Z.AI selection rule and the broader skill trigger. Exact GLM 5.3 spawn commands remain on demand.

## 2026-08-15 delegated supervisor attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration was run. The skill description and full extension/tool inventory did not change.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,571 | 2,587 | +16 | Always loaded through the context-file block |
| `delegated-pi-loop/SKILL.md` | 1,894 | 1,969 | +75 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 2,433 | 2,916 | +483 | Loaded only before a delegate spawn |

The only startup increase is the compact supervisor requirement in `agent/AGENTS.md`. The supervisor, tests, detailed commands, artifact contract, and failure guidance remain on demand.

## 2026-08-16 delegated role-effort attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration was run. The skill description, global instructions, and full extension/tool inventory did not change.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,587 | 2,587 | 0 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 1,969 | 1,985 | +16 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 2,916 | 3,102 | +186 | Loaded only before a delegate spawn |

There is no startup-context increase. The on-demand reference grows because finding verification now has a distinct Sol/medium spawn contract while final independent review retains Sol/high.

## 2026-08-16 delegated implementation-routing attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration was run. The skill description and full extension/tool inventory did not change.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,587 | 2,635 | +48 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 1,985 | 2,087 | +102 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 3,102 | 3,204 | +102 | Loaded only before a delegate spawn |

The startup increase records the default GLM route and strict Luna small-task gate. Detailed classification criteria and exact commands remain progressively disclosed.

## 2026-08-16 delegated activity-monitoring attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration was run. The skill description and full extension/tool inventory did not change.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,635 | 2,672 | +37 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 2,087 | 2,202 | +115 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 3,204 | 3,746 | +542 | Loaded only before a delegate spawn |

The startup increase is one compact private-monitoring rule. JSON event details, idle policy, terminal markers, and exact spawn arguments remain on demand.

## 2026-08-16 delegated provider-fallback attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,672 | 2,781 | +109 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 77 | -6 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 2,202 | 2,500 | +298 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 3,746 | 4,357 | +611 | Loaded only before a delegate spawn |

The startup change adds the compact fallback boundary and concurrent-review default while shortening the skill description. Exact route commands, paired gate rules, catalog checks, and failure handling remain progressively disclosed.

## 2026-08-16 delegated Z.AI role-alignment attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,781 | 2,802 | +21 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 77 | 77 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 2,500 | 2,608 | +108 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 4,357 | 4,485 | +128 | Loaded only before a delegate spawn |

The startup increase adds one compact rule that backend selection never changes role mutation limits. Detailed any-role Z.AI guidance and its generic supervised spawn contract remain progressively disclosed.

## 2026-08-16 delegated provider-credential guidance attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,802 | 2,802 | 0 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 77 | 77 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 2,608 | 2,648 | +40 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 4,485 | 4,555 | +70 | Loaded only before a delegate spawn |

There is no startup-context increase. Parent-environment and restart guidance remains progressively disclosed in the skill and spawn reference.

## 2026-08-16 delegated solution-investigation attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,802 | 2,877 | +75 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 77 | 83 | +6 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 2,648 | 3,256 | +608 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 4,555 | 5,537 | +982 | Loaded only before a delegate spawn |

The startup increase adds one compact conditional solution-investigation rule and a broader skill trigger. Detailed investigator commands, evidence contracts, orchestrator synthesis, and reviewer-separation rules remain progressively disclosed.

## 2026-08-16 delegated SeekAI role-routing attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,877 | 2,911 | +34 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 3,256 | 3,271 | +15 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 5,537 | 5,541 | +4 | Loaded only before a delegate spawn |

The startup increase records exact SeekAI defaults for the solution and review pairs plus the guarded small-task chain. Detailed supervised commands remain progressively disclosed.

## 2026-08-17 delegated terminal-cleanup attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,911 | 2,911 | 0 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 3,271 | 3,308 | +37 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 5,541 | 5,593 | +52 | Loaded only before a delegate spawn |

The update adds no startup or skill-catalog cost. Terminal cleanup rules remain progressively disclosed in the skill and spawn reference.

## 2026-08-19 delegated client-cancellation attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,911 | 2,911 | 0 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 3,308 | 3,308 | 0 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 5,593 | 5,615 | +22 | Loaded only before a delegate spawn |

The update adds no startup or skill-catalog cost. The exact gateway signals remain progressively disclosed in the spawn reference.

## 2026-08-19 delegated error-envelope attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,582 | 2,582 | 0 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 3,308 | 3,378 | +70 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 5,615 | 5,671 | +56 | Loaded only before a delegate spawn |

The update adds no startup or skill-catalog cost. The `agent/AGENTS.md` baseline reflects the later unrelated global-instruction refinement (2,582 measured locally); envelope-recognition rules remain progressively disclosed in the skill and spawn reference.

## 2026-08-19 single-line envelope refinement attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,582 | 2,582 | 0 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 3,378 | 3,383 | +5 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 5,671 | 5,677 | +6 | Loaded only before a delegate spawn |

The refinement adds no startup or skill-catalog cost. The single-line envelope rule remains progressively disclosed in the skill and spawn reference.

## 2026-08-19 delegated scanner-error attribution

This change was measured locally with `tiktoken` `o200k_base`; no paid provider calibration or full extension/tool inventory rerun was performed.

| Surface | Before | After | Delta | Startup behavior |
|---|---:|---:|---:|---|
| Raw `agent/AGENTS.md` | 2,582 | 2,582 | 0 | Always loaded through the context-file block |
| `delegated-pi-loop` description | 83 | 83 | 0 | Loaded in the skill catalog |
| `delegated-pi-loop/SKILL.md` | 3,383 | 3,383 | 0 | Loaded only when the skill is read |
| `references/prompt-contracts.md` | 5,677 | 5,693 | +16 | Loaded only before a delegate spawn |

The update adds no startup or skill-catalog cost. The scanner-error signatures remain progressively disclosed in the spawn reference.

## Provider-calibrated baseline probes

These real probes used fixed prompt `hi` and read the provider usage from `message_end` / session usage.

| Probe | Provider input | Provider output | Provider total | What this isolates |
|---|---:|---:|---:|---|
| Minimal: no tools, no context files, no skills, no prompt templates, no extensions | 380 | 11 | 391 | Base Pi/OpenAI-Codex request overhead for `hi` |
| Core tools only: `read,bash,edit,write`; no context files, skills, prompt templates, extensions | 1,044 | 11 | 1,055 | Minimal + core tool schemas/snippets/guidance |
| `AGENTS.md` only-ish: no tools, no skills, no prompt templates, no extensions | 2,054 | 14 | 2,068 | Minimal + global context file |
| Core tools + `AGENTS.md` + skills catalog; no extensions or prompt templates | 6,144 | 14 | 6,158 | Adds core tools and skill catalog |
| Full normal config | 14,704 | 14 | 14,718 | Current startup/first-turn real cost |

Useful deltas from those provider runs:

| Delta | Provider tokens | Interpretation |
|---|---:|---|
| `AGENTS.md` wrapper/content | ~1,674 | Matches local wrapped `AGENTS.md` count |
| Core tools over minimal | ~664 | Provider cost of core `read,bash,edit,write` surfaces |
| Skills catalog over `AGENTS.md` + core tools | ~3,426 | Matches local available-skills catalog count |
| Full extension stack over core tools + `AGENTS.md` + skills | ~8,560 | Extension/tool surfaces, especially dynamic browser tools |

## Runtime lifecycle that affects counting

A correct local reconstruction must include extension lifecycle effects:

1. Create a Pi runtime for the target cwd/model/settings.
2. Emit/observe `session_start` so dynamic tools are registered.
3. Emit/observe `before_agent_start` so per-turn prompt injections are applied.
4. Serialize active tools for the target provider.
5. Count local prompt/schema surfaces for attribution.
6. Calibrate total input against a real fixed provider run.

For this config, the missed `session_start` effect is large:

| Runtime point | Active tools | `browser_*` tools |
|---|---:|---:|
| Before `session_start` | 18 | 0 |
| After `session_start` in the 2026-07-01 calibration | 50 | 32 |
| Current inventory after the 2026-07-19 refresh | 54 | 36 |

## Historical local attribution after lifecycle hooks

The quantitative values below are the 2026-07-01 calibration and must not be treated as current 0.80.6 token totals. After `session_start` and `before_agent_start` for prompt `hi`:

| Local surface | `tiktoken` tokens | Notes |
|---|---:|---|
| Final visible system prompt | 9,322 | Includes base Pi prompt, tool snippets/guidelines, `AGENTS.md`, skill catalog, cwd/date, and browser connection note |
| Active provider tool schemas | 6,983 | 50 active tools serialized for OpenAI Responses/Codex tool format |
| Compact JSON request body | 16,854 | Local JSON-string estimate; overcounts provider input here |
| Provider-reported input | 14,704 | Authoritative input token count for the original full config + `hi`; not rerun after the 2026-07-09 skill-catalog-only update |

Do not sum local `tiktoken` prompt+schema counts as the provider total. They are attribution measurements, not billing counters.

## Final system prompt sections

| Section | Local `tiktoken` tokens |
|---|---:|
| System header/persona | 33 |
| Available tools one-line list | 718 |
| Other custom-tools note | 20 |
| Guidelines block | 2,989 |
| Pi documentation instructions | 271 |
| Project context block / `AGENTS.md` | 1,674 |
| Available skills catalog block | 3,569 |
| Current date + CWD | 21 |
| Browser Control before-agent-start note | 25 |
| **Final visible system prompt** | **9,322** |

## Historical direct local attribution by origin

This table attributes the 2026-07-01 directly visible prompt/schema text to the extension/package/core surface that supplies it. It excludes generic Pi prompt shell text and provider hidden framing.

| Origin | Skill catalog | Tool schemas | Tool list | Tool guidelines | Per-turn prompt injection | Direct local subtotal |
|---|---:|---:|---:|---:|---:|---:|
| npm package: `pi-browser-harness@0.6.0` | 118 | 3,678 | 391 | 1,952 | 25 | 6,164 |
| user/global skills | 3,378 | 0 | 0 | 0 | 0 | 3,378 |
| local extension: `codegraph` | 0 | 1,623 | 108 | 317 | 0 | 2,048 |
| Pi builtin/core tools | 0 | 624 | 48 | 126 | 0 | 798 |
| local extension: `context-mode` | 0 | 514 | 51 | 167 | 0 | 732 |
| local extension: `web-search` | 0 | 323 | 40 | 261 | 0 | 624 |
| npm package: `pi-blackhole@0.3.9` | 0 | 269 | 42 | 132 | 0 | 443 |

Loaded extensions/packages with no direct startup LLM-context tokens in this measurement:

- local extension: `footer`
- local extension: `fastlane` (slash command only)
- local extension: `theme-overrides`
- npm package: `@schultzp2020/pi-cursor@0.5.0` (provider/command)
- npm package: `pi-btw@0.4.1` (commands/UI; filters its own visible BTW messages out of model context)
- npm package: `pi-claude-bridge@0.5.0` (provider)

## Active tool schemas

Current structural inventory: 57 registered tools and 54 active tools, including 36 `browser_*` tools. Pi 0.80.10 registers seven built-ins but keeps only `read`, `bash`, `edit`, and `write` active; all 50 extension/package tools are active.

Current offline `tiktoken` attribution:

| Origin | Active tools | Schema tokens | Guideline tokens | Combined |
|---|---:|---:|---:|---:|
| `pi-browser-harness@0.8.3` | 36 | 4,457 | 2,551 | 7,008 |
| local `codegraph` | 8 | 1,647 | 414 | 2,061 |
| Pi built-ins | 4 | 600 | 129 | 729 |
| local `context-mode` | 3 | 511 | 239 | 750 |
| local `web-search` | 2 | 315 | 264 | 579 |
| `pi-blackhole@0.3.9` | 1 | 265 | 138 | 403 |
| **Total** | **54** | **7,795** | **3,735** | **11,530** |

The historical token table immediately below remains the 2026-07-01 measurement of 50 tools/32 browser tools and is retained only as a provider-calibrated attribution baseline.

| Origin | Tool-schema tokens |
|---|---:|
| npm package: `pi-browser-harness@0.6.0` | 3,678 |
| local extension: `codegraph` | 1,623 |
| Pi builtin/core tools | 624 |
| local extension: `context-mode` | 514 |
| local extension: `web-search` | 323 |
| npm package: `pi-blackhole@0.3.9` | 269 |
| **Total active tool schemas** | **6,983** |

### Non-browser active tools

`read`, `bash`, `edit`, `write`, `codegraph_explore`, `codegraph_search`, `codegraph_files`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_status`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `web_search`, `fetch_contents`, `recall`.

### Browser active tools

`browser_setup`, `browser_click`, `browser_type`, `browser_fill`, `browser_select_option`, `browser_focus`, `browser_press_key`, `browser_dispatch_key`, `browser_scroll`, `browser_page_info`, `browser_wait`, `browser_wait_for`, `browser_wait_for_load`, `browser_handle_dialog`, `browser_screenshot`, `browser_navigate`, `browser_open_urls`, `browser_go_back`, `browser_go_forward`, `browser_reload`, `browser_list_tabs`, `browser_current_tab`, `browser_switch_tab`, `browser_new_tab`, `browser_close_tab`, `browser_upload_file`, `browser_download`, `browser_print_to_pdf`, `browser_viewport_resize`, `browser_drag_and_drop`, `browser_http_get`, `browser_network_requests`, `browser_console`, `browser_snapshot`, `browser_execute_js`, `browser_run_script`.

## Context files / `AGENTS.md`

| Origin | Path | Wrapped tokens | Raw content tokens |
|---|---|---:|---:|
| Global context file | `/home/gc/.pi/agent/AGENTS.md` | 1,660 | 1,637 |
| Project-context wrapper/header overhead | `<project_context>` wrapper | 14 | — |
| **Project context block** | — | **1,674** | — |

## Skills

Startup includes only the XML skill catalog: name, description, and location. Full `SKILL.md` content is an on-demand cost after the agent reads a matching skill. Skill rows were refreshed on 2026-07-09 for the `directus-browser` install without rerunning provider calibration.

| Origin | Skill | Catalog entry | Description | Path | Full `SKILL.md` if loaded |
|---|---|---:|---:|---:|---:|
| user/global skills | `session-handoff` | 204 | 136 | 16 | 1,520 |
| user/global skills | `nlm-skill` | 165 | 116 | 17 | 1,155 |
| user/global skills | `crit-cli` | 151 | 103 | 16 | 2,013 |
| user/global skills | `directus-browser` | 143 | 96 | 16 | 1,165 |
| user/global skills | `figma-create-design-system-rules` | 133 | 63 | 21 | 1,892 |
| user/global skills | `figma-implement-design` | 128 | 76 | 19 | 2,785 |
| npm package: `pi-browser-harness@0.6.0` | `pi-browser-harness` | 118 | 60 | 24 | 927 |
| user/global skills | `firebase-data-connect` | 117 | 70 | 16 | 1,851 |
| user/global skills | `pp-posthog` | 115 | 67 | 17 | 830 |
| user/global skills | `improve-codebase-architecture` | 114 | 61 | 19 | 1,181 |
| user/global skills | `developing-genkit-go` | 106 | 54 | 19 | 1,223 |
| user/global skills | `developing-genkit-js` | 106 | 54 | 19 | 556 |
| user/global skills | `firebase-firestore` | 106 | 59 | 16 | 807 |
| user/global skills | `grill-with-docs` | 104 | 51 | 18 | 842 |
| user/global skills | `gh-cli` | 103 | 57 | 16 | 604 |
| user/global skills | `figma` | 102 | 56 | 16 | 802 |
| user/global skills | `linear-cli` | 101 | 55 | 16 | 1,142 |
| user/global skills | `mysql` | 101 | 58 | 14 | 849 |
| user/global skills | `crit` | 98 | 54 | 15 | 1,309 |
| user/global skills | `firebase-basics` | 98 | 51 | 16 | 573 |
| user/global skills | `developing-genkit-dart` | 95 | 41 | 20 | 895 |
| user/global skills | `developing-genkit-python` | 95 | 43 | 19 | 611 |
| user/global skills | `intent-layer` | 95 | 49 | 16 | 784 |
| user/global skills | `firebase-ai-logic-basics` | 94 | 41 | 19 | 518 |
| user/global skills | `firebase-hosting-basics` | 91 | 40 | 18 | 439 |
| user/global skills | `firebase-security-rules-auditor` | 87 | 33 | 20 | 847 |
| user/global skills | `skill-creator` | 85 | 36 | 17 | 4,026 |
| user/global skills | `firebase-auth-basics` | 78 | 29 | 17 | 475 |
| user/global skills | `firebase-app-hosting-basics` | 77 | 24 | 19 | 514 |
| user/global skills | `ty` | 75 | 31 | 15 | 416 |
| user/global skills | `ruff` | 72 | 28 | 15 | 473 |
| user/global skills | `uv` | 71 | 27 | 15 | 497 |
| user/global skills | `postgres` | 68 | 24 | 15 | 864 |
| **Skill entry subtotal** | — | **3,496** | — | — | — |
| Catalog wrapper/header overhead | — | **73** | — | — | — |
| **Available skills catalog block** | — | **3,569** | — | — | — |

## Prompt templates

Prompt templates are slash-command expansions. They are not in model context at startup; their full content is added to a user message only when invoked. Prompt rows were refreshed on 2026-07-10; the provider calibration above was not rerun.

| Origin | Prompt | Expanded content tokens | Command metadata tokens |
|---|---|---:|---:|
| user/global prompt templates | `/ts-split-scope` | 3,421 | 57 |
| user/global prompt templates | `/ts-split-module` | 1,805 | 55 |
| user/global prompt templates | `/codex-review` | 1,308 | 47 |
| user/global prompt templates | `/codegraph-upgrade` | 1,424 | 57 |

## Extension slash commands

Extension command metadata is available to command routing and UI, but is not included in the model prompt by default.

| Origin | Commands | Serialized command metadata tokens |
|---|---:|---:|
| npm package: `pi-btw@0.4.1` | 8 | 775 |
| npm package: `pi-blackhole@0.3.9` | 3 | 358 |
| npm package: `pi-browser-harness@0.6.0` | 2 | 181 |
| npm package: `@schultzp2020/pi-cursor@0.5.0` | 1 | 97 |
| local extension: `fastlane` | 1 | 70 |

## User prompts and session growth

- The calibration prompt `hi` is tiny locally, but the provider-reported full input was 14,704 because startup context dominates.
- User prompt cost is variable and is added per request.
- Conversation history, assistant messages, tool calls, and tool results are not startup config cost, but they are included in later provider calls until compaction or branching removes/summarizes them.
- Tool outputs are often the largest avoidable context growth source; prefer Context Mode tools for noisy diagnostics and large files.

## Optimization levers

1. **Browser harness tools:** largest local direct startup surface (~6.2k local attributed tokens). Consider disabling browser tools by default if browser automation is not needed in most sessions.
2. **Skill catalog:** 3,569 startup tokens. Slim descriptions or set `disable-model-invocation: true` for rarely used skills that should be explicit-only.
3. **CodeGraph:** ~2.0k local direct tokens. High value, but largest non-browser coding extension surface.
4. **`AGENTS.md`:** 1,674 provider/local tokens. Keep global instructions compact and move long detail into linked docs when possible.
5. **Prompt templates:** zero baseline, but `/ts-split-scope` adds ~3.4k tokens when invoked. Keep large templates intentional.

## Recompute protocol

Use both provider calibration and local attribution.

### Provider calibration

1. Start a fresh/no-session Pi run in the target cwd and model.
2. Send fixed prompt `hi`.
3. Read the first assistant `usage` from JSON output or the session JSONL.
4. Record `usage.input`, `usage.output`, `usage.cacheRead`, `usage.cacheWrite`, and `usage.totalTokens`.
5. Optional but useful: rerun controlled probes with resource flags (`--no-tools`, `--no-context-files`, `--no-skills`, `--no-extensions`) to isolate provider deltas.

### Local attribution

1. Instantiate a Pi runtime for this cwd with the SDK (`createAgentSessionServices` + `createAgentSessionFromServices`).
2. Emit/observe `session_start` so dynamic tools are registered.
3. Emit/observe `before_agent_start` for a fixed prompt so per-turn prompt injections are included.
4. Read final system prompt, active tools, skill catalog, prompt templates, and registered extension commands.
5. Convert active tools through the OpenAI Responses tool serializer (`convertResponsesTools`) to estimate provider tool-schema surface.
6. Count all strings/JSON with Python `tiktoken.get_encoding("o200k_base")`.
7. Update this document and `docs/CHANGELOG.md` when active tools, skill inventory/descriptions, prompt templates, global instructions, or package/extension resources change materially.
