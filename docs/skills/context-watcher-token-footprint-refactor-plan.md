# Context Watcher token-footprint refactor plan

Status: planning only. Do not execute this refactor until the user explicitly asks to proceed.

Current measured size: `agent/skills/context-watcher/SKILL.md` is 991 lines and 43,163 bytes.

## Purpose

Reduce `context-watcher` from a large always-loaded skill into a compact foundational `SKILL.md` plus load-on-demand references, without weakening any safety, routing, graph-first, RTK, GitHub, Context Mode, worktree, or sub-agent behavior.

The goal is not to make the skill short at any cost. The goal is to make always-on rules impossible to miss while moving examples, recipes, troubleshooting, and provenance out of the hot path.

## Non-goals

- Do not change the external hosted service mutation gate.
- Do not change the Bash whitelist or Context Mode routing semantics.
- Do not change the default RTK policy for read-only shell work.
- Do not change graph-first exploration for supported codebase work.
- Do not change private GitHub routing through authenticated `gh` CLI.
- Do not change worktree grouping rules.
- Do not change sub-agent safety rules.
- Do not edit `agent/settings.json`.
- Do not push commits.

## Source files examined for this plan

- `agent/skills/context-watcher/SKILL.md`
- `docs/skills/custom-local-skills-update-process.md`
- `docs/skills/local-skill-update-invariants.md`
- `docs/skills/README.md`
- `CONTEXT.md`

## Success criteria

### Size targets

- Target `SKILL.md`: 250-350 lines.
- Hard ceiling for `SKILL.md`: 400 lines unless a specific mandatory rule needs more room.
- Reference files can be longer, but each should have one clear purpose.

### Behavioral targets

After the refactor, an agent that only loads `SKILL.md` must still know:

1. External hosted service mutations require explicit user instruction for the exact mutation.
2. Bash is only for the whitelist and local mutations/navigation.
3. Read-only shell commands must go through Context Mode and RTK when available.
4. Large output, logs, tests, build output, searches, and file analysis must stay in Context Mode.
5. `read` is for editing; `ctx_execute_file` is for analysis.
6. Web URLs use `ctx_fetch_and_index` then `ctx_search`.
7. Context7 is required for current third-party library/framework/API docs before implementation or advice.
8. GitHub repo, PR, issue, review, workflow, release, or private data uses the `gh-cli` skill and authenticated `gh` CLI through Context Mode/RTK.
9. Codebase exploration, review, caller/callee lookup, blast radius, refactor analysis, and test discovery use Code Review Graph first when applicable.
10. Sub-agents follow Context Mode, RTK, Code Review Graph, `gh-cli`, and external-service mutation rules.
11. Worktrees use story-grouped roots and graph daemon/watch rules when applicable.
12. Fallbacks are explicit and logged or summarized, not silent behavior changes.
13. `context-watcher` itself is a Custom Local Skill and is maintained through `custom-local-skills-update-process.md`.

### Validation targets

- `quick_validate.py` passes for `context-watcher`.
- `quick_validate.py` passes for all 41 Local Skills.
- All `agents/openai.yaml` files still parse as YAML.
- All markdown links in modified skill docs resolve.
- No new realistic secret-looking values are introduced.
- No user-specific home paths are introduced.
- `git diff --check` passes.
- Manual scenario simulation passes for every mandatory route listed later in this plan.

## Foundational invariants to preserve verbatim or near-verbatim

These rules are load-bearing. They should stay in the compact `SKILL.md`, not only in references.

### Safety and mutation gate

- External hosted services are read-only by default.
- Mutations need explicit user instruction for that exact action.
- GitHub writes, PR comments, merges, workflow dispatches, releases, deployments, Firebase/GCP/AWS/Azure changes, Figma writes, Linear updates, Notion writes, Slack posts, Stripe changes, and similar actions are mutations.
- Do not infer write permission from broad goals.
- Preserve secret protection and local path privacy reminders.

### Command routing

- Direct Bash is only for whitelisted local mutations/navigation and short safe commands.
- Read-only shell commands use Context Mode with RTK when available.
- Commands that may produce more than 20 lines must not use raw Bash.
- Data analysis must be done programmatically inside `ctx_execute` or `ctx_execute_file`.
- File reads for analysis use `ctx_execute_file`.
- File reads for editing can use the native read tool.
- File writes use native write/edit tools, not `ctx_execute`.

### Context Mode

- `ctx_batch_execute` is the primary shell research tool.
- `ctx_execute` is for a single command or computation.
- `ctx_execute_file` is for file analysis without loading raw contents into context.
- `ctx_fetch_and_index` then `ctx_search` is the URL/docs path.
- `ctx_search` recovers indexed prior state after compaction.
- `ctx_index` is for already-available content, not a docs source.

### RTK

- RTK is the default prefix for read-only shell operations when available.
- RTK should be used inside Context Mode, not as a reason to bypass Context Mode.
- RTK output compression does not replace programmed analysis.

### Code Review Graph

- Graph-first for codebase exploration, review, blast-radius analysis, caller/callee lookup, test discovery, architecture review, and refactor analysis.
- An empty, stale, unavailable, or incomplete graph is not automatically a reason to abandon graph-first.
- Build or update the graph when authorized and appropriate, then retry graph query.
- Fall back only after graph-first is not applicable or remains insufficient.

### GitHub

- Load and follow `gh-cli` for GitHub repo, PR, issue, review, workflow, release, comments, or private data.
- Use authenticated `gh` CLI through Context Mode/RTK.
- Do not use browser/web tools to fetch private GitHub data unless explicitly requested for browser inspection.
- GitHub writes remain external hosted service mutations.

### Context7 and web docs

- Use Context7 for current third-party library/framework/API docs before implementation or advice.
- Do not send secrets, personal data, or proprietary code in Context7 queries.
- Use web/content tools only for broad public web research or when Context7 is insufficient.

### Sub-agent protocol

- Parent remains responsible for final decisions, validation, commits, and user-facing report.
- Sub-agents must use Context Mode and Code Review Graph first when applicable.
- Sub-agents must use `gh-cli` and authenticated `gh` CLI for GitHub data.
- Sub-agents treat remote services as read-only unless exact mutation is authorized.
- Sub-agents return compact structured findings, not raw logs or large diffs.

### Worktree graph protocol

- Multi-repo feature worktrees go under `.worktrees/<story>/<feature>/<repo-name>/`.
- Standalone fixes, hotfixes, and issue work go under `.worktrees/issues/<issue-number>/<repo-name>/`.
- Prefer daemon-backed graphs for active roots when useful.
- Add watched roots when missing and remove them when the worktree group is removed.

## Current section map and disposition

This map is based on the current 991-line file. During implementation, re-run the section extraction and ignore headings inside code fences so the final migration matrix is line-accurate.

| Current range | Section | Lines | Disposition | Notes |
|---|---:|---:|---|---|
| 6-64 | Local metadata, trigger phrases, compatibility | 57 | Split | Keep short triggers and compatibility warning in `SKILL.md`; move platform details to references. |
| 65-79 | Mandatory Context7 Docs Preflight | 15 | Core | Keep in `SKILL.md`. |
| 80-91 | Mandatory External Hosted Service Mutation Gate | 12 | Core | Keep in `SKILL.md`. |
| 92-101 | Mandatory GitHub CLI Preflight | 10 | Core | Keep in `SKILL.md`, with details in GitHub reference. |
| 102-109 | Mandatory Graph-First Preflight | 8 | Core | Keep in `SKILL.md`. |
| 110-126 | Mandatory Sub-agent Protocol | 17 | Split | Keep core bullets in `SKILL.md`; move expanded checklist to sub-agent reference. |
| 127-183 | Mandatory Worktree Graph Protocol | 57 | Split | Keep story-root rule in `SKILL.md`; move daemon/watch details to worktree reference. |
| 184-219 | Architecture Overview | 36 | Reference | Move to `references/architecture-and-tool-roles.md` or merge into quick reference. |
| 220-239 | Think in Code examples | 20 | Split | Keep rule in `SKILL.md`; move wrong/right examples to patterns reference. |
| 240-267 | Blocked commands | 28 | Core | Keep concise forbidden fetch rules in `SKILL.md`. |
| 268-354 | Gatekeeper and decision tree | 87 | Split | Keep compact decision tree in `SKILL.md`; move full tree and examples to routing reference. |
| 355-438 | RTK inside Context Mode | 84 | Reference plus core summary | Keep RTK default rule in `SKILL.md`; move command examples, flags, analytics to RTK reference. |
| 439-524 | Code Review Graph details and graph setup | 86 | Split | Keep graph-first rule in `SKILL.md`; move build/update/watch examples to graph reference. |
| 525-539 | Context Mode management commands | 15 | Reference | Move management commands to Context Mode reference. |
| 540-580 | Error handling and fallback protocol | 41 | Split | Keep fallback principles in `SKILL.md`; move flow and log review commands to troubleshooting reference. |
| 593-647 | Context Mode sandbox tools reference | 55 | Reference plus core summary | Keep tool hierarchy in `SKILL.md`; move per-tool examples to Context Mode reference. |
| 648-659 | Tool selection hierarchy | 12 | Core | Keep in `SKILL.md`, possibly as the main compact routing table. |
| 660-772 | Real-world patterns | 113 | Reference | Move all patterns to recipes reference. |
| 773-792 | Anti-patterns | 20 | Split | Keep strongest anti-patterns in `SKILL.md`; move detailed examples to recipes reference. |
| 793-878 | Troubleshooting | 86 | Reference | Move to troubleshooting reference. |
| 879-938 | Quick reference card | 60 | Reference plus compact core | Keep a 10-15 line compact card in `SKILL.md`; move full card to quick reference. |
| 939-957 | Platform compatibility matrix | 19 | Reference | Move to platform reference. |
| 958-988 | Upstream references | 31 | Reference | Move to upstream sources reference. |
| 989-991 | Maintenance | 3 | Core | Keep in `SKILL.md`. |

## Proposed target layout

```text
agent/skills/context-watcher/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── references/
    ├── context-mode-routing.md
    ├── rtk-usage.md
    ├── code-review-graph-protocol.md
    ├── github-and-context7-routing.md
    ├── worktree-graph-protocol.md
    ├── subagent-protocol.md
    ├── fallback-and-troubleshooting.md
    ├── patterns-and-quick-reference.md
    └── upstream-sources.md
```

## Proposed compact `SKILL.md` outline

Target: 250-350 lines.

1. Frontmatter
   - Preserve `name` and `description` only.
2. Mission and non-negotiables
   - State that this skill governs shell work, Context Mode, RTK, Code Review Graph, GitHub routing, worktrees, sub-agents, and large-output protection.
3. Mandatory preflight checklist
   - External hosted service mutation gate.
   - Bash whitelist.
   - Read-only shell route.
   - File read policy.
   - Data analysis policy.
   - GitHub route.
   - URL/docs route.
   - Context7 route.
   - Code Review Graph route.
   - Worktree route.
   - Sub-agent route.
4. Routing table
   - User intent to required tool route.
   - Keep this table concise and complete.
5. Direct Bash whitelist
   - Keep the exact whitelist aligned with `AGENTS.md`.
6. Context Mode core tools
   - One-line purpose for `ctx_batch_execute`, `ctx_execute`, `ctx_execute_file`, `ctx_fetch_and_index`, `ctx_search`, `ctx_index`.
7. RTK core rule
   - RTK default for read-only shell work inside Context Mode.
8. Code Review Graph core rule
   - Graph-first plus fallback conditions.
9. GitHub core rule
   - `gh-cli` skill plus authenticated `gh` through Context Mode/RTK.
10. Sub-agent core rule
    - Short mandatory checklist and reference pointer.
11. Worktree core rule
    - Story-root structure, issue structure, graph daemon/watch requirement, reference pointer.
12. Fallback principles
    - Try correct route, record fallback reason, avoid silent bypass.
13. Load-on-demand references
    - A table that says exactly when to read each reference.
14. Maintenance
    - Link to `custom-local-skills-update-process.md`.

## Reference loading contract

Each reference must be mentioned in `SKILL.md` with a precise trigger. If the trigger is not visible in `SKILL.md`, the reference is effectively hidden and should not exist.

| Reference | Load when |
|---|---|
| `context-mode-routing.md` | Command routing is non-trivial, Context Mode tool choice is unclear, file/log/test/build output is involved, or a route needs examples. |
| `rtk-usage.md` | RTK flags, compression behavior, analytics, or RTK failure modes matter. |
| `code-review-graph-protocol.md` | Code review, codebase exploration, graph build/update, stale graph, graph daemon, or graph fallback details matter. |
| `github-and-context7-routing.md` | GitHub/private GitHub data or current third-party library/API docs are involved. |
| `worktree-graph-protocol.md` | Creating, using, watching, or removing worktrees. |
| `subagent-protocol.md` | Delegating to Pi sub-agents or orchestrating parallel investigations. |
| `fallback-and-troubleshooting.md` | Context Mode, RTK, or Code Review Graph is unavailable, failing, stale, or producing unexpected output. |
| `patterns-and-quick-reference.md` | The agent needs examples for PR review, test-debug-fix, orientation, infrastructure inspection, docs lookup, recovery, or data analysis. |
| `upstream-sources.md` | Updating the skill or checking provenance. |

## Needle-in-haystack audit method

The refactor should use a line-by-line migration ledger, not a freehand rewrite.

For every paragraph, table, list item, and code fence in the current `SKILL.md`, classify it as exactly one of:

- `CORE_KEEP`: stays in compact `SKILL.md` with same meaning.
- `CORE_SUMMARIZE`: stays in compact `SKILL.md` but shorter.
- `REFERENCE_MOVE`: moves to a named reference file with same meaning.
- `REFERENCE_SUMMARIZE`: moves to a reference but can be shortened.
- `DELETE_DUPLICATE`: deleted only because the same instruction exists elsewhere in stronger form.
- `DELETE_STALE`: deleted only if verified stale or misleading.

No content should be deleted just because it feels verbose.

## Mandatory rule preservation audit

Before editing, extract every line containing these terms and track its destination:

- `MUST`
- `Mandatory`
- `NEVER`
- `FORBIDDEN`
- `Do not`
- `Do NOT`
- `Always`
- `external hosted service`
- `mutation`
- `secret`
- `GitHub`
- `gh-cli`
- `Context7`
- `ctx_execute`
- `ctx_batch_execute`
- `ctx_execute_file`
- `ctx_fetch_and_index`
- `ctx_search`
- `rtk`
- `code-review-graph`
- `Graph-First`
- `worktree`
- `sub-agent`
- `fallback`

For each extracted line, record:

```text
original line range -> destination file -> destination heading -> preservation type -> notes
```

If a mandatory line is moved out of `SKILL.md`, the compact `SKILL.md` must still contain the trigger that causes the reference to be loaded.

## Code fence and heading audit

The current file contains many code fences and comment lines that begin with `#`. A naive heading parser sees some comments inside examples as headings.

During implementation:

1. Parse headings while ignoring fenced code blocks.
2. Confirm all code fences are balanced before editing.
3. Move large code examples into references.
4. Keep no more than 3-5 short examples in `SKILL.md`.
5. Prefer pseudocode or route tables in `SKILL.md` over long shell examples.

## Detailed execution plan

### Phase 0: Baseline freeze

1. Confirm working tree state.
2. Confirm `agent/settings.json` remains unstaged and untouched.
3. Capture current hash and size of `agent/skills/context-watcher/SKILL.md`.
4. Run current all-skill validation to prove baseline is healthy.
5. Generate the line-by-line migration ledger.

### Phase 1: Build the migration ledger

Create a temporary analysis artifact, not committed unless useful, that lists:

- Source line range.
- Source heading.
- Rule category.
- Destination file.
- Disposition.
- Whether the content is mandatory.
- Whether the content mentions safety, GitHub, Graph, RTK, Context Mode, Context7, worktrees, sub-agents, or fallback.

The ledger is the guardrail against losing a needle in the haystack.

### Phase 2: Create reference files without changing behavior

Create the `references/` files first by moving content with minimal rewriting.

Preferred order:

1. `upstream-sources.md`
2. `patterns-and-quick-reference.md`
3. `fallback-and-troubleshooting.md`
4. `rtk-usage.md`
5. `context-mode-routing.md`
6. `code-review-graph-protocol.md`
7. `worktree-graph-protocol.md`
8. `subagent-protocol.md`
9. `github-and-context7-routing.md`

This order moves low-risk reference content first and leaves mandatory core rules until the compact `SKILL.md` rewrite.

### Phase 3: Rewrite compact `SKILL.md`

Rewrite only after references exist.

The compact `SKILL.md` must include:

- A short mission statement.
- Mandatory preflight checklist.
- Bash whitelist.
- Tool routing table.
- Code Review Graph first rule.
- GitHub CLI/private GitHub route.
- Context7 docs route.
- Sub-agent rule summary.
- Worktree rule summary.
- Fallback rule summary.
- Reference loading table.
- Maintenance pointer.

Use concise imperative language. Do not include lengthy justifications in `SKILL.md`.

### Phase 4: Consistency checks

Run scripted checks for:

- Frontmatter keys only `name` and `description`.
- `agents/openai.yaml` still present and valid.
- All markdown links resolve.
- No broken relative links from `SKILL.md` to references.
- No `docs/skills` maintenance pointer loss.
- No home paths.
- No realistic secret-looking values.
- No `disable-model-invocation: false`.
- No untracked `__pycache__` or `.pyc` artifacts.

### Phase 5: Behavioral simulation matrix

Manually inspect the compact `SKILL.md` and references against these scenarios.

| Scenario | Expected route after refactor |
|---|---|
| User asks to inspect a large log | `ctx_execute_file`; do not read raw log. |
| User asks to run tests | `ctx_execute` or `ctx_batch_execute` with `rtk`; summarize failures. |
| User asks to edit a source file | Native read for the file being edited, native edit/write for mutation. |
| User asks to analyze code architecture | Code Review Graph first, then Context Mode fallback if needed. |
| User asks about a third-party API | Context7 first, local installed source if relevant, web only if needed. |
| User asks about a private GitHub PR | Load `gh-cli`, use `gh` through Context Mode/RTK. |
| User asks to push a commit | Allowed only because exact GitHub mutation is explicit. |
| User asks to handle a PR without saying comment/push/merge | Read-only by default; draft mutations instead. |
| User gives a URL | `ctx_fetch_and_index`, then `ctx_search`. |
| User asks to create a feature worktree | Story-grouped `.worktrees/<story>/<feature>/<repo-name>/` and graph daemon/watch rules. |
| Parent delegates to sub-agent | Sub-agent must load Context Watcher, use Context Mode, graph-first, `gh-cli`, and return compact findings. |
| Context Mode or RTK fails | Follow fallback protocol, do not silently bypass routing. |
| Session resumes after compaction | Use `ctx_search(sort: "timeline")` or indexed state before asking the user. |

### Phase 6: Diff review

Review the diff with these questions:

1. Can an agent still choose the correct tool route without reading any reference?
2. Are all remote mutation rules visible in `SKILL.md`?
3. Are all reference triggers visible in `SKILL.md`?
4. Did any mandatory rule become optional by moving it to a reference?
5. Did any example become the only copy of a policy?
6. Did any policy get duplicated with conflicting wording?
7. Does the skill still comply with `local-skill-update-invariants.md`?
8. Does the skill still comply with `custom-local-skills-update-process.md`?

### Phase 7: Validation commands

Use Context Mode for command output. Suggested commands:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/context-watcher
```

```bash
for skill_dir in agent/skills/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also run programmed checks for:

- Markdown links.
- OpenAI YAML parse.
- Frontmatter invariants.
- Maintenance pointers.
- Secret-like values.
- Home paths.
- Runtime artifacts.
- `git diff --check`.

### Phase 8: Commit plan

Recommended commit split:

1. Commit 1: move reference content and add compact `SKILL.md`.
2. Commit 2, optional: further tighten reference prose after behavior parity is proven.

Do not combine this with unrelated skill updates.

## Risk register

| Risk | Why it matters | Mitigation |
|---|---|---|
| Mandatory rule hidden in reference | Agents may never load it. | Keep all preflight rules in `SKILL.md`; references only deepen details. |
| Contradictory routing text | Agents may choose wrong tools. | One routing table in `SKILL.md`; references must point back to it. |
| GitHub mutation gate weakened | Could mutate remote state without exact permission. | Keep GitHub and external hosted service gate in core. |
| Graph-first rule weakened | Code reviews may fall back to grep too early. | Keep graph-first rule and fallback conditions in core. |
| Context Mode bypass | Raw output can flood context. | Keep command-routing checklist and Bash whitelist in core. |
| Worktree daemon details lost | Multi-repo work can become fragmented. | Move detail to reference but keep story-root rule in core. |
| Sub-agent rules diluted | Child processes may leak raw logs or mutate services. | Keep parent responsibility and child safety rules in core. |
| Reference sprawl | Too many small files become hard to navigate. | Use 8-9 references max with explicit load triggers. |
| Token savings too small | Refactor may not justify risk. | Measure before/after line count and bytes. |
| Over-compression | Skill becomes terse but ambiguous. | Behavioral simulation matrix must pass before commit. |

## Open decisions for the user before execution

1. Target size: I recommend 300 lines for `SKILL.md`, with 400 as the hard ceiling. Is that acceptable?
2. Refactor style: I recommend preserving wording in references first, then doing any prose compression in a later commit. Is that acceptable?
3. Reference granularity: I recommend separate references for Context Mode, RTK, Graph, Worktrees, Sub-agents, Troubleshooting, Patterns, GitHub/Context7, and Upstream Sources. Is that too many, too few, or right?
4. Quick reference: I recommend keeping a tiny route table in `SKILL.md` and moving the long quick-reference card to `patterns-and-quick-reference.md`. Is that acceptable?
5. Worktree and sub-agent policies: I recommend keeping concise summaries in core because they are safety-sensitive. Do you want the full text preserved verbatim in references?

## Recommended next step

If the user approves, execute Phase 0 and Phase 1 only first, then pause with the migration ledger summary before rewriting `SKILL.md`. That gives one more chance to catch hidden load-bearing rules before changing the foundation skill.
