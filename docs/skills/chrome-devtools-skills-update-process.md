# Updating Chrome DevTools skills

Purpose: keep Chrome DevTools MCP skills aligned with `chromedevtools/chrome-devtools-mcp` while preserving local MCP routing and OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/ChromeDevTools/chrome-devtools-mcp
- Current upstream commit checked locally: `9914134b0f74bfa05a182f62ee13b88aa3244344`

| Local skill | Upstream path |
| --- | --- |
| `a11y-debugging` | `skills/a11y-debugging/SKILL.md` |
| `chrome-devtools` | `skills/chrome-devtools/SKILL.md` |
| `chrome-devtools-cli` | `skills/chrome-devtools-cli/SKILL.md` |
| `debug-optimize-lcp` | `skills/debug-optimize-lcp/SKILL.md` |
| `memory-leak-debugging` | `skills/memory-leak-debugging/SKILL.md` |
| `troubleshooting` | `skills/troubleshooting/SKILL.md` |

## Local files

- `agent/skills/<skill>/SKILL.md`: runtime workflow.
- `agent/skills/<skill>/references/`: runtime references when present.
- `agent/skills/<skill>/agents/openai.yaml`: local UI metadata.

## Update workflow

1. Load `skill-creator`, `gh-cli`, and relevant Chrome DevTools skills, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/ChromeDevTools/chrome-devtools-mcp/contents/skills/chrome-devtools/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders, including references.
4. Copy upstream runtime changes unless they conflict with local Pi MCP routing, browser safety, or OpenAI skill-creator rules.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Keep browser automation instructions read-only unless the user explicitly authorizes a hosted-service mutation through the browser.
7. Regenerate or update `agents/openai.yaml` when a skill description changes.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate all Chrome DevTools skills:

```bash
for skill in a11y-debugging chrome-devtools chrome-devtools-cli debug-optimize-lcp memory-leak-debugging troubleshooting; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

10. Scan changed files for literal home paths and secret values before committing.
