# Updating Firebase skills

Purpose: keep Firebase-owned skills aligned with `firebase/skills` while preserving local Pi safety gates and OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/firebase/skills
- Current upstream commit checked locally: `02c0a6188912165e15338622e141d39ae401a14b`

| Local skill | Upstream path |
| --- | --- |
| `developing-genkit-dart` | `skills/developing-genkit-dart/SKILL.md` |
| `developing-genkit-go` | `skills/developing-genkit-go/SKILL.md` |
| `developing-genkit-js` | `skills/developing-genkit-js/SKILL.md` |
| `developing-genkit-python` | `skills/developing-genkit-python/SKILL.md` |
| `firebase-ai-logic-basics` | `skills/firebase-ai-logic-basics/SKILL.md` |
| `firebase-app-hosting-basics` | `skills/firebase-app-hosting-basics/SKILL.md` |
| `firebase-auth-basics` | `skills/firebase-auth-basics/SKILL.md` |
| `firebase-basics` | `skills/firebase-basics/SKILL.md` |
| `firebase-data-connect` | `skills/firebase-data-connect-basics/SKILL.md` |
| `firebase-firestore` | `skills/firebase-firestore/SKILL.md` |
| `firebase-hosting-basics` | `skills/firebase-hosting-basics/SKILL.md` |
| `firebase-security-rules-auditor` | `skills/firebase-security-rules-auditor/SKILL.md` |

## Local safety rule

Firebase and Google Cloud are external hosted services. Reads, local emulation, local validation, and local code generation are allowed. Deploys, project creation, database creation, data writes, rule publishing, hosting deploys, quota changes, service enablement, and other hosted mutations require explicit user instruction for the exact action.

## Update workflow

1. Load `skill-creator`, `gh-cli`, and the relevant Firebase skill before editing.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/firebase/skills/contents/skills/firebase-firestore/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders, including references, examples, templates, and scripts.
4. Copy upstream runtime changes unless they weaken local hosted-service mutation gates or conflict with OpenAI skill-creator rules.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Preserve local folder name `firebase-data-connect` even though upstream currently uses `firebase-data-connect-basics`.
7. Regenerate or update each `agents/openai.yaml` when a skill description changes.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate all Firebase skills:

```bash
for skill in developing-genkit-dart developing-genkit-go developing-genkit-js developing-genkit-python firebase-ai-logic-basics firebase-app-hosting-basics firebase-auth-basics firebase-basics firebase-data-connect firebase-firestore firebase-hosting-basics firebase-security-rules-auditor; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

10. Scan changed files for literal home paths and secret values before committing.
