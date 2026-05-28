# Installed Pi Skills Trim Verdict

Basis: rating means how well I can do the task from base model memory without the skill. I recommend keeping skills when they encode local/custom tooling, exact MCP/CLI workflows, or safety-critical procedures.

Status legend: blank = not addressed yet; `✓` = addressed and retained/slimmed; `x` = addressed and removed.

| Status | Skill | How good without skill | Rating | Action | Verdict |
|---|---|---:|---:|---|---|
| ✓ | a11y-debugging | Strong | 8 | make it slim | Slimmed to Chrome MCP a11y workflow, browser mutation safety, large-output handling, and snippet references. |
| ✓ | chrome-devtools | Good | 7 | make it slim | Slimmed to MCP page workflow, tool selection, browser mutation gates, and troubleshooting handoff. |
| ✓ | chrome-devtools-cli | Medium | 5 | make it slim | Slimmed to CLI command shape, command groups, Context Mode routing, setup gate, and gotchas. |
| ✓ | codebase-memory-mcp | Weak | 3 | keep it | Retained because the custom MCP protocol and project/index rules need explicit guidance. |
| ✓ | context-mode | Weak | 3 | keep it | Retained because core local context-saving behavior is tool-specific and important. |
| ✓ | context-watcher | Weak | 2 | keep it | Retained because this is core orchestration and safety policy for this Pi setup. |
| ✓ | context7-cli | Medium | 5 | make it slim | Slimmed to docs lookup workflow, mutation gates for auth/setup/skills/upgrade commands, reference routing, and common gotchas. |
| ✓ | ctx-doctor | Strong | 8 | keep it | Retained as package-provided metadata-only helper; full body loads only when triggered. |
| ✓ | ctx-insight | Strong | 8 | keep it | Retained as package-provided metadata-only helper; full body loads only when triggered. |
| ✓ | ctx-purge | Good | 7 | keep it | Retained as package-provided helper; destructive scope safety remains useful when triggered. |
| ✓ | ctx-stats | Strong | 8 | keep it | Retained as package-provided metadata-only helper; full body loads only when triggered. |
| ✓ | ctx-upgrade | Medium | 5 | keep it | Retained as package-provided helper; exact upgrade flow is useful when triggered. |
| ✓ | debug-optimize-lcp | Strong | 8 | make it slim | Slimmed to LCP trace workflow, subpart bottleneck map, reference routing, and verification loop. |
| ✓ | developing-genkit-dart | Low | 4 | keep it | Retained as a compact niche/current Genkit snapshot; upstream path is absent from current `firebase/skills`. |
| ✓ | developing-genkit-go | Low | 4 | keep it | Retained for specific Genkit Go API guidance; upstream path is absent from current `firebase/skills`. |
| ✓ | developing-genkit-js | Medium | 6 | make it slim | Slimmed to version checks, hosted-service safety, reference routing, CLI reminders, and validation workflow. |
| ✓ | developing-genkit-python | Low | 4 | keep it | Retained to avoid hallucinated Python Genkit APIs; upstream path is absent from current `firebase/skills`. |
| x | edge-case-analysis | Very strong | 9 | remove it | Generic reasoning task; no special local tooling needed. |
| ✓ | figma | Low-medium | 4 | keep it | Retained because Figma MCP workflow and safety boundaries are tool-specific. |
| ✓ | figma-create-design-system-rules | Strong | 8 | keep it | Retained with the OpenAI-derived skill set; full body loads only when triggered. |
| ✓ | figma-implement-design | Medium | 6 | keep it | Retained with the OpenAI-derived skill set for Figma design-to-code workflows. |
| ✓ | firebase-ai-logic-basics | Medium | 5 | make it slim | Slimmed to hosted-service safety, platform routing, reference links, and production reminders. |
| ✓ | firebase-app-hosting-basics | Medium | 5 | make it slim | Slimmed to App Hosting boundaries, mutation gates, config references, and deploy validation. |
| ✓ | firebase-auth-basics | Good | 7 | make it slim | Slimmed to auth mutation gates, platform references, emulator validation, and rules handoff. |
| ✓ | firebase-basics | Medium | 6 | make it slim | Slimmed to Firebase CLI setup, local-state safety, product routing, and reference navigation. |
| ✓ | firebase-data-connect | Weak | 3 | keep it | Retained because newer Data Connect schema, auth, realtime, and SDK workflows need detailed guidance. |
| ✓ | firebase-firestore | Medium | 6 | keep it | Retained because Firestore rules, indexes, database creation, and edition differences are safety-sensitive. |
| ✓ | firebase-hosting-basics | Good | 7 | make it slim | Slimmed to Hosting Classic boundaries, deploy gates, config references, and emulator validation. |
| ✓ | firebase-security-rules-auditor | Medium | 6 | keep it | Retained because Firestore rules auditing benefits from strict, safety-focused review criteria. |
| ✓ | gh-address-comments | Medium | 6 | keep it | Retained with the OpenAI-derived skill set; PR comment workflow and GitHub gates are useful when triggered. |
|  | gh-cli | Strong | 8 | make it slim | I know gh well; keep only auth/safety/local conventions. |
| ✓ | grill-with-docs | Strong | 8 | keep it | Retained with remaining Matt Pocock skills for optional domain-language and ADR grilling workflows. |
| x | humanizer | Very strong | 9 | remove it | Writing style cleanup is generic and memory-native. |
| ✓ | improve-codebase-architecture | Strong | 8 | keep it | Retained with remaining Matt Pocock skills for optional CONTEXT.md/ADR-informed architecture review. |
| ✓ | librarian | Medium | 6 | keep it | Retained because source-citation and library-internals research workflow is useful when triggered. |
| ✓ | linear-cli | Medium | 5 | make it slim | Slimmed to mutation gates, discovery workflow, reference routing, Markdown/body-file rules, known gotchas, and GraphQL fallback safety. |
| ✓ | memory-leak-debugging | Strong | 8 | make it slim | Slimmed to heap snapshot safety, Chrome MCP capture flow, memlab/script analysis, and common leak references. |
| x | mmx-cli | Weak | 3 | remove it | Removed because MiniMax is niche in this setup and not used often enough to justify a dedicated runtime skill. |
| ✓ | mysql | Strong | 8 | make it slim | DB expertise is strong; keep only project/tool conventions. |
| ✓ | nlm-skill | Weak | 3 | keep it | Retained because NotebookLM CLI/MCP workflows are niche and exact enough to keep available. |
| x | notion-cli | Medium | 5 | remove it | Removed because the local `ntn` CLI output was not a good fit for routine agent workflows. |
| ✓ | postgres | Strong | 8 | make it slim | DB expertise is strong; keep only operational checklists. |
| x | refine-linear-task | Very strong | 9 | remove it | Generic issue-writing task; no skill needed. |
| ✓ | ruff | Strong | 8 | make it slim | Commands are simple; keep only preferred invocation. |
| ✓ | session-handoff | Medium | 6 | keep it | Retained because local handoff location and continuity conventions are important. |
| ✓ | skill-creator | Medium | 6 | keep it | Retained as foundational OpenAI-derived skill maintenance guidance. |
| x | tdd | Very strong | 9 | remove it | Generic methodology; no installed skill needed. |
| ✓ | troubleshooting | Medium | 6 | make it slim | Slimmed to Chrome DevTools MCP failure triage, known error patterns, configuration safety, and diagnostics. |
| ✓ | ty | Medium | 6 | make it slim | Newer Python type checker; keep exact command guidance. |
| x | understand | Low-medium | 4 | remove it | External/symlinked suite; remove unless actively used. |
| x | understand-chat | Low-medium | 4 | remove it | Same as above; overlaps with codebase-memory/context tools. |
| x | understand-dashboard | Low-medium | 4 | remove it | Same as above; optional visualization only. |
| x | understand-diff | Low-medium | 4 | remove it | Same as above; diff analysis can use existing tools. |
| x | understand-domain | Low-medium | 4 | remove it | Same as above; domain extraction is not core. |
| x | understand-explain | Low-medium | 4 | remove it | Same as above; explanation can use normal code tools. |
| x | understand-knowledge | Low-medium | 4 | remove it | Same as above; niche knowledge graph workflow. |
| x | understand-onboard | Low-medium | 4 | remove it | Same as above; onboarding can be done generically. |
| ✓ | uv | Good | 7 | make it slim | I know uv fairly well; keep only preferred project commands. |
