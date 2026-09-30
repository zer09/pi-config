---
name: developing-genkit-js
description: "Implement or debug Genkit applications in Node.js/TypeScript, including agents, flows, tools, prompts, streaming, and providers. Use for Genkit JS SDK setup, code, validation issues, or API/type errors."
---

# Genkit JS

Use this skill for Genkit in Node.js and TypeScript. Genkit APIs change quickly: verify against local source, installed package versions, or the reference files before writing syntax-sensitive code.

## Safety and routing

- Treat Firebase, Google Cloud, and model-provider calls as hosted services. Local code edits, tests, and emulators are allowed; deploys, project changes, provider configuration, secret changes, and live API calls require exact user instruction.
- Never hardcode, print, save, or commit API keys, tokens, or service credentials. Refer to environment variables or `<api-key>`.
- Keep long logs, Genkit dev UI output, package trees, traces, generated schemas, and CLI help bounded; capture only relevant excerpts or save verbose output to temp files.
- Match the project package manager and existing dependency versions. Do not upgrade Genkit or providers unless the user asks.

## Workflow

1. Identify the installed Genkit version and runtime framework from `package.json`, lockfiles, and existing imports.
2. Read the smallest relevant reference before coding:
   - [setup](references/setup.md) for dependencies and initialization.
   - [examples](references/examples.md) for generation, schemas, streaming, and multimodal patterns.
   - [Dotprompt](references/dotprompt.md) for prompt files, named schemas, variants, and rendering.
   - [middleware](references/middleware.md) for `use`, named registration, and custom hooks.
   - [beta agents](references/agents.md) for multi-turn state; requires compatible `genkit/beta` APIs, not an automatic SDK upgrade.
   - [docs and cli](references/docs-and-cli.md) for `genkit` CLI usage and current docs lookup.
   - [common errors](references/common-errors.md) for validation, typing, imports, and runtime failures.
   - [best practices](references/best-practices.md) for production structure and safety.
3. Prefer local examples in the repo over generic snippets.
4. Validate changed code with available project tests or type checks. Prefer local/mock checks; do not install tooling or call a provider to satisfy validation. Report unavailable checks.
5. If a Firebase deployment or live model call is needed, stop and ask for the exact requested action unless it was already explicit.

## CLI selection

The Genkit CLI is optional. Use installed or repository-pinned tooling and verify exact commands in [docs and cli](references/docs-and-cli.md). `start` is persistent even with `--noui`; `flow:run` runs flows, not agents. Local UI startup or flow execution can still call a hosted provider. Do not upgrade/install the CLI as skill maintenance.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
