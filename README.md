# Pi Agent Config

![License: TBD](https://img.shields.io/badge/license-TBD-lightgrey.svg)
![Agent Type: Pi](https://img.shields.io/badge/agent-Pi-blue.svg)
![Status: Active](https://img.shields.io/badge/status-active-brightgreen.svg)

Pi Agent Config captures the local Pi agent configuration, skill set, and maintenance rules that make future agent sessions consistent, safe, and token-efficient.

This repository acts as the agent's brain and safety layer. It defines the language agents should use, the startup rules they must load, the preflight checks they must run before every tool call, and the routing protocols that keep large outputs, shell commands, hosted services, and delegated work under control. The result is a reproducible `~/.pi` environment where agents can work across sessions without relearning local policy or risking unsafe mutations.

## Features

- **Mandatory preflight and safety rules**: Requires agents to check for destructive local actions, remote hosted-service mutations, secret exposure, unsafe script execution, and unclear Git operations before acting.
- **Centralized skill management**: Stores local skills in one place, documents how to install or update them, and preserves local invariants after syncing from upstream skill sources.
- **Context Watcher routing**: Routes read-only shell work, tests, logs, searches, Git history, large files, and data processing through token-efficient Context Mode and RTK workflows.
- **Delegates extension**: Supports isolated `reader` and `writer` child Pi processes with scoped permissions, no recursive delegation, and parent-owned validation.
- **Consistent operating language**: Defines shared terms such as Local Skill, Upstream Skill, Runtime Reference, Context Watcher, Reader Delegate, and Writer Delegate in `CONTEXT.md`.
- **Maintenance-first documentation**: Keeps update processes under `docs/skills/` so agents can refresh skills without losing safety gates, frontmatter conventions, or OpenAI compatibility metadata.

## Tech Stack

- **Pi Agent** for the agent runtime and local configuration model
- **Python tooling** with `uv`, `ruff`, and `ty`
- **GitHub CLI (`gh`)** for authenticated GitHub workflows
- **Context7** for current third-party library and API documentation
- **Markdown** for runtime rules, skill instructions, and maintenance docs

## Prerequisites

- A compatible Pi Agent environment.
- Git and SSH or HTTPS access to this repository.
- The target installation directory must be `~/.pi` because the rules, skills, and startup paths are written for that location.
- Optional but recommended tools used by the configuration: `uv`, `ruff`, `ty`, `gh`, Context7, Context Mode, and RTK.

## Installation

> This repository is intended to be checked out as `~/.pi`. If you already have a Pi configuration in that directory, back it up before cloning.

### Fresh install

```bash
git clone git@github.com:zer09/pi-config.git ~/.pi
cd ~/.pi
```

### Existing installation

```bash
mv ~/.pi ~/.pi.backup.$(date +%Y%m%d%H%M%S)
git clone git@github.com:zer09/pi-config.git ~/.pi
cd ~/.pi
```

After installation, start a new Pi agent session from the configured environment so the agent can load the local startup rules and skills.

## Usage

Agents govern their behavior by reading the repository's core rule and context files at startup:

- `agent/AGENTS.md` defines startup checks, safety policy, tool routing, formatting, Python tooling, delegates, and handoff rules.
- `CONTEXT.md` defines the shared domain language and relationships for the Pi Config, skill maintenance, Context Watcher, and delegates.
- `docs/skills/README.md` explains how agents should update or install skills while preserving local invariants.

You can prompt the agent with maintenance-focused requests that reference those contracts instead of repeating every rule manually.

Examples:

```text
Update all local skills. Start with docs/skills/README.md, apply local-skill-update-invariants.md, then use each relevant update-process doc. Preserve local invariants and validate everything before committing.
```

```text
Install the <skill-name> skill from <upstream repo/url>. Treat upstream as input, preserve local invariants, add agents/openai.yaml, add a maintenance pointer, document the update process in docs/skills, and validate all skills before committing.
```

For custom local skills, ask the agent to use `skill-creator`, keep `SKILL.md` compact, add `agents/openai.yaml`, and document future maintenance guidance under `docs/skills/`.

## Project Structure

```text
~/.pi/
|-- CONTEXT.md                 # Domain language and conceptual model for the Pi Config
|-- README.md                  # Project overview and setup guide
|-- agent/
|   |-- AGENTS.md              # Primary startup, safety, routing, and behavior rules
|   |-- rules/                 # Approach-specific rules such as analysis, coding, and agent work
|   `-- skills/                # Local Pi skills loaded by agents during task execution
`-- docs/
    `-- skills/                # Skill update processes, invariants, and maintenance guidance
```

## Maintenance Model

Skill updates are treated as controlled syncs, not blind replacements. Upstream sources are input, then local invariants are reapplied so the installed skill remains safe, compact, token-aware, and compatible with this Pi environment.

When changing this repository, prefer surgical updates that preserve the rule hierarchy:

1. Safety and correctness first.
2. Freedom to Disagree remains always active.
3. General rules in `agent/AGENTS.md`.
4. Approach-specific rules in `agent/rules/`.
5. Skill-specific runtime guidance in `agent/skills/`.

## License

License information has not been finalized. Update this section and the badge when a license is selected.
