# Updating Firebase skills

Purpose: keep Firebase-owned skills aligned with `firebase/skills` while preserving local Pi safety gates and OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply the [local invariants](local-skill-update-invariants.md), [slimming process](skill-slimming-process.md), and [ADR 0020](../adr/0020-gpt-6-astra-skill-maintenance-policy.md). Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility. A local policy-only revision does not imply upstream synchronization.

## Source of truth

- Upstream repository: https://github.com/firebase/skills
- Current upstream commit checked locally: `073edf7bb747c27b9c911a9126adaa5bc4648fdc`
- Installed Firebase CLI reviewed: `15.26.0`

The current upstream `firebase/skills` main branch no longer contains the `developing-genkit-*` skill paths that were recorded when these local skills were installed. Treat the local Genkit skills as retained local snapshots until a new upstream source is verified; do not delete or replace them solely because those paths are absent from `firebase/skills`.

| Local skill | Upstream path |
| --- | --- |
| `developing-genkit-dart` | retained local snapshot; path absent from current `firebase/skills` main |
| `developing-genkit-go` | retained local snapshot; path absent from current `firebase/skills` main |
| `developing-genkit-js` | retained local snapshot; path absent from current `firebase/skills` main |
| `developing-genkit-python` | retained local snapshot; path absent from current `firebase/skills` main |
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

## Durable local overlays

Reapply these overlays after any upstream comparison. Do not restore contradictory instructions in a reference after fixing the root.

### Routing boundaries and metadata

- Use concise intent-specific descriptions, without an arbitrary local character cap. Keep `agents/openai.yaml` aligned with the skill's actual scope, with one matching `$skill-name` in each default prompt and valid 25–64-character UI short descriptions. Preserve intentional dependencies.
- Scope Genkit setup, implementation, and errors by SDK language. A Python import failure does not activate the Go or Dart skill; generic AI work without Genkit is not sufficient.
- `firebase-basics` authentication means Firebase CLI login and project selection, not application user sign-in. Route application authentication to `firebase-auth-basics`.
- Activate `firebase-firestore` for Firestore implementation or database operations, not unconditionally for every Firestore mention. Route audit intent to the auditor.
- Activate `firebase-data-connect` for Firebase Data Connect / SQL Connect, not every relational database used alongside Firebase. Preserve the local folder name and current product rename terminology.
- Keep `firebase-security-rules-auditor` specific to Cloud Firestore Security Rules across the root, references, and UI metadata. Do not claim Cloud Storage audit coverage without a separately supported audit model.

### Firestore target selection and provisioning

Inspect existing config/code first. Read-only, code, rules, or modeling guidance need not perform live discovery when edition does not affect the answer; state assumptions. When target or edition materially affects provisioning, rules, indexes, or query behavior, identify the project, database, edition, and relevant access mode from configuration or read-only CLI metadata. Ask only if the material choice remains ambiguous. Native access mode alone does not identify the edition.

Preserve database listing/inspection and Standard/Enterprise reference routing. A missing database never authorizes creation. Database ID, edition, access mode, and location are separate explicit provisioning choices after an exact creation request; do not default-provision Enterprise. Keep legitimate creation commands in gated provisioning references. A rules/index deployment that could create a missing database needs separate exact creation authorization. Local completion must not require deployment, including deployment disguised as syntax validation.

Client SDK references must not require CLI initialization, backend provisioning, or service enablement for dependency or SDK setup. Regression check from the repository root: `! grep -nF -e 'firebase-tools@latest' -e 'init firestore' agent/skills/firebase-firestore/references/{standard,enterprise}/android_sdk_usage.md`.

### Data Connect local work and deployment

Keep the exact hosted-mutation gate visible before init, migration, deploy, or project-mutation commands. Reads and requested local edits, emulation, compilation, and SDK generation are allowed. Initialization may offer Cloud SQL provisioning or service enablement; stop before unrequested hosted changes. Login and active-project changes require the user's request or agreement.

Deployments, Cloud SQL migrations, data writes, Firebase project mutations, and breaking changes bypassed with `--force` require explicit user instruction for the exact action and target. Preserve SDK/server compatibility guidance without making redeployment automatic after local edits. Keep CLI details and YAML examples in the configuration reference; keep templates and SDK guides consistent with that gate.

Prefer generated GraphQL operations for schema/type safety. Permit Native SQL when a database feature requires it without demanding that the user name the technique. Preserve SQL parameter and identifier restrictions, operation authorization, and validation of generic result shapes.

### Selective references and Genkit root policy

Keep roots as compact, language-specific routers with shared safety gates, version/source verification, selected reference maps, and task-appropriate validation/completion. Assume a capable consuming model while preserving mixed-model compatibility. Remove unconditional itineraries, distrust-the-model framing, and rigid `always`/`must` wording unless a concrete API correctness or safety constraint justifies it.

Load only references needed for the task. Keep language-specific API guidance, Schemantic mapping, Go registry/middleware patterns, and Python entrypoint/streaming guidance. Move full Hello World examples, installation instructions, CLI catalogs, and generic tutorials into directly linked setup/getting-started references. Do not duplicate them in roots or require the Genkit CLI for every task. Validate affected code with available project checks; documentation-only Dart work does not require `dart analyze`.

Firebase/GCP mutations, provider or secret changes, and live model/API calls require exact user instruction. A local Dev UI or flow can still call hosted services. Use mocked/local validation where possible; report missing tooling rather than installing dependencies, calling a model, or provisioning services to make a check pass. Never print, save, or commit credentials or sensitive trace content.

### Genkit Python runtime evidence

The runtime floor is **Python 3.10+**, not 3.14+. [PyPI's `genkit` metadata](https://pypi.org/project/genkit/) reports `Requires-Python: >=3.10`; official Genkit documentation correction #4658 corrected the earlier 3.14+ guidance to 3.10+. Preserve this correction in the root and setup examples. Preserve a repository's pinned newer Python version and plugin constraints; the package floor does not authorize downgrading a project. Use the project's `uv` environment without unnecessary activation or system-interpreter installation.

### Firestore-only rules auditing

Preserve the concrete create/update, authority-source, intended-access, resource-limit, type, and ownership checklist and structured findings. Keep audits read-only; recommendations do not authorize rule changes, tests that write files, live bypass attempts, or deployment. Each rule modification or hosted action needs exact user instruction.

A hardcoded admin email is not a global exception. Accept it only after verifying the application's bootstrap requirements, verified-email and trusted-identity checks, and protections against self-assigned or escalated privileges. State missing context and audit limits instead of claiming exhaustive security. Do not restore generic role-play framing.

## Slimming policy

Keep runtime `SKILL.md` files concise. The body contains boundaries, safety, task selection, reference navigation, proportional checks/completion, and maintenance pointers. Keep setup, examples, command catalogs, and long API details in `references/`, `reference/`, `examples.md`, or `templates.md`.

The Dart, Go, Python, Data Connect, Firestore, and auditor roots are classified `make it slim` in the [trimming inventory](installed-skills-trim-verdict.md). Their niche API details remain in task-specific references. Already compact Firebase and Genkit JS roots do not need rewriting merely to match this shape; preserve their existing gates and classifications.

## Bounded reference regression checks

Run this read-only Python block from the repository root with an existing interpreter through `uv run python`. It needs no dependency installation or service calls. Review the adjacent authorization wording as well; static checks do not prove agent compliance.

```python
from pathlib import Path

skills = Path("agent/skills")
basics = {
    name: (skills / "firebase-basics/references" / f"{name}.md").read_text()
    for name in (
        "local-env-setup", "android_setup", "ios_setup", "web_setup",
        "firebase-service-init", "flutter_setup",
    )
}
native = (skills / "firebase-data-connect/reference/native_sql.md").read_text()
examples = (skills / "firebase-data-connect/examples.md").read_text()
sdk = (skills / "firebase-data-connect/reference/sdk_web.md").read_text()
android = (skills / "firebase-firestore/references/enterprise/android_sdk_usage.md").read_text()
web = (skills / "firebase-firestore/references/enterprise/web_sdk_usage.md").read_text()
checks = {
    "Basics CLI selection (6 references)": all(
        "firebase-tools@latest" not in text
        and "installed or repository-pinned" in text
        and "ask before download/install" in text
        for text in basics.values()
    ),
    "Basics local-only tasks and local state gates (6 references)": all(
        "Dependency-only and existing-config tasks do not require" in text
        and "user request or agreement" in text
        for text in basics.values()
    ),
}
gates = {
    "projects:create": ("explicit authorization", "exact", "target", "project"),
    "apps:create": ("explicit authorization", "exact", "target", "project", "app"),
    "firebase init": ("explicit authorization", "exact", "product", "project", "local"),
    "flutterfire configure": ("explicit authorization", "exact", "project", "platform", "registration"),
    "CREATE EXTENSION": ("explicit authorization", "exact", "cloud sql", "project", "instance", "database", "admin"),
}
ungated = []
for name, text in {**basics, "native_sql": native, "examples": examples}.items():
    lines = text.splitlines()
    for index, line in enumerate(lines):
        for command, terms in gates.items():
            if command in line:
                adjacent = "\n".join(lines[max(0, index - 6):index + 1]).lower()
                if not all(term in adjacent for term in terms):
                    ungated.append(f"{name}:{index + 1}: {command}")
checks["Adjacent action/target authorization (8 references)"] = not ungated
extension_sections = (
    native.split("### PostgreSQL Extensions", 1)[1].split("\n## ", 1)[0],
    examples.split("### Use of extensions", 1)[1],
)
checks["PostGIS deferred admin action (2 references)"] = all(
    all(term in text for term in (
        "hosted Cloud SQL mutation", "complete the local code", "deferred",
        "CREATE EXTENSION IF NOT EXISTS postgis;",
    )) for text in extension_sections
)
checks["Web SDK reuse and React generation"] = (
    "firebase init dataconnect:sdk" not in sdk
    and "react: true" in sdk and "generate.javascriptSdk" in sdk
    and "firebase dataconnect:sdk:generate" in sdk
    and "existing generated SDK" in sdk and "separate setup requirement" in sdk
)
checks["Enterprise named databases (3 initializations)"] = (
    "getFirestore(app)" not in web
    and web.count('getFirestore(app, "my-database-id")') == 1
    and "Firebase.firestore" not in android and ".ktx" not in android
    and android.count('FirebaseFirestore.getInstance("my-database-id")') == 2
    and all("verified/configured Enterprise database ID" in text for text in (android, web))
)
checks["Requested client dependency commands retained"] = (
    all("npm install firebase" in text for text in (basics["web_setup"], sdk))
    and "flutter pub add firebase_core" in basics["flutter_setup"]
    and "flutter pub add cloud_firestore" in basics["flutter_setup"]
)
for label, passed in checks.items():
    print(f"{label}: {'PASS' if passed else 'FAIL'}")
if ungated:
    print(f"Ungated command occurrences: {len(ungated)}")
raise SystemExit(0 if all(checks.values()) else 1)
```

## Update workflow

1. Load `skill-creator`, `gh-cli`, and the relevant Firebase skill before editing.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode when an upstream path exists, for example:

```bash
gh api repos/firebase/skills/contents/skills/firebase-firestore/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders, including references, examples, templates, and scripts. For retained Genkit snapshots, first identify a current upstream source before syncing.
4. Adopt or adapt upstream changes only when they preserve the local overlays above, hosted-service gates, and skill-creator policy. Upstream phrasing is not automatic final truth.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Preserve local folder name `firebase-data-connect` even though upstream currently uses `firebase-data-connect-basics`.
7. Update each `agents/openai.yaml` when a skill description changes. Keep the exact matching skill token, valid short descriptions, and existing dependencies.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate all Firebase skills:

```bash
for skill in developing-genkit-dart developing-genkit-go developing-genkit-js developing-genkit-python firebase-ai-logic-basics firebase-app-hosting-basics firebase-auth-basics firebase-basics firebase-data-connect firebase-firestore firebase-hosting-basics firebase-security-rules-auditor; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

10. Run all Local Skill validators after the affected-skill checks. If dependency installation is prohibited, use an existing environment with PyYAML; do not install packages to satisfy validation. Use direct bounded commands when the assignment requires them, with per-skill temporary output and failure/totals summaries.
11. Parse changed YAML and check exact skill tokens, UI short descriptions, and preserved dependencies. Check changed Markdown links and scoped `git diff --check`. Scan changed files for literal home paths, secrets, and generated artifacts.
12. Review trigger near misses, selective loading, exact gates in roots and references, and task-specific completion. Record before/after root sizes as diagnostics, not proof of behavior. Do not run live APIs or model-based evaluations without exact authorization. Report untested behavior and unavailable checks.

These maintenance steps do not authorize staging, committing, pushing, deployment, or any hosted mutation.
