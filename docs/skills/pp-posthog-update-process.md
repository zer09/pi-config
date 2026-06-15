# pp-posthog update process

Use this Skill Maintenance Doc for the local `pp-posthog` skill, which wraps the Printing Press PostHog CLI for Pi.

## Source of truth

- Upstream repo: `mvanhorn/printing-press-library`
- Runtime skill input: `cli-skills/pp-posthog/SKILL.md`
- CLI/docs input: `library/developer-tools/posthog/SKILL.md` and `library/developer-tools/posthog/README.md`
- Local installed skill: `agent/skills/pp-posthog/`

Treat upstream as input, not final truth. Local Pi safety gates, compactness, and installed-binary behavior win.

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Compare upstream `pp-posthog` skill and README against the installed binary:
   ```bash
   posthog-pp-cli --version
   posthog-pp-cli --help
   posthog-pp-cli api
   posthog-pp-cli doctor
   ```
5. Classify the skill. Current decision: `make it slim` because the skill is useful for exact PostHog CLI routing and safety gates, but upstream command catalogs and examples are too long for `SKILL.md`.
6. Keep `agent/skills/pp-posthog/SKILL.md` focused on:
   - binary/auth verification
   - hosted-service mutation gates
   - safe read workflow
   - cache hydration rules
   - reference navigation
7. Keep command examples and drift notes in `agent/skills/pp-posthog/references/commands.md`.
8. Normalize `SKILL.md` frontmatter to only `name` and `description`.
9. Preserve `agents/openai.yaml`; regenerate only if the description or UI prompt becomes stale.
10. Update `docs/skills/installed-skills-trim-verdict.md` if classification or install status changes.
11. Validate the skill and all Local Skills.

## Local safety overlays

- PostHog is a hosted service: default to read-only.
- Remote writes require explicit user instruction for the exact create/update/delete/import/bulk action.
- Do not print secrets, OAuth headers, PostHog personal keys, config files, team `api_token`, cookies, or full `users retrieve @me` responses.
- Use `--agent` for read-only commands, but avoid casual `--agent` on destructive commands because it includes `--yes`.
- Treat `posthog-pp-cli sync` as local cache hydration: run when requested, summarize `sync_summary`, and do not dump large JSONL output.
- Trust the installed binary's `--help` over generated README examples when they disagree.

## Validation

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/pp-posthog
for skill_dir in agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also verify all Local Skills have `agents/openai.yaml`, no changed markdown contains literal home paths or secret-looking values, and local markdown links resolve.
