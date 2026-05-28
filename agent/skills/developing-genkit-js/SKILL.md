---
name: developing-genkit-js
description: Develop AI-powered applications using Genkit in Node.js/TypeScript. Use when the user asks about Genkit, AI agents, flows, or tools in JavaScript/TypeScript, or when encountering Genkit errors, validation issues, type errors, or API problems.
---

# Genkit JS

Use this skill for Genkit in Node.js and TypeScript. Genkit APIs change quickly: verify against local source, installed package versions, or the reference files before writing syntax-sensitive code.

## Safety and routing

- Treat Firebase, Google Cloud, and model-provider calls as hosted services. Local code edits, tests, and emulators are allowed; deploys, project changes, provider configuration, secret changes, and live API calls require exact user instruction.
- Never hardcode API keys or service credentials. Refer to environment variables or placeholders such as `<api-key>`.
- Use Context Mode for long logs, Genkit dev UI output, package trees, traces, generated schemas, or CLI help.
- Match the project package manager and existing dependency versions. Do not upgrade Genkit or providers unless the user asks.

## Workflow

1. Identify the installed Genkit version and runtime framework from `package.json`, lockfiles, and existing imports.
2. Read the smallest relevant reference before coding:
   - [setup](references/setup.md) for dependencies and initialization.
   - [examples](references/examples.md) for flows, tools, prompts, and streaming patterns.
   - [docs and cli](references/docs-and-cli.md) for `genkit` CLI usage and current docs lookup.
   - [common errors](references/common-errors.md) for validation, typing, imports, and runtime failures.
   - [best practices](references/best-practices.md) for production structure and safety.
3. Prefer local examples in the repo over generic snippets.
4. Validate changed Genkit code with project tests, type checks, or focused CLI checks when available.
5. If a Firebase deployment or live model call is needed, stop and ask for the exact requested action unless it was already explicit.

## Fast command reminders

Verify exact commands with the project scripts or [docs and cli](references/docs-and-cli.md) first. Common commands include:

```bash
npx genkit --help
npx genkit start
npx genkit flow:run <flow-name>
```

For dependency or API uncertainty, inspect installed package docs or fetch current upstream docs before implementing.

## Maintenance

Update this Local Skill using `../../../docs/skills/firebase-skills-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
