# Config context cost

Date: 2026-07-01  
CWD measured: `/home/gc/.pi`  
Pi version: `0.80.2`  
Model context measured against: `openai-codex/gpt-5.5`  
Tokenizer used locally: Python `tiktoken` `o200k_base`

This document tracks the model-context cost of this Pi configuration at harness startup / first request. It separates always-on startup context from on-demand context such as expanded prompt templates and full skill files.

## Scope and caveats

- Counts were reconstructed locally from Pi's runtime system-prompt inputs and active tool definitions via the Pi SDK. No provider request was made for this snapshot.
- Counts reflect the working tree at measurement time, including any existing uncommitted config changes.
- Provider-reported usage is authoritative for billing/context accounting. Local `tiktoken` counts are best treated as stable relative measurements.
- Provider/API message framing, hidden tool framing, cache metadata, and model-specific serialization are not included in the local subtotal.
- Token counts are not always additive because BPE token boundaries change when sections are joined.
- Prompt templates, slash command metadata, full `SKILL.md` files, tool results, and prior session history are **not** startup model context unless they are invoked/read/sent in a later turn.

## First-request baseline estimate

| Surface | Tokens | Startup model context? | Notes |
|---|---:|---|---|
| Visible Pi system prompt | 6,785 | Yes | Includes Pi base instructions, tool snippets/guidelines, `AGENTS.md`, skill catalog, date, cwd |
| OpenAI tool schemas JSON | 3,353 | Yes | 18 active Pi tools serialized as provider tool/function definitions |
| Current user prompt example | 86 | Per request | Token count for the request that asked for this document |
| **Local reconstructed first-request subtotal** | **10,224** | Approx | `6,785 + 3,353 + 86`, before provider/API hidden framing |
| Prompt templates | 0 | No | Full template text is added only when `/template` is invoked |
| Full skill files | 0 | No | Only skill catalog entries are present at startup; full `SKILL.md` is loaded on demand with `read` |
| Extension command metadata | 0 | No | Available to Pi/TUI command routing, not included in the model prompt by default |
| Session history / tool results | 0 in a new session | Grows later | Conversation history and tool outputs usually dominate long sessions |

## Category map

| Category | Tokens | Included at startup? | Breakdown below |
|---|---:|---|---|
| Pi system prompt shell / static instructions | ~1,685 | Yes | [System prompt sections](#system-prompt-sections) |
| Context files / `AGENTS.md` | 1,674 | Yes | [Context files](#context-files--agentsmd) |
| Available skills catalog | 3,426 | Yes | [Skills](#skills) |
| Active tool schemas | 3,353 | Yes | [Tools](#tools) |
| User prompt | 86 in this example | Per request | [User prompts and session growth](#user-prompts-and-session-growth) |
| Prompt templates | 0 baseline; 1,805-3,421 if invoked | On demand | [Prompt templates](#prompt-templates) |
| Extension slash commands | 0 baseline | No | [Extension slash commands](#extension-slash-commands) |
| Full skill files | 0 baseline; 416-4,026 if loaded | On demand | [Skills](#skills) |

## System prompt sections

| Section | Tokens |
|---|---:|
| System header/persona | 33 |
| Available tools one-line list | 303 |
| Other custom-tools note | 20 |
| Guidelines block | 1,036 |
| Pi documentation instructions | 271 |
| Project context block | 1,674 |
| Available skills catalog block | 3,426 |
| Current date + CWD | 21 |
| **Full visible system prompt** | **6,785** |

## Context files / `AGENTS.md`

| Origin | Path | Wrapped tokens | Raw content tokens |
|---|---|---:|---:|
| Global context file | `/home/gc/.pi/agent/AGENTS.md` | 1,660 | 1,637 |
| Project-context wrapper/header overhead | `<project_context>` wrapper | 14 | — |
| **Project context block** | — | **1,674** | — |

## Tools

At startup, tool cost has two surfaces:

1. Visible system prompt snippets/guidelines.
2. Provider tool/function schemas.

### Direct static attribution by origin

This table attributes direct prompt/schema costs to the extension/package/core surface that supplies them. It intentionally excludes generic Pi prompt shell text, provider hidden framing, and slash-command metadata.

| Origin | Skill catalog | Tool schemas | Tool list | Tool guidelines | Direct static subtotal |
|---|---:|---:|---:|---:|---:|
| user/global skills | 3,235 | 0 | 0 | 0 | 3,235 |
| local extension: `codegraph` | 0 | 1,623 | 108 | 317 | 2,048 |
| Pi builtin/core tools | 0 | 624 | 48 | 126 | 798 |
| local extension: `context-mode` | 0 | 514 | 51 | 167 | 732 |
| local extension: `web-search` | 0 | 323 | 40 | 261 | 624 |
| npm package: `pi-blackhole@0.3.9` | 0 | 269 | 42 | 132 | 443 |
| npm package: `pi-browser-harness@0.6.0` | 118 | 0 | 0 | 0 | 118 |

Loaded extensions/packages with no direct startup LLM-context tokens in this measurement:

- local extension: `footer`
- local extension: `fastlane` (slash command only)
- local extension: `theme-overrides`
- local extension: `rtk`
- npm package: `@schultzp2020/pi-cursor@0.5.0` (provider/command)
- npm package: `pi-btw@0.4.1` (commands/UI)
- npm package: `pi-claude-bridge@0.5.0` (provider)

### Active tool schemas

| Origin | Tool | Schema tokens |
|---|---|---:|
| local extension: `codegraph` | `codegraph_files` | 401 |
| npm package: `pi-blackhole@0.3.9` | `recall` | 269 |
| Pi builtin/core | `edit` | 256 |
| local extension: `codegraph` | `codegraph_node` | 222 |
| local extension: `codegraph` | `codegraph_search` | 206 |
| local extension: `web-search` | `web_search` | 204 |
| local extension: `codegraph` | `codegraph_impact` | 199 |
| local extension: `context-mode` | `ctx_batch_execute` | 199 |
| local extension: `context-mode` | `ctx_execute_file` | 180 |
| local extension: `codegraph` | `codegraph_explore` | 175 |
| local extension: `codegraph` | `codegraph_callees` | 166 |
| local extension: `codegraph` | `codegraph_callers` | 165 |
| Pi builtin/core | `read` | 158 |
| local extension: `context-mode` | `ctx_search` | 135 |
| local extension: `web-search` | `fetch_contents` | 119 |
| Pi builtin/core | `bash` | 118 |
| Pi builtin/core | `write` | 92 |
| local extension: `codegraph` | `codegraph_status` | 89 |
| **Total active tool schemas** | — | **3,353** |

Active Pi tools in this snapshot:

`read`, `bash`, `edit`, `write`, `codegraph_explore`, `codegraph_search`, `codegraph_files`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_status`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `web_search`, `fetch_contents`, `recall`.

Note: `pi-browser-harness` contributes a skill catalog entry and browser-related commands, but no active Pi tool schemas in this SDK reconstruction.

## Skills

Startup includes only the XML skill catalog: name, description, and location. Full `SKILL.md` content is an on-demand cost after the agent reads a matching skill.

| Origin | Skill | Catalog entry | Description | Path | Full `SKILL.md` if loaded |
|---|---|---:|---:|---:|---:|
| user/global skills | `session-handoff` | 204 | 136 | 16 | 1,520 |
| user/global skills | `nlm-skill` | 165 | 116 | 17 | 1,155 |
| user/global skills | `crit-cli` | 151 | 103 | 16 | 2,013 |
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
| **Skill entry subtotal** | — | **3,353** | — | — | — |
| Catalog wrapper/header overhead | — | **73** | — | — | — |
| **Available skills catalog block** | — | **3,426** | — | — | — |

## Prompt templates

Prompt templates are slash-command expansions. They are not in model context at startup; their full content is added to a user message only when invoked.

| Origin | Prompt | Expanded content tokens | Command metadata tokens |
|---|---|---:|---:|
| user/global prompt templates | `/ts-split-scope` | 3,421 | 57 |
| user/global prompt templates | `/ts-split-module` | 1,805 | 55 |

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

- The user prompt that requested this document is **86 tokens** with `o200k_base`.
- User prompt cost is variable and is added per request.
- Conversation history, assistant messages, tool calls, and tool results are not startup config cost, but they are included in later provider calls until compaction or branching removes/summarizes them.
- Tool outputs are often the largest avoidable context growth source; prefer Context Mode tools for noisy diagnostics and large files.

## Optimization levers

1. **Skill catalog:** 3,426 startup tokens. Slim descriptions or set `disable-model-invocation: true` for rarely used skills that should be explicit-only.
2. **CodeGraph:** 2,048 directly attributable static tokens, mostly tool schemas. High value, but it is the largest extension-owned startup surface.
3. **`AGENTS.md`:** 1,674 startup tokens. Keep global instructions compact and move long detail into linked docs when possible.
4. **Prompt templates:** zero baseline, but `/ts-split-scope` adds ~3.4k tokens when invoked. Keep large templates intentional.
5. **Tool guidelines:** `context-mode` and `web-search` are useful but add visible prompt guidance. Recheck after extension changes.

## Recompute protocol

1. Instantiate a Pi runtime for this cwd with the SDK (`createAgentSessionServices` + `createAgentSessionFromServices`) and no provider request.
2. Read `session.systemPrompt`, `session.getActiveToolNames()`, `session.getAllTools()`, `session.promptTemplates`, and registered extension commands.
3. Convert active tools through the OpenAI Responses tool serializer (`convertResponsesTools`) to estimate provider tool-schema cost.
4. Count all strings/JSON with Python `tiktoken.get_encoding("o200k_base")`.
5. Update this document and `docs/CHANGELOG.md` when the active config changes materially.
