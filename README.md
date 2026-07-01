# pi-config

Personal Pi configuration for the Pi coding agent harness from [pi.dev](https://pi.dev).

This repository is a versioned snapshot of my global Pi agent setup. It tracks the configuration, local extensions, skills, prompts, themes, maintenance notes, and local patch records that make up my preferred Pi environment.

> This is **not** Raspberry Pi configuration. It is configuration for the Pi coding agent harness.

## What this repo contains

The tracked config root is `agent/`, which maps to the local Pi agent config directory.

| Path                  | Purpose                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `agent/settings.json` | Main Pi settings: configured packages, enabled models, default provider/model, thinking level, theme, and transport. |
| `agent/AGENTS.md`     | Global agent instructions, communication preferences, safety defaults, and tool-routing rules.                       |
| `agent/extensions/`   | Local TypeScript Pi extensions.                                                                                      |
| `agent/skills/`       | Local runtime skills, references, scripts, and agent metadata.                                                       |
| `agent/prompts/`      | Slash-command prompt templates.                                                                                      |
| `agent/themes/`       | Custom `dark` and `light` Pi themes.                                                                                 |
| `agent/pi-blackhole/` | pi-blackhole config, local patch notes, and patch reapply helpers.                                                   |
| `docs/`               | Config changelog, upgrade notes, ADRs, and skill maintenance docs.                                                   |
| `.gitignore`          | Boundary between tracked config and local-only runtime state, caches, secrets, and generated data.                   |

## Current settings snapshot

`agent/settings.json` is the main tracked settings file.

Current defaults:

| Setting                | Value              |
| ---------------------- | ------------------ |
| Default provider       | `openai-codex`     |
| Default model          | `gpt-5.5`          |
| Default thinking level | `xhigh`            |
| Theme                  | `dark`             |
| Transport              | `websocket-cached` |

Enabled models:

- `openai-codex/gpt-5.5`
- `opencode-go/deepseek-v4-pro`
- `cursor/default`
- `claude-bridge/claude-opus-4-6`

Configured packages:

- `npm:@schultzp2020/pi-cursor@0.5.0`
- `npm:pi-blackhole@0.3.9`
- `npm:pi-btw@0.4.1`
- `npm:pi-browser-harness@0.6.0`
- `npm:pi-claude-bridge@0.5.0`

Keep this section in sync whenever `agent/settings.json` changes.

## Context-cost accounting

The current startup/first-request context-cost snapshot lives in:

```text
docs/config-context-cost.md
```

It breaks down Pi system prompt, `AGENTS.md`, skill catalog, active tool schemas, prompt templates, extension commands, user prompt examples, and on-demand skill loads using local `tiktoken` `o200k_base` counts.

Update it after meaningful changes to active tools, skill inventory/descriptions, prompt templates, global instructions, or package/extension resources.

## Global agent instructions

`agent/AGENTS.md` is the global behavior contract for sessions.

It defines:

- concise, direct communication preferences
- read-only mode as the default for analysis/review/investigation tasks
- guarded change mode for edits, commits, pushes, hosted-service mutations, and other persistent changes
- Git/version-control rules
- preferred file-reading and file-editing behavior
- Python tooling defaults around `uv`, `ruff`, and `ty`
- tool routing for CodeGraph, Context Mode, GitHub CLI, direct shell, and native file tools

Project-local `AGENTS.md` or `CLAUDE.md` files may add more specific instructions. The most specific applicable instruction wins.

## Local extensions

Local extensions live under `agent/extensions/`.

| Extension          | Purpose                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codegraph/`       | Native Pi CodeGraph tools for source exploration, symbol lookup, callers/callees, impact analysis, indexed file discovery, and graph status.          |
| `context-mode/`    | Lean wrapper around upstream `context-mode`, exposing only `ctx_execute_file`, `ctx_batch_execute`, and `ctx_search` for large-output workflows.      |
| `web-search/`      | Local Gemini + Exa grounded search extension exposing `web_search` and `fetch_contents`.                                                              |
| `footer/`          | Custom compact Pi TUI footer with git state, cwd, extension status, prompt timer, token/context usage, model, thinking glyph, and Fastlane indicator. |
| `fastlane/`        | Session toggle for eligible Codex Fast mode via `/fastlane`; publishes active state consumed by `footer`.                                             |
| `theme-overrides/` | Auto-switches between local `dark` and `light` themes based on host system appearance.                                                                |
| `rtk.ts`           | Rewrites eligible bash commands through `rtk rewrite` for token savings; fails open when `rtk` is missing or unsupported.                             |

Extension-specific docs live inside the extension directories where available. After editing a local extension, run its local checks and reload/restart Pi.

## Themes

Custom themes live in:

```text
agent/themes/dark.json
agent/themes/light.json
```

The `theme-overrides` extension expects these themes to exist and switches between them when the host OS appearance changes.

`agent/settings.json` should keep a normal startup/default theme value. Runtime theme switching is handled in memory by the extension and should not require writing settings during a session.

## Prompt templates

Prompt templates live under `agent/prompts/`.

Current tracked prompts include:

| Prompt               | Purpose                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts-split-module.md` | Split a single monolithic TypeScript file into a documented multi-file module while preserving behavior and public API.                              |
| `ts-split-scope.md`  | Split and simplify a broader TypeScript scope, such as a package, directory tree, or project area, with staged analysis, planning, and verification. |

Prompt templates should be config-specific workflows that encode my preferred agent behavior. Avoid adding generic prompts that duplicate normal model capability.

## Local skills

Local skills live under `agent/skills/`.

This repo tracks skills as regular files. Runtime caches and project-local skill install targets are ignored, but `agent/skills/*` is intentionally tracked.

Important skill groups include:

- GitHub, Linear, PostHog, Context7, and NotebookLM CLI workflows
- Firebase, Firestore, Firebase Auth, Firebase Hosting, Firebase App Hosting, Firebase Data Connect, and Genkit guidance
- Python tooling skills for `uv`, `ruff`, and `ty`
- database skills for Postgres and MySQL
- Figma and OpenAI-derived skills
- session handoff and local continuity workflows
- skill creation and maintenance workflows

The canonical skill inventory and keep/slim/remove decisions live in:

```text
docs/skills/installed-skills-trim-verdict.md
```

## Skill maintenance policy

Before updating or installing skills, read:

```text
docs/skills/README.md
docs/skills/local-skill-update-invariants.md
docs/skills/skill-slimming-process.md
```

Then read the relevant `docs/skills/*-update-process.md` file.

Local policy:

1. Classify each skill as `keep it`, `make it slim`, or `remove it`.
2. Keep runtime `SKILL.md` files compact.
3. Move long examples, command catalogs, troubleshooting, and API details into `references/` or `docs/skills/`.
4. Preserve local safety gates, exact CLI/MCP workflows, hosted-service mutation guards, and project-specific conventions.
5. Add or update `agents/openai.yaml` when installing local skills.
6. Update the installed-skill inventory when the active skill set changes.
7. Validate skills before committing.

Do not restore retired skills unless the workflow is explicitly needed again.

## pi-blackhole config and local patches

pi-blackhole config lives in:

```text
agent/pi-blackhole/pi-blackhole-config.json
```

This config is tuned for the current daily-driver session model and local observer/reflector/dropper model setup.

Local package patches are documented in:

```text
agent/pi-blackhole/LOCAL_PATCHES.md
```

Patch notes currently cover:

- `compactAfterPercent` for auto-compaction thresholds
- OM worker auth fallback for environment-backed providers

Package upgrades or reinstalls can overwrite patched files under the local Pi npm package cache. After upgrading pi-blackhole, review `LOCAL_PATCHES.md` and reapply or port patches as needed.

## Changelog and decisions

Use these docs to understand why the config looks the way it does:

| Path                | Purpose                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `docs/CHANGELOG.md` | Human-readable timeline of local Pi config changes.                                |
| `docs/changelogs/`  | Detailed upgrade notes for specific Pi/package transitions.                        |
| `docs/adr/`         | Architecture decision records for long-lived config choices.                       |
| `docs/skills/`      | Skill inventory, maintenance workflows, update processes, and retired-skill notes. |

Update `docs/CHANGELOG.md` for meaningful config changes, especially extension updates, package changes, skill inventory changes, and local patch changes.

## What should not be committed

The repo intentionally ignores local runtime state, caches, generated data, auth files, and secrets.

Do not commit:

- `agent/auth.json`
- OAuth/cache files under `agent/mcp-oauth/`
- session and delegate-session logs
- local npm/package caches
- `.env` files
- private keys and certificates
- `.codegraph/` indexes
- temporary data, scratch files, logs, notes, and plans
- local agent install/cache directories such as `.agents/`, `.claude/`, `.codex`-style tool state, or generated skill lock files

`agent/settings.json` is intentionally tracked. Keep secrets and machine-private tokens out of it.

## Maintenance checklist

When changing this config:

1. Identify the config surface being changed: settings, instructions, extension, skill, prompt, theme, pi-blackhole, docs, or ignore rules.
2. Keep changes narrow and config-related.
3. Update the nearest local README or maintenance doc when behavior changes.
4. Update `docs/CHANGELOG.md` for meaningful changes.
5. For skill changes, follow `docs/skills/README.md`.
6. For pi-blackhole upgrades, review `agent/pi-blackhole/LOCAL_PATCHES.md`.
7. For extension changes, run the extension’s local checks when available.
8. Verify no runtime state, cache, auth file, or secret was added to git.

## README scope

This README documents this repository’s Pi configuration.

It should not duplicate general Pi documentation such as:

- how to install Pi
- generic Pi CLI commands
- generic package-management commands
- general skill/theme/extension tutorials
- public Pi documentation links unless they explain a local config choice

Those topics belong in Pi’s own docs, not in this config repo.
