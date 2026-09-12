# Updating Matt Pocock skills

Purpose: keep the Matt Pocock-derived engineering skills aligned with upstream while preserving local Pi conventions and OpenAI skill-creator compliance.

## Local invariants

Before and after updates, apply [local-skill-update-invariants.md](local-skill-update-invariants.md) and [skill-slimming-process.md](skill-slimming-process.md). Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility. Local-only safety or root/reference changes do not update the upstream SHA.

### Shared runtime overlays

- Use concise intent-specific descriptions, not topic-wide triggers, automatic-write promises, command catalogs, or arbitrary local description caps.
- Keep compact roots with boundaries, domain grounding, the requested conversation, completion, and maintenance. Load directly linked formats or design/report references only when the selected task needs them; do not duplicate long formats or examples.
- Review and planning are read-only by default. Do not edit source, `CONTEXT.md`, `CONTEXT-MAP.md`, ADRs, or repository reports without explicit instruction for those repository changes.
- Agreement on a term/design or selecting a candidate is not write authorization. An explicit documentation request authorizes only its stated scope; a glossary request does not authorize unrelated ADRs or source changes. Do not require repeated approval for already-authorized writes.
- Preserve CodeGraph-first source exploration and domain/ADR grounding. Prefer code/docs evidence to questions the repository can answer. Do not introduce automatic delegation or implementation handoffs.
- Ask one material question at a time and include a recommendation. Stop when decisions needed for the requested plan/design are resolved or remaining uncertainties are explicit, not after exhausting every aspect or branch.
- Keep format, interface-design, dependency/testing, and HTML references consistent with root gates. Imperative examples are not permission to write, implement, delete tests, or launch delegates.
- Keep metadata aligned with read-only assessment/planning. Preserve exact `$skill-name` default-prompt tokens, 25–64 character short descriptions, and any intentional dependencies. Both current skills remain `keep it` while their roots stay compact and useful.

### Architecture overlays

- Route `improve-codebase-architecture` to architecture assessment and deepening-candidate exploration, not automatic refactoring or documentation maintenance.
- Preserve [LANGUAGE.md](../../agent/skills/improve-codebase-architecture/LANGUAGE.md) terminology, the deletion test, the interface as test surface, and the one-adapter/two-adapter seam distinction. Ground domain names in `CONTEXT.md` and read applicable ADRs.
- Candidates retain **Files**, **Problem**, **Solution**, and **Benefits**, with evidence and benefits in locality, leverage, and tests. Label ADR conflicts only when concrete friction warrants reopening the decision.
- Preserve the intentional pause: present candidates without interface proposals, ask which to explore, and stop until the user chooses. Selection starts read-only exploration; it does not authorize implementation or documentation writes.
- Keep HTML reporting optional. Generate it only when requested, in the OS temp directory by default. Repository output requires explicit repository-change instruction; ordinary reviews stay in chat.
- Offer an ADR sparingly for durable, non-obvious rejection reasons that pass the three-part test. Create it only on explicit instruction. Do not automatically hand off to implementation after exploration.

### Grilling and documentation overlays

- Route `grill-with-docs` to a guided plan/domain decision session, not a documentation generator or implementation workflow.
- Preserve vocabulary challenges, concrete scenarios, and comparison with code/docs. Replace relentless/exhaustive interviewing with the shared bounded stopping criteria.
- When documentation writes are explicitly requested, preserve glossary-only `CONTEXT.md`, canonical terms, relationships, and example dialogue. Exclude implementation details, specs, and scratch notes.
- Preserve lazy creation: create `CONTEXT.md` only when an authorized resolved term is ready, and `docs/adr/` only for the first authorized real ADR. Missing files or conversational agreement do not authorize creation. Do not create placeholders.
- Preserve single-context and context-map conventions: root `CONTEXT-MAP.md` points to local glossaries and context-specific ADRs, with system-wide ADRs in root `docs/adr/`. Clarify uncertain context ownership.
- Offer ADRs only when all three hold: hard to reverse, surprising without context, and a real trade-off. Passing the test warrants an offer, not a write.
- Keep [usage guidance](grill-with-docs-usage.md) consistent: initialization prompts explicitly request writes; ordinary plan grilling does not.

## Source of truth

- Upstream repository: https://github.com/mattpocock/skills
- Current upstream commit checked locally: `84fdeffd12f2ee307994d1eb6feb48173b6e0502`

| Local skill | Upstream path | Local notes |
| --- | --- | --- |
| `grill-with-docs` | `skills/engineering/grill-with-docs` | Keeps `CONTEXT-FORMAT.md` and `ADR-FORMAT.md`; use as the replacement for deprecated ubiquitous-language workflow. |
| `improve-codebase-architecture` | `skills/engineering/improve-codebase-architecture` | Architecture deepening workflow informed by `CONTEXT.md` and ADRs. |

## Local files

- `agent/skills/grill-with-docs/`
- `agent/skills/improve-codebase-architecture/`
- Each skill has local `agents/openai.yaml` UI metadata.
- `docs/skills/grill-with-docs-usage.md` is local usage guidance and should remain separate from this update process.
- Local policy: do not install the broader Matt skill suite by default. Current upstream `improve-codebase-architecture` assumes companion skills such as `codebase-design` and `domain-modeling`; keep this Pi setup self-contained and cherry-pick useful ideas instead.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode, for example:

```bash
gh api repos/mattpocock/skills/contents/skills/engineering/grill-with-docs/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders.
4. Adopt only useful upstream runtime changes, then reapply the shared and skill-specific overlays above. Keep roots and selected references consistent; upstream is not the final policy.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Keep local maintenance pointers in each `SKILL.md` pointing to this grouped update process.
7. Keep `agents/openai.yaml` valid YAML with only UI metadata fields unless UI assets are intentionally installed.
8. Update the upstream commit SHA only after an actual upstream sync/review. Do not change it for local-only safety, metadata, or slimming edits.
9. Validate all remaining Matt Pocock skills:

```bash
for skill in grill-with-docs improve-codebase-architecture; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

10. Run all Local Skill validators. Parse changed YAML, check exact skill tokens, short-description ranges, dependencies, changed links, and the scoped diff. Compare root lines as a diagnostic, not proof of useful behavior.
11. Statically check near misses: an architecture audit ends with candidates; choosing one remains read-only; a plan/domain review does not write; agreement on a term does not write; explicit glossary/ADR requests allow only the requested documentation. Check the candidate pause and bounded stopping criteria. Do not use live/model evaluations unless separately requested.
12. Scan changed files for literal home paths and secret values. Commit only when explicitly requested.

## Notes

- Do not install `skills/deprecated/ubiquitous-language` unless explicitly requested. The local convention is to use `grill-with-docs` for domain language and ADR discipline.
- `tdd` was removed during the skill slimming pass because test-driven development is strong base-model capability. Do not restore it unless explicitly requested.
- Do not create placeholder ADRs. Create `docs/adr/` lazily only when a real ADR-worthy decision is ready and recording it is explicitly authorized.
