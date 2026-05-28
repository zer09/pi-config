# ADR 0001: Skill slimming and maintenance policy

## Status

Accepted

## Context

This Pi config had accumulated runtime skills from several sources: local Pi skills, npm-provided skills, and universal skills linked from `~/.agents/skills`. Some skills encode important local tooling or safety behavior, while others duplicate tasks the base model can already do well without extra runtime instructions.

Large or redundant skills increase prompt footprint and make future maintenance harder. Removing or slimming skills should preserve the parts that matter: local tool protocols, exact CLI/MCP workflows, hosted-service mutation gates, and project-specific conventions.

The initial inventory and recommendations are recorded in `scratch/installed-skills-trim-verdict.md`.

## Decision

Use a three-way classification for installed skills:

- `keep it`: retain the skill when it captures custom/local tooling, safety-critical gates, niche APIs, or workflows that are hard to reproduce from memory.
- `make it slim`: keep the skill but reduce `SKILL.md` to triggers, required routing, safety rules, exact commands, and pointers to references.
- `remove it`: uninstall the skill when it mostly duplicates base model capability or overlaps with better local tooling.

Runtime `SKILL.md` files should stay compact. Long examples, command catalogs, troubleshooting notes, and API details should move to `references/` or `docs/skills/` when they are still useful.

The first removal under this policy was the `understand` skill suite. These skills were installed as universal symlinks in `~/.agents/skills` and overlapped with existing Pi tools such as context-mode and codebase-memory-mcp. Removal deleted only the symlinks from the active skill path and left the upstream `~/.understand-anything` checkout untouched.

The next removal pass deleted all skills rated 9 in the inventory: `edge-case-analysis`, `humanizer`, `refine-linear-task`, and `tdd`. These workflows are strong base-model capabilities and do not need dedicated runtime skill instructions.

The Astral Python tooling pass kept `uv`, `ruff`, and `ty`, but slimmed each skill to core triggers, command routing, scoped-change safeguards, docs links, and maintenance pointers. These tools remain installed because exact Python tooling conventions are useful, while long migration tables and broad command catalogs are unnecessary at runtime.

The PlanetScale database pass kept `mysql` and `postgres`, but slimmed each skill around database safety gates, evidence-based workflow, fast guidance, local reference navigation, provider notes, and maintenance pointers. Detailed database internals and command catalogs stay in `references/`.

The Notion CLI pass removed `notion-cli` because prior use showed the local `ntn` CLI output was not a good fit for routine agent workflows. Notion remains an external hosted service; exact explicit user instruction is still required for any future Notion write.

The MiniMax CLI pass removed `mmx-cli` because MiniMax is niche in this setup and not used often enough to justify a dedicated runtime skill. Future MiniMax API generation or remote-state changes still require exact explicit user instruction.

The Linear CLI pass kept `linear-cli`, but slimmed runtime guidance to mutation gates, discovery workflow, reference navigation, Markdown/body-file handling, known command gotchas, and GraphQL fallback safety. Detailed command help remains in `references/`.

The Firebase pass kept the Firebase-owned and Genkit skills, slimming the skills whose workflows are familiar enough to keep compact: `developing-genkit-js`, `firebase-ai-logic-basics`, `firebase-app-hosting-basics`, `firebase-auth-basics`, `firebase-basics`, and `firebase-hosting-basics`. It retained the more niche or safety-sensitive skills as-is: Genkit Dart/Go/Python, Data Connect, Firestore, and the security rules auditor. Current `firebase/skills` no longer contains the local Genkit paths, so those remain local snapshots until a new upstream source is verified.

## Consequences

- Fewer installed runtime skills are loaded or considered by Pi.
- Custom safety and routing skills remain protected.
- Future skill updates must preserve `docs/skills/local-skill-update-invariants.md`.
- Removed skills can be reinstalled later if a concrete workflow requires them.

## Validation

For each trimming step:

1. Verify the target skill paths and whether they are symlinks or real directories before deletion.
2. Delete only the intended installed skill entries.
3. Re-run an installed-skill inventory.
4. Run local skill validation when local Pi skills changed.
