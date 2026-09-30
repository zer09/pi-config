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
- Canonical default branch: `main`.
- Current upstream commit checked locally: `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`.
- Current recursive tree: `b9814f871fb63e6b40b1e82017c363b59075e81c` (complete, not truncated).
- Previous comparison pin: `84fdeffd12f2ee307994d1eb6feb48173b6e0502`, tree `5c5d817a09c3ac2cbad66c0d09db3fce3455a440`.
- This is a comparison pin, not a claim that all upstream behavior was copied.

| Local skill | Upstream path | Local notes |
| --- | --- | --- |
| `grill-with-docs` | `skills/engineering/grill-with-docs` | Keeps `CONTEXT-FORMAT.md` and `ADR-FORMAT.md`; use as the replacement for deprecated ubiquitous-language workflow. |
| `improve-codebase-architecture` | `skills/engineering/improve-codebase-architecture` | Architecture deepening workflow informed by `CONTEXT.md` and ADRs. |

## Latest source comparison

Fetched both pinned trees and every file under the two mapped folders through authenticated `gh api --method GET`. Verified each downloaded blob against its tree SHA and size, recorded SHA-256 hashes, and compared the exact prior, current, and local content. Neither mapped folder moved.

### Mapped runtime inventory at the current pin

Paths below are relative to the upstream repository root. The prior pin has the same five paths.

| Source path | Change from prior pin |
| --- | --- |
| `skills/engineering/grill-with-docs/SKILL.md` | Replaces slash-command composition with explicit Skill-tool calls for `grilling` and `domain-modeling`. |
| `skills/engineering/grill-with-docs/agents/openai.yaml` | Byte-identical upstream metadata. |
| `skills/engineering/improve-codebase-architecture/SKILL.md` | Skill-tool dispatch, `CONTEXT.md` to `GLOSSARY.md` references, and punctuation changes. |
| `skills/engineering/improve-codebase-architecture/HTML-REPORT.md` | Punctuation and wording only; no new report behavior. |
| `skills/engineering/improve-codebase-architecture/agents/openai.yaml` | Byte-identical upstream metadata. |

### Governing references compared, not installed

The mapped roots compose companion skills upstream. Compared these seven Markdown files at both pins to check the source of the local self-contained references:

| Current source path | Local behavior/reference retained |
| --- | --- |
| `skills/productivity/grilling/SKILL.md` | Bounded, one-question-at-a-time sessions in both local roots. |
| `skills/engineering/domain-modeling/SKILL.md` | Domain grounding and explicit-only documentation writes in both local roots. |
| `skills/engineering/domain-modeling/GLOSSARY-FORMAT.md` | `grill-with-docs/CONTEXT-FORMAT.md`; prior upstream path was `skills/engineering/domain-modeling/CONTEXT-FORMAT.md`. |
| `skills/engineering/domain-modeling/ADR-FORMAT.md` | `grill-with-docs/ADR-FORMAT.md`. |
| `skills/engineering/codebase-design/SKILL.md` | `improve-codebase-architecture/LANGUAGE.md` and the compact root glossary. |
| `skills/engineering/codebase-design/DEEPENING.md` | `improve-codebase-architecture/DEEPENING.md`. |
| `skills/engineering/codebase-design/DESIGN-IT-TWICE.md` | `improve-codebase-architecture/INTERFACE-DESIGN.md`. |

The grilling change expands the multi-question round example. Domain-modeling changes its description and renames `CONTEXT.md`, `CONTEXT-MAP.md`, and the format reference to `GLOSSARY` names. Other reference changes are punctuation or wording, plus the glossary rename in interface-design guidance. No new relevant behavior requires another local reference or dependency.

### Decisions

| Local skill | Decision | Adopt/adapt/reject assessment |
| --- | --- | --- |
| `grill-with-docs` | `keep it`; compared/no-op across all 4 runtime files. | No new adoption or adaptation. Reject companion Skill-tool dispatch, multi-question rounds, and glossary renames. Retain the existing bounded conversation, grounded vocabulary/scenarios, explicit-only lazy documentation writes, context ownership, relationships, and example dialogue. |
| `improve-codebase-architecture` | `keep it`; compared/no-op across all 6 runtime files. | No new adoption or adaptation. Reject companion dispatch and glossary renames; do not import punctuation-only changes. Retain candidate fields and selection pause, read-only exploration, deep-module terminology and tests, explicit-only documentation, and optional temp HTML. |

Existing divergences still reject automatic delegation, exhaustive interviewing, inline writes from agreement, mandatory HTML/browser opening, and automatic implementation. Local skill names, metadata, reference names, and ownership do not change. `grill-with-docs-usage.md` stays byte-identical because runtime behavior did not change.

Validation: both target validators and all 38 Local Skill validators passed, including frontmatter, YAML, exact skill tokens, description ranges, and runtime links. Static positive/near-miss review preserved read-only planning, the candidate pause, selected-candidate exploration, exact-scope glossary/ADR authorization, and optional temp reports. All 10 runtime files match their pre-comparison hashes. No live/model evaluation was run.

## Local files

- `agent/skills/grill-with-docs/`
- `agent/skills/improve-codebase-architecture/`
- Each skill has local `agents/openai.yaml` UI metadata.
- `docs/skills/grill-with-docs-usage.md` is local usage guidance and should remain separate from this update process.
- Local policy: do not install the broader Matt skill suite by default. Current upstream `improve-codebase-architecture` assumes companion skills such as `codebase-design` and `domain-modeling`; keep this Pi setup self-contained and cherry-pick useful ideas instead.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Resolve the canonical default branch, commit, and complete recursive tree with authenticated `gh` GET requests through Context Mode. Substitute the returned values for `BRANCH`, `TREE_SHA`, and `BLOB_SHA`:

```bash
gh api --method GET repos/mattpocock/skills --jq .default_branch
gh api --method GET repos/mattpocock/skills/commits/BRANCH --jq '{sha, tree: .commit.tree.sha}'
gh api --method GET 'repos/mattpocock/skills/git/trees/TREE_SHA?recursive=1'
gh api --method GET repos/mattpocock/skills/git/blobs/BLOB_SHA
```

Fetch every runtime file under the mapped folders at that commit. Resolve moves through the tree without silently changing local ownership. Follow governing companion references only as needed to compare the source of retained behavior; do not install the broader suite.

3. Compare exact current source with the previous comparison pin and local files before editing. Keep temporary commit/tree inventories, blob and file hashes, local snapshots, and an increment-only diff.
4. Adopt only useful upstream runtime changes, then reapply the shared and skill-specific overlays above. Keep roots and selected references consistent; upstream is not the final policy. If no relevant change remains, leave runtime byte-identical and record compared/no-op rather than manufacturing a wording update.
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

10. Run all Local Skill validators after every update. Parse target YAML, check exact skill tokens, short-description ranges, dependencies, changed links, and the scoped diff. Compare root lines as a diagnostic, not proof of useful behavior.
11. Statically check near misses: an architecture audit ends with candidates; choosing one remains read-only; a plan/domain review does not write; agreement on a term does not write; explicit glossary/ADR requests allow only the requested documentation. Check the candidate pause and bounded stopping criteria. Do not use live/model evaluations unless separately requested.
12. Scan changed files for literal home paths and secret values. Commit only when explicitly requested.

## Notes

- Do not install `skills/deprecated/ubiquitous-language` unless explicitly requested. The local convention is to use `grill-with-docs` for domain language and ADR discipline.
- `tdd` was removed during the skill slimming pass because test-driven development is strong base-model capability. Do not restore it unless explicitly requested.
- Do not create placeholder ADRs. Create `docs/adr/` lazily only when a real ADR-worthy decision is ready and recording it is explicitly authorized.
