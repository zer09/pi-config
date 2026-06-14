# Retired Chrome DevTools MCP skills

Status: retired during the old pasted-skills re-setup.

## Decision

The local Chrome DevTools MCP runtime skill group was removed because Pi already has native browser harness tools for page inspection, interaction, console/network diagnostics, screenshots, and downloads. Keep browser automation guidance in global/project instructions and use focused documentation lookup for Chrome DevTools MCP when needed.

Do not update or reinstall these skills unless the user explicitly asks for a dedicated `chrome-devtools-mcp` runtime workflow again.

## Former source of truth

- Upstream repository: `https://github.com/ChromeDevTools/chrome-devtools-mcp`
- Last upstream commit checked locally before retirement: `50cecd810b9362f6b3fd3806bcceaca0e2b9d1fb`

Former local skills:

- `agent/skills/a11y-debugging/`
- `agent/skills/chrome-devtools/`
- `agent/skills/chrome-devtools-cli/`
- `agent/skills/debug-optimize-lcp/`
- `agent/skills/memory-leak-debugging/`
- `agent/skills/troubleshooting/`

Former upstream paths:

- `skills/a11y-debugging/SKILL.md`
- `skills/chrome-devtools/SKILL.md`
- `skills/chrome-devtools-cli/SKILL.md`
- `skills/debug-optimize-lcp/SKILL.md`
- `skills/memory-leak-debugging/SKILL.md`
- `skills/troubleshooting/SKILL.md`

## Reinstall checklist

If reinstalling later:

1. Read `docs/skills/README.md`, `docs/skills/local-skill-update-invariants.md`, and `docs/skills/skill-slimming-process.md`.
2. Load `skill-creator` and `gh-cli`.
3. Fetch upstream runtime content from `chromedevtools/chrome-devtools-mcp` and compare it with Pi's native browser harness capabilities.
4. Classify each skill individually; reinstall only the specific workflow the user needs.
5. Preserve browser mutation gates: hosted-service writes through the browser require exact explicit user instruction.
6. Keep `SKILL.md` compact and limit frontmatter to `name` and `description`.
7. Add `agents/openai.yaml` with each `default_prompt` mentioning the skill name (for example `$chrome-devtools`).
8. Move long examples, command catalogs, LCP background, memory-leak theory, and troubleshooting matrices into `references/`.
9. Update `docs/skills/README.md` and `docs/skills/installed-skills-trim-verdict.md` if any skill is restored.
10. Validate restored skills with `uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py <skill-dir>`.
