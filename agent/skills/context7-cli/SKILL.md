---
name: context7-cli
description: Use the ctx7 CLI to fetch library documentation, manage AI coding skills, and configure Context7 MCP. Activate when the user mentions "ctx7" or "context7", needs current docs for any library, wants to install/search/generate skills, or needs to set up Context7 for their AI coding agent.
---

# ctx7 CLI

Use `ctx7` for current library docs, Context7 skill management, and MCP setup. Prefer the installed CLI. Do not install or upgrade global packages unless the user explicitly asks.

## Safety and routing

- Read-only docs lookup is allowed. Use Context Mode when docs output may exceed 20 lines, especially `ctx7 docs --json`.
- Skill discovery commands are read-only only when used as preview with no interactive selection or install target. `ctx7 skills search` can install from its interactive list, and `ctx7 skills suggest` can install suggested skills; treat accepting any prompt/selection or passing install-target flags as an explicit local mutation.
- `ctx7 login`, `ctx7 logout`, `ctx7 setup`, `ctx7 remove`, `ctx7 upgrade -y`, `ctx7 skills install`, `ctx7 skills remove`, and `ctx7 skills generate` change local config, auth state, installed skills, packages, or remote state. Run them only when the user explicitly requests that exact action.
- Never print or commit API keys, OAuth tokens, cookies, or generated config secrets. Refer to `CONTEXT7_API_KEY` by name or use `<api-key>` placeholders.
- Verify exact flags with `ctx7 <command> --help`; local CLI behavior may be newer than the skill references.

## Reference navigation

- [Documentation](references/docs.md) - resolving library IDs and fetching current docs.
- [Skills management](references/skills.md) - searching, installing, listing, removing, suggesting, and generating skills.
- [Setup](references/setup.md) - configuring or removing Context7 MCP for supported agents/editors.

## Common workflows

Documentation lookup is two-step: resolve a library ID, then query docs.

```bash
ctx7 library <name> "<topic>"
ctx7 docs /owner/project "<question>"
ctx7 docs /owner/project "<question>" --json
```

Skill discovery is preview-only unless the user explicitly requested an install or target change. Do not select items from interactive search results or accept suggested installs in read-only work:

```bash
ctx7 skills search <keywords>   # preview only; do not select/install
ctx7 skills list
ctx7 skills info /owner/repo
ctx7 skills suggest             # preview only; do not accept/install suggestions
```

Setup and auth commands mutate local state, so draft or run only with explicit instruction:

```bash
ctx7 whoami
ctx7 login --no-browser
ctx7 setup --help
ctx7 remove --help
ctx7 upgrade --check
```

## Gotchas

- Library IDs need the leading slash, for example `/facebook/react`.
- Run `ctx7 library` before `ctx7 docs`; plain names like `react` are not valid library IDs.
- Skill repositories use `/owner/repo` format.
- `skills generate` requires login and uses a remote AI workflow.
- `ctx7 setup` and `ctx7 remove` can target different agents and project/global scopes; confirm the target before running.

## Maintenance

Update this Local Skill using `../../../docs/skills/context7-cli-update-process.md`. Preserve the local invariants in `../../../docs/skills/local-skill-update-invariants.md`.
