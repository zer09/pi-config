# Config context cost

Date: 2026-07-01

Skill-catalog-only update: 2026-07-09 (added `directus-browser`; provider calibration was not rerun)

CWD measured: `/home/gc/.pi`

Pi version: `0.80.2`

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
| After `session_start` | 50 | 32 |

## Local attribution after lifecycle hooks

After `session_start` and `before_agent_start` for prompt `hi`:

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

## Direct local attribution by origin

This table attributes directly visible prompt/schema text to the extension/package/core surface that supplies it. It excludes generic Pi prompt shell text and provider hidden framing.

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
- local extension: `rtk`
- npm package: `@schultzp2020/pi-cursor@0.5.0` (provider/command)
- npm package: `pi-btw@0.4.1` (commands/UI; filters its own visible BTW messages out of model context)
- npm package: `pi-claude-bridge@0.5.0` (provider)

## Active tool schemas

Active Pi tools in the full runtime: 50 total, including 32 `browser_*` tools.

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

`browser_setup`, `browser_click`, `browser_type`, `browser_press_key`, `browser_dispatch_key`, `browser_scroll`, `browser_page_info`, `browser_wait`, `browser_wait_for_load`, `browser_handle_dialog`, `browser_screenshot`, `browser_navigate`, `browser_open_urls`, `browser_go_back`, `browser_go_forward`, `browser_reload`, `browser_list_tabs`, `browser_current_tab`, `browser_switch_tab`, `browser_new_tab`, `browser_close_tab`, `browser_upload_file`, `browser_download`, `browser_print_to_pdf`, `browser_viewport_resize`, `browser_drag_and_drop`, `browser_http_get`, `browser_network_requests`, `browser_console`, `browser_snapshot`, `browser_execute_js`, `browser_run_script`.

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

Prompt templates are slash-command expansions. They are not in model context at startup; their full content is added to a user message only when invoked. Prompt rows were refreshed on 2026-07-04; the provider calibration above was not rerun.

| Origin | Prompt | Expanded content tokens | Command metadata tokens |
|---|---|---:|---:|
| user/global prompt templates | `/ts-split-scope` | 3,421 | 57 |
| user/global prompt templates | `/ts-split-module` | 1,805 | 55 |
| user/global prompt templates | `/codex-review` | 1,308 | 47 |
| user/global prompt templates | `/codegraph-upgrade` | 672 | 53 |

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
