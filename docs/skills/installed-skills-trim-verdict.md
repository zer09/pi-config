# Installed Pi Skills Trim Verdict

Basis: rating means how well I can do the task from base model memory without the skill. I recommend keeping skills when they encode local/custom tooling, exact MCP/CLI workflows, or safety-critical procedures.

Status legend: blank = not addressed yet; `✓` = addressed and retained/slimmed; `x` = addressed and removed.

| Status | Skill | How good without skill | Rating | Action | Verdict |
|---|---|---:|---:|---|---|
| x | a11y-debugging | Strong | 8 | remove it | Retired with the old pasted Chrome DevTools MCP skill group; use Pi browser tools and focused docs lookup instead. |
| x | agentmemory | Weak | 3 | remove it | Retired from the old pasted skills; do not restore the Pi AgentMemory extension or bundled skill unless explicitly requested. |
| x | chrome-devtools | Good | 7 | remove it | Retired with the old pasted Chrome DevTools MCP skill group; use Pi browser tools and focused docs lookup instead. |
| x | chrome-devtools-cli | Medium | 5 | remove it | Retired with the old pasted Chrome DevTools MCP skill group; reinstall only for a dedicated `chrome-devtools-mcp` CLI workflow. |
| x | codegraph | Weak | 3 | remove it | Removed as a standalone Local Skill; CodeGraph remains available through Pi's native graph-first tooling and global guidance. |
| ✓ | context-mode | Weak | 3 | keep it | Retained because core local context-saving behavior is tool-specific and important. |
| x | context-watcher | Weak | 2 | remove it | Retired from the old pasted skills to avoid a broad orchestration runtime skill; preserve routing guidance in global/project instructions instead. |
| x | context7-cli | Medium | 5 | remove it | Retired because docs lookup can use normal research tools and Context7 skill/setup workflows are not frequent enough to justify a runtime skill. Reinstall only for a dedicated `ctx7` workflow. |
| ✓ | crit | Medium | 5 | keep it | Retained because the interactive inline review loop is local tool-specific and benefits from exact CLI behavior. |
| ✓ | crit-cli | Medium | 5 | make it slim | Slimmed to local/hosted action gates, task routing, correctness, and completion; exact commands, JSON schemas, and niche review semantics live in a selective runtime reference. Interactive review remains explicit crit. |
| ✓ | ctx-doctor | Strong | 8 | keep it | Retained as package-provided metadata-only helper; full body loads only when triggered. |
| ✓ | ctx-insight | Strong | 8 | keep it | Retained as package-provided metadata-only helper; full body loads only when triggered. |
| ✓ | ctx-purge | Good | 7 | keep it | Retained as package-provided helper; destructive scope safety remains useful when triggered. |
| ✓ | ctx-stats | Strong | 8 | keep it | Retained as package-provided metadata-only helper; full body loads only when triggered. |
| ✓ | ctx-upgrade | Medium | 5 | keep it | Retained as package-provided helper; exact upgrade flow is useful when triggered. |
| x | debug-optimize-lcp | Strong | 8 | remove it | Retired with the old pasted Chrome DevTools MCP skill group; handle LCP work with Pi browser tools plus focused performance docs when needed. |
| ✓ | developing-genkit-dart | Low | 4 | make it slim | Slimmed to Dart-specific routing, version checks, hosted-call safety, Schemantic guidance, and scoped validation; plugin details and optional CLI setup live in references. Retained local snapshot. |
| ✓ | developing-genkit-go | Low | 4 | make it slim | Slimmed to Go API routing, registry/middleware constraints, hosted-call safety, and scoped checks; Hello World and CLI commands moved to getting-started. Retained local snapshot. |
| ✓ | developing-genkit-js | Medium | 6 | make it slim | Slimmed to version checks, hosted-service safety, reference routing, CLI reminders, and validation workflow. |
| ✓ | developing-genkit-python | Low | 4 | make it slim | Slimmed to Python-specific API/error routing, version checks, hosted-call safety, and scoped validation; setup examples preserve the Python 3.10+ floor and project pins. Retained local snapshot. |
| x | delegated-pi-loop | Weak | 3 | remove it | Replaced by the native TypeScript `delegate_run` extension, which owns route policy, bounded supervision, live last-event timestamps, read-only fingerprints, and single-mutator safety. |
| ✓ | directus-browser | Medium | 5 | keep it | Retained the niche Studio root with explicit Browser Harness setup inheritance, UI-first mutation gates, read-only same-origin GET access, and Directus vocabulary/navigation. |
| x | edge-case-analysis | Very strong | 9 | remove it | Generic reasoning task; no special local tooling needed. |
| ✓ | figma | Low-medium | 4 | keep it | Retained as the minimal MCP setup/context router for tool-specific fetching and read-only boundaries; implementation belongs to figma-implement-design. |
| ✓ | figma-create-design-system-rules | Strong | 8 | make it slim | Slimmed to project rule authoring, platform-neutral file selection, safety, and completion; templates and examples live in references, not a duplicated implementation workflow. |
| ✓ | figma-implement-design | Medium | 6 | make it slim | Slimmed to the sole implementation workflow owner: context plus screenshot gate, project component/token reuse, supplied assets, and completion checks; detailed examples and troubleshooting live in references. |
| ✓ | firebase-ai-logic-basics | Medium | 5 | make it slim | Slimmed to hosted-service safety, platform routing, reference links, and production reminders. |
| ✓ | firebase-app-hosting-basics | Medium | 5 | make it slim | Slimmed to App Hosting boundaries, mutation gates, config references, and deploy validation. |
| ✓ | firebase-auth-basics | Good | 7 | make it slim | Slimmed to auth mutation gates, platform references, emulator validation, and rules handoff. |
| ✓ | firebase-basics | Medium | 6 | make it slim | Slimmed to Firebase CLI setup, local-state safety, product routing, and reference navigation. |
| ✓ | firebase-data-connect | Weak | 3 | make it slim | Slimmed to Data Connect / SQL Connect routing, GraphQL/Native SQL choice, exact deployment gates, and local validation; schema, realtime, SDK, YAML, and CLI details remain in selected references. |
| ✓ | firebase-firestore | Medium | 6 | make it slim | Slimmed to config-first target/edition decisions, selective Standard/Enterprise references, and scoped completion; provisioning stays explicitly gated and a missing database never authorizes creation. |
| ✓ | firebase-hosting-basics | Good | 7 | make it slim | Slimmed to Hosting Classic boundaries, deploy gates, config references, and emulator validation. |
| ✓ | firebase-security-rules-auditor | Medium | 6 | make it slim | Slimmed to Firestore-only audit boundaries and completion; concrete checks and structured scoring live in a reference, with admin-email acceptance conditional on verified requirements. |
| x | gh-address-comments | Medium | 6 | remove it | Retired because exact GitHub comment URLs map directly to `gh api`, and the PR-wide workflow caused over-broad routing. |
| ✓ | gh-cli | Strong | 8 | make it slim | Slimmed to auth, safety, URL normalization, runtime workflow, and reference navigation; command library moved to `references/index.md`. |
| ✓ | grill-with-docs | Strong | 8 | keep it | Retained as a compact, bounded plan/domain grilling skill with read-only default, explicit documentation-write gates, and shared glossary/context-map/ADR formats. |
| x | humanizer | Very strong | 9 | remove it | Writing style cleanup is generic and memory-native. |
| ✓ | improve-codebase-architecture | Strong | 8 | keep it | Retained as a compact CONTEXT.md/ADR-grounded architecture assessment with a deliberate candidate pause; selected-candidate exploration stays read-only without explicit change instructions. |
| ✓ | impeccable | Weak | 3 | keep it | Installed as an explicit-only, locally adapted frontend design workflow with bundled detectors, visual iteration scripts, safety gates, and Pi compatibility overlays. |
| ✓ | intent-layer | Medium | 6 | keep it | Installed from Crafter Station for hierarchical `AGENTS.md` context setup, measurement scripts, and compact node templates. |
| ✓ | librarian | Medium | 6 | keep it | Retained because source-citation and library-internals research workflow is useful when triggered. |
| ✓ | linear-cli | Medium | 5 | make it slim | Slimmed to mutation gates, discovery workflow, reference routing, Markdown/body-file rules, known gotchas, and GraphQL fallback safety. |
| x | memory-leak-debugging | Strong | 8 | remove it | Retired with the old pasted Chrome DevTools MCP skill group; use ad hoc heap tooling and docs lookup when a leak task appears. |
| x | mmx-cli | Weak | 3 | remove it | Removed because MiniMax is niche in this setup and not used often enough to justify a dedicated runtime skill. |
| ✓ | mysql | Strong | 8 | make it slim | Slimmed to MySQL/InnoDB design and diagnosis intent, proportional discovery, exact production/destructive gates, evidence, and selected references; ordinary app code is not a trigger. |
| ✓ | nlm-skill | Weak | 3 | make it slim | Slimmed to intent routing, CLI/MCP choice, exact action/target gates, correctness, and completion; command/workflow details stay in selected references with auth, deletion, Studio confirmation, and remote MCP safety intact. |
| ✓ | notion | Medium | 5 | make it slim | Slimmed to official `ntn` workspace intent, read-only defaults, exact write authority, separate install/auth gates, and selected workflow recipes; bare mentions and companion writes do not expand scope. |
| x | notion-cli | Medium | 5 | remove it | Standalone predecessor remains retired; superseded by the active combined `notion` skill. |
| ✓ | pi-browser-harness | Weak | 3 | make it slim | Slimmed to per-task user setup consent, profile/account and login boundaries, tool routing, and completion; tool catalogs, diagnostics, and script APIs live in references, with screenshots visual-only. |
| ✓ | postgres | Strong | 8 | make it slim | Slimmed to PostgreSQL database design, tuning, and operations with proportional discovery and production safety; ordinary app code and Data Connect product work do not imply PostgreSQL diagnosis. |
| ✓ | pp-klaviyo | Medium | 5 | make it slim | Installed from Printing Press for exact Klaviyo CLI routing, customer-data controls, and hosted-service mutation gates. |
| ✓ | pp-posthog | Medium | 5 | make it slim | Installed from Printing Press for exact PostHog CLI routing, local sync/search, and hosted-service safety gates. |
| x | refine-linear-task | Very strong | 9 | remove it | Generic issue-writing task; no skill needed. |
| ✓ | ruff | Strong | 8 | make it slim | Commands are simple; keep only preferred invocation. |
| ✓ | session-handoff | Medium | 6 | make it slim | Slimmed to explicit create/load intent, project-local document authorization, read-only resume verification, and completion; commands/chaining live in a runtime reference, with scaffold, validation/security, and staleness checks preserved. |
| ✓ | skill-creator | Medium | 6 | keep it | Retained as the foundational unified skill creator: OpenAI scaffolding, Anthropic evaluation methodology, and Pi-native isolated execution. |
| x | tdd | Very strong | 9 | remove it | Generic methodology; no installed skill needed. |
| x | troubleshooting | Medium | 6 | remove it | Retired with the old pasted Chrome DevTools MCP skill group; reinstall only when maintaining `chrome-devtools-mcp` itself. |
| ✓ | ty | Medium | 6 | make it slim | Newer Python type checker; keep exact command guidance. |
| x | understand | Low-medium | 4 | remove it | External/symlinked suite; remove unless actively used. |
| x | understand-chat | Low-medium | 4 | remove it | Same as above; overlaps with CodeGraph/Context Mode tools. |
| x | understand-dashboard | Low-medium | 4 | remove it | Same as above; optional visualization only. |
| x | understand-diff | Low-medium | 4 | remove it | Same as above; diff analysis can use existing tools. |
| x | understand-domain | Low-medium | 4 | remove it | Same as above; domain extraction is not core. |
| x | understand-explain | Low-medium | 4 | remove it | Same as above; explanation can use normal code tools. |
| x | understand-knowledge | Low-medium | 4 | remove it | Same as above; niche knowledge graph workflow replaced by CodeGraph. |
| x | understand-onboard | Low-medium | 4 | remove it | Same as above; onboarding can be done with CodeGraph or normal code tools. |
| ✓ | uv | Good | 7 | make it slim | Slimmed to uv command/configuration work and execution/dependency handling in uv projects; preserve manager detection, invocation conventions, and mutation/install/migration gates without routing all Python code. |
