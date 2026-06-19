# pi-config

Configuration and reusable resources for [Pi](https://pi.dev), the minimal terminal coding harness.

Pi is designed to stay small at the core and be adapted through project settings, TypeScript extensions, Agent Skills, prompt templates, themes, and Pi packages. This repository is a place to version those customizations so a preferred Pi environment can be reused across projects and machines.

> This is **not** Raspberry Pi configuration. It is configuration for the Pi coding agent harness.

## What belongs here

Use this repo for project-level Pi resources such as:

- `.pi/settings.json` — project settings that override global Pi settings
- `.pi/extensions/` — TypeScript extensions loaded after the project is trusted
- `.pi/skills/` — Agent Skills loaded on demand by the model
- `.pi/prompts/` — reusable slash-command prompt templates
- `.pi/themes/` — custom TUI themes
- `AGENTS.md` — project instructions loaded by Pi at startup
- `SYSTEM.md` — optional per-project system prompt replacement or append
- docs and notes for workflows that should be easy to reproduce

## Suggested layout

```text
.
├── .pi/
│   ├── settings.json
│   ├── extensions/
│   │   └── example.ts
│   ├── skills/
│   │   └── example-skill/
│   │       └── SKILL.md
│   ├── prompts/
│   │   └── review.md
│   └── themes/
│       └── custom.json
├── AGENTS.md
├── SYSTEM.md
└── README.md
```

The repository can start with only this README. Add `.pi` resources as you create real settings, extensions, skills, prompts, or themes.

## Install Pi

Install the Pi CLI with npm:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Or use the Linux/macOS installer:

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

Then run Pi from a project directory:

```bash
pi
```

Authenticate with `/login` for subscription providers, or set provider API keys in your shell environment before starting Pi.

## Project settings

Pi uses JSON settings files. Global settings live in `~/.pi/agent/settings.json`; project settings live in `.pi/settings.json` and override global values.

Example `.pi/settings.json`:

```json
{
  "defaultProvider": "anthropic",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "enableSkillCommands": true,
  "packages": []
}
```

Keep personal tokens, API keys, OAuth credentials, and machine-specific paths out of committed settings. Prefer environment variables or private global settings for secrets.

## Skills

Skills are self-contained capability packages. A typical project skill looks like this:

```text
.pi/skills/code-review/
├── SKILL.md
├── scripts/
└── references/
```

Minimal `SKILL.md`:

```markdown
---
name: code-review
description: Review code changes for correctness, security, and maintainability.
---

# Code Review

Review the current changes. Focus on bugs, edge cases, security issues, and tests.
```

When skill commands are enabled, a skill can also be invoked with `/skill:code-review`.

## Prompt templates

Prompt templates are Markdown snippets that expand from slash commands. For example, `.pi/prompts/review.md` becomes `/review`:

```markdown
---
description: Review staged git changes
argument-hint: "[focus area]"
---

Review the staged changes with `git diff --cached`.
Focus on $ARGUMENTS.
```

## Extensions

Extensions are TypeScript modules that can register tools, commands, shortcuts, providers, event handlers, and custom TUI behavior.

Project-local extensions can live in `.pi/extensions/`:

```text
.pi/extensions/
└── my-extension.ts
```

After editing project extensions, use `/reload` in Pi to reload trusted project resources.

## Themes

Custom themes are JSON files in `.pi/themes/`. Select a theme by name in `.pi/settings.json`:

```json
{
  "theme": "custom"
}
```

## Pi packages

Pi packages bundle extensions, skills, prompt templates, and themes so they can be shared through npm, git, or local paths.

Install a package globally:

```bash
pi install npm:some-pi-package
```

Install a package into this project's `.pi/settings.json`:

```bash
pi install -l npm:some-pi-package
```

List and update configured packages:

```bash
pi list
pi update --extensions
```

Pi 0.79.7 and newer changed update defaults: bare `pi update` updates the Pi CLI only. Use `pi update --extensions` for configured packages, or `pi update --all` when you intentionally want both the CLI and configured packages updated.

Review third-party packages before installing them. Extensions execute code with your system permissions, and skills can instruct the agent to run commands.

## Useful Pi commands

```bash
pi                         # start interactive TUI
pi -p "summarize this repo" # print mode for scripts
pi --mode json -p "task"    # JSON event stream mode
pi install -l npm:pkg       # add a package to project settings
pi update                   # update Pi CLI only
pi update --extensions      # update configured packages/extensions only
pi update --all             # update Pi CLI and configured packages/extensions
```

Inside the TUI, useful commands include:

```text
/login      authenticate providers
/settings   edit common settings
/model      switch models
/tree       navigate session history
/reload     reload project resources
/trust      save a project trust decision
```

## Security notes

Do not commit:

- API keys or OAuth tokens
- `.env` files with real credentials
- private SSH keys
- provider-specific auth files
- local package caches such as `.pi/npm/` or `.pi/git/`
- session logs that may contain secrets

Project resources are loaded only after the project is trusted. Review `.pi/settings.json`, extensions, skills, and packages before trusting a project folder.

## References

- Pi: https://pi.dev
- Documentation: https://pi.dev/docs/latest
- Package catalog: https://pi.dev/packages
