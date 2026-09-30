# Updating Firebase skills

Purpose: keep Firebase-owned skills aligned with `firebase/skills` while preserving local Pi safety gates and OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply the [local invariants](local-skill-update-invariants.md), [slimming process](skill-slimming-process.md), and [ADR 0020](../adr/0020-gpt-6-astra-skill-maintenance-policy.md). Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility. A local policy-only revision does not imply upstream synchronization.

## Source of truth

- Upstream repository: https://github.com/firebase/skills (resolves to canonical https://github.com/firebase/agent-skills).
- **Increment 10, basics only, 2026-09-30:** compared `skills/firebase-basics/SKILL.md` and all 19 references at exact commit `daaf0e1577b2d4ac23cfa9d31f421178ef229735` (commit date `2026-09-28T18:55:10Z`). Authenticated `gh` resolved the commit and tree; all 20 downloaded blobs matched their Git blob SHA-1. This is a selective local merge, not a full upstream overwrite.
- **Active npm-global CLI:** independently confirmed `15.29.0`, then upgraded to exact `15.32.0`. Basics help/version was checked in isolation. This does not establish product behavior or compatibility for the other skills.
- **Increment 11, Auth and Firestore only, 2026-09-30:** compared both roots and all upstream references at exact commit `daaf0e1577b2d4ac23cfa9d31f421178ef229735`. Authenticated `gh` resolved the canonical commit/tree; all 21 downloaded blobs matched their Git blob SHA-1. Reviewed local UI metadata and both retained Firestore rules references as overlays. See the [subset decisions and limits](#increment-11-auth-and-firestore-subset).
- **Increment 12, remaining five Firebase skills only, 2026-09-30:** authenticated `gh` GET resolved current canonical `main` to the same commit, `daaf0e1577b2d4ac23cfa9d31f421178ef229735`. Compared all 30 upstream runtime files with the 34 retained local files before editing. AI Logic and Data Connect received selective changes; App Hosting, Hosting Classic, and the auditor had no runtime changes. See the [source inventory and decisions](#increment-12-remaining-five-firebase-skills).
- **Historical family record, not advanced:** `073edf7bb747c27b9c911a9126adaa5bc4648fdc`, with CLI `15.26.0`. Increment 17 reverified the four Genkit paths' absence, not a replacement source or synchronization. Keep the Firebase subset records separate; they do not establish Genkit or family-wide synchronization.

The historical comparison reported that `developing-genkit-*` paths were absent from `firebase/skills`. Increment 17 confirms their continued absence in that canonical tree. Increment 18 verifies the separate `genkit-ai/skills` mapping and selectively synchronizes JS/Go only. Increment 19 compares the complete Dart/Python subtrees at the same pin and selectively synchronizes those skills. Together these subsets complete source comparison of all four Genkit skills, not SDK/runtime validation. Increment 10 did not reverify their source, change them, or infer that they should be removed.

| Local skill | Source mapping | Reviewed-subset provenance |
| --- | --- | --- |
| `developing-genkit-dart` | `genkit-ai/skills`, `skills/developing-genkit-dart/` | Verified mapping and selective source merge in Increment 19 at `cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6`; old Firebase path absence remains historical |
| `developing-genkit-go` | `genkit-ai/skills`, `skills/developing-genkit-go/` | Verified mapping and selective source merge in Increment 18 at `cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6`; old Firebase path absence remains historical |
| `developing-genkit-js` | `genkit-ai/skills`, `skills/developing-genkit-js/` | Verified mapping and selective source merge in Increment 18 at `cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6`; old Firebase path absence remains historical |
| `developing-genkit-python` | `genkit-ai/skills`, `skills/developing-genkit-python/` | Verified mapping and selective source merge in Increment 19 at `cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6`; old Firebase path absence remains historical |
| `firebase-ai-logic-basics` | `skills/firebase-ai-logic-basics/` root and four references | Selectively synchronized in Increment 12 at `daaf0e1577b2d4ac23cfa9d31f421178ef229735` |
| `firebase-app-hosting-basics` | `skills/firebase-app-hosting-basics/` root and three references | Compared in Increment 12 at `daaf0e1577b2d4ac23cfa9d31f421178ef229735`; no runtime change |
| `firebase-auth-basics` | `skills/firebase-auth-basics/` root and five references | Selectively synchronized in Increment 11 at `daaf0e1577b2d4ac23cfa9d31f421178ef229735` |
| `firebase-basics` | `skills/firebase-basics/` root and references | Selectively synchronized at `daaf0e1577b2d4ac23cfa9d31f421178ef229735` |
| `firebase-data-connect` | `skills/firebase-data-connect-basics/` root, examples, templates, and 14 references | Selectively synchronized in Increment 12 at `daaf0e1577b2d4ac23cfa9d31f421178ef229735`; local folder retained |
| `firebase-firestore` | `skills/firebase-firestore/` root and 14 upstream references; two local rules overlays retained | Selectively synchronized in Increment 11 at `daaf0e1577b2d4ac23cfa9d31f421178ef229735` |
| `firebase-hosting-basics` | `skills/firebase-hosting-basics/` root and two references | Compared in Increment 12 at `daaf0e1577b2d4ac23cfa9d31f421178ef229735`; no runtime change |
| `firebase-security-rules-auditor` | `skills/firebase-security-rules-auditor/SKILL.md` | Compared in Increment 12 at `daaf0e1577b2d4ac23cfa9d31f421178ef229735`; no runtime change |

## Increment 17 Genkit retained-source status

Authenticated `gh` GET resolved `firebase/skills` to `firebase/agent-skills`, default branch `main`, commit `daaf0e1577b2d4ac23cfa9d31f421178ef229735`, tree `45a3e1c2e8ec436827e1dfd8fe8c86c781fad739`. The complete 155-entry recursive tree contains none of the four mapped `skills/developing-genkit-*` paths and no Genkit-named path. The repository README and all 13 skill roots were checked with verified blob identities; no clearly mapped replacement exists in this repository. Basics includes an external `genkit-ai/skills` installer pointer. That pointer is not a verified move or a per-skill mapping; investigating or adopting that repository requires parent review.

**Result for each of Dart, Go, JS, and Python: retained path absent, no runtime edit.** All local roots, references, and UI metadata remain byte-identical. No new origin was searched, no official moved source was inferred, and no snapshot was retired. Target/all 38 validators, metadata/changed links, scoped diff/secret/artifact checks, and runtime/index preservation fingerprints passed. No Genkit/Firebase command, live API/model call, authentication, installation, or build ran. These checks close the mapped-repository absence check only; current replacement-source and SDK/runtime compatibility remain unverified. Earlier accepted Firebase subset records below remain unchanged.

## Increment 18 Genkit JS and Go source subset

The verified replacement origin is [genkit-ai/skills](https://github.com/genkit-ai/skills), canonical repository identity, default branch `main`, not archived. Firebase Basics at `daaf0e1577b2d4ac23cfa9d31f421178ef229735` explicitly points to this repository; its README explicitly maps all four language names to `skills/developing-genkit-{js,go,dart,python}/`. This establishes the source linkage, not authority to run its installers or copy every file. The parent verified current `main`; this increment independently fetched the exact [commit cbb4df3](https://github.com/genkit-ai/skills/commit/cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6), dated `2026-09-29T16:47:46Z`, message `fix: add versioning for google/skill standards (#38)`.

Authenticated `gh api --method GET` fetched the explicit Git tree `bcf8923ff171442c5e1354a001675be1f3cd9a48`, with `truncated: false`, the README, and every blob under the JS/Go paths. All 40 blobs matched their Git SHA-1: 39 runtime files plus README. The commit's actual tree SHA, not a branch endpoint's response SHA, defines this inventory. No scripts, assets, or UI metadata exist in either upstream subtree; local `agents/openai.yaml` files remain overlays. Both runtime folders were clean before editing.

### Complete reviewed source inventory

Paths below are relative to each `skills/developing-genkit-<language>/` directory at the exact pin. Source-only files were compared and classified, not silently installed. Temporary evidence retains complete downloads, the path/blob inventory, pre-edit local files, per-file source/local diffs, and the increment-only diff.

| Language | Complete upstream files | Subtree / root blob |
| --- | --- | --- |
| JS | 20: `SKILL.md`; `references/{a2ui,agents,agents-artifacts,agents-background,agents-branching,agents-custom,agents-deployment,agents-human-in-the-loop,agents-multi-agent,agents-sessions,agents-state,best-practices,common-errors,docs-and-cli,dotprompt,examples,middleware-custom,middleware,setup}.md` | Subtree `e96efecfd2b9e349974e72e5003caa39274b2591`; root `8f77ade579fa88c0a83bf8951340c9f8d5df19f5` |
| Go | 19: `SKILL.md`; `references/{a2ui,agents,agents-artifacts,agents-background,agents-branching,agents-custom,agents-deployment,agents-human-in-the-loop,agents-multi-agent,agents-sessions,agents-state,flows-and-http,generation,getting-started,middleware,prompts,providers,tools}.md` | Subtree `6e83e215f9e9de4dc5282cf30d5667096e87fd44`; root `5241e8b444013baf6d4f1a20f10f7caa9a9b6a58` |

### Adopt, adapt, reject, and no-op

| Input | JS/Go subset decision |
| --- | --- |
| JS Dotprompt and middleware / custom middleware | Adopt selected callable/stream/render APIs, named schemas, variants/partials, frontmatter fields, `use` factories and named plugin registration. Combine middleware/custom hooks into one compact reference instead of duplicate catalogs. Adapt side-effect, retry-cost, filesystem, approval, and secret boundaries. Keep optional packages behind requested dependency work. |
| Go `.prompt` tool-loop and middleware fields | Adopt field mappings, registered-name resolution, and plugin registration. Adapt upstream's stale `github.com/firebase/genkit/go/plugins/middleware` import to the existing `github.com/genkit-ai/genkit/go/plugins/middleware` path. Omit the unconfigured fallback sample. Keep schemas and existing prompt APIs unchanged. |
| New agent APIs | Adapt one compact reference per language: JS `genkit/beta` and `genkit/beta/client`, source floor `>=1.39.0`; Go `genkit/exp`, `ai/exp`, and required `WithExperimental()`. Preserve turns, state round-tripping, Go invocation-error versus failed-turn distinction, registry/tool semantics, and local version checks. Do not require every conversational app to migrate or upgrade. |
| CLI lifecycle and traces | Adopt persistent `start`/`--noui`, explicit-input one-shot `flow:run`, runtime command after `--`, non-interactive flag placement, flow-versus-agent distinction, and JSON trace output. Adapt optional installed/pinned CLI selection, reviewed startup, bounded/redacted traces, and exact live/evaluation gates. No CLI execution or compatibility claim. |
| JS setup changes | Adapt existing initialization reuse, task-specific setup, and optional scripts. Reject fixed tutorial goals, forced CLI/runner installation, default provider changes, and mandatory trace-based live validation. Preserve the existing initialization code/model pin and framework conventions. |
| Version metadata, latest aliases, installation and mandatory CLI policies | Reject upstream frontmatter metadata, skill installers, CLI upgrades, forced dependency pins/aliases, and platform tooling mandates. Keep local two-key frontmatter and exact-token UI metadata. JS retains precise SDK-language routing, not generic AI work. |
| Existing Go core references | No-op: `flows-and-http`, `generation`, `middleware`, `providers`, and `tools` match source byte-for-byte. Retain the local getting-started Hello World and authorization overlays. |
| Existing JS generation/error/practice examples | No-op: source differences mostly select moving model aliases, alter setup wording, or add CLI instructions now handled in the selected references. Keep `examples`, `common-errors`, and `best-practices` unchanged; no blanket model or SDK upgrade. |
| Specialist source-only catalogs | Do not install `a2ui` or separate agent artifact/background/branching/custom/deployment/HITL/multi-agent/session/state catalogs. Selected pinned session/interrupt/serving links cover deeper lookup without duplicate local catalogs. Authentication/session-ownership gates precede serving advice; do not import unauthenticated production recipes, auto-approved shell tools, or raw state logging. |

Both skills remain `make it slim`. Roots remain selective routers; matching language names, maintenance links, tool/schema/provider/flow semantics, and metadata tokens remain intact. Dart/Python content comparison and synchronization are explicitly deferred to the next increment. Their table rows above retain Increment 17's reviewed-subset status, not a claim that this README lacks a mapping. Historical `073edf7bb747c27b9c911a9126adaa5bc4648fdc` and current Firebase path absence are not a synchronization baseline for the new repository. No earlier Firebase subset record is advanced.

### Increment 18 checks and limits

Target validators and all 38 installed Local Skill validators passed using an existing cached Python/PyYAML environment without installation. All 38 YAML/frontmatter, exact single prompt tokens, and UI description lengths passed. Changed local Markdown links/anchors, scoped diff/secret/home-path/artifact checks, unrelated-file fingerprints, and Git index preservation passed; the pre-existing ignored skill-creator bytecode cache was preserved.

Parser-only checks covered the actual changed examples: Go fragments through installed `gofmt`, JS/TypeScript through Node's built-in type stripping and module parser without module linking/evaluation, prompt frontmatter through PyYAML, and shell snippets through `bash -n` with documented angle-bracket placeholders substituted. These are syntax checks, not SDK type checks. Source-derived assertions cover beta/experimental entrypoints, Go field mappings and registry imports, middleware hook signatures, prompt call/stream/render behavior, state round-tripping, error distinctions, CLI lifecycle, and preserved model/dependency pins. Temporary check helpers and extracted snippets stay outside the repository; no persistent test matrix was added.

Static positive/near-miss cases cover Genkit JS versus Go errors, generic AI requests versus SDK-specific work, Dotprompt render-only tasks, compatible beta agents versus older pinned projects, stateless flows versus multi-turn state, named middleware resolution, and local documentation checks versus provider calls. New store/serving guidance does not authorize hosted writes or expose unauthenticated sessions. Static review does not prove model compliance.

Inherited examples outside the changed scope remain limitations: Go's HTTP context-provider example trusts `X-User-Id`, tool-interrupt examples are not transaction authorization, and middleware examples can print message content or enable filesystem writes. JS's unchanged error/practice references contain model-selection mandates and schematic/incomplete snippets. Root gates still apply, but this increment does not redesign those references or claim production security. SDK type compatibility, native builds, plugin/runtime behavior, provider/model availability, and live routing remain untested. No installs, builds, upgrades, environment sync, Genkit/Firebase CLI/product invocation, SDK execution, auth/config access, provider/model/browser/daemon action, or hosted/Git write ran. Parent owns review and separately approved tooling work.

## Increment 19 Genkit Dart and Python source subset

This subset uses Increment 18's accepted canonical repository/README mapping and current-main proof at `cbb4df32dedd2e2140a71550c3ae6ece7a18fdb6` (`2026-09-29T16:47:46Z`), actual complete tree `bcf8923ff171442c5e1354a001675be1f3cd9a48`. Source discovery was not repeated. Authenticated `gh api --method GET` fetched every blob in the Dart/Python subtrees by exact Git blob identity; all 40 downloads matched their Git SHA-1. Both runtime folders were clean before editing. Temporary evidence retains the complete path/hash inventories, before files, source-to-before/after diffs, per-file decisions, checks, preservation fingerprints, and increment-only diff.

### Complete reviewed inventory

Paths are relative to each `skills/developing-genkit-<language>/` at that exact pin. Neither subtree contains scripts, assets, installers, or UI metadata; local `agents/openai.yaml` files remain unchanged overlays.

| Language | Complete upstream files | Subtree / root blob |
| --- | --- | --- |
| Dart | 23: `SKILL.md`; `references/{a2ui,agents,agents-artifacts,agents-background,agents-branching,agents-custom,agents-deployment,agents-human-in-the-loop,agents-multi-agent,agents-sessions,agents-state,dotprompt,genkit,genkit_anthropic,genkit_chrome,genkit_firebase_ai,genkit_google_genai,genkit_mcp,genkit_middleware,genkit_openai,genkit_shelf,schemantic}.md` | Subtree `a4d9193efc6992207f91373d34fb5cc027569dc5`; root `0339e5bc7507c3a989c6801c9a982a572efdee0e` |
| Python | 17: `SKILL.md`; `references/{agents,agents-artifacts,agents-background,agents-branching,agents-custom,agents-http,agents-human-in-the-loop,agents-sessions,agents-state,common-errors,dev-workflow,dotprompt,evals,examples,fastapi,setup}.md` | Subtree `0c055cbec43ce01c64938fb142e2054a9c0a9e6c`; root `4dc8a3e7719bdab171774f65139c421ab9fd3602` |

### Adopt, adapt, reject, and no-op

| Input | Dart/Python subset decision |
| --- | --- |
| Dart core/tool/middleware behavior | Adopt current `ToolResult` success wrapping and approval `.restart(...)` nesting under `metadata.resumed`, conditional on the resolved SDK. Adapt concise retry registration, failure/abort outcomes, last-good history, stable cancellation, and lazy top-level registration guidance. Preserve generation/flow schemas and existing provider/model pins; do not add retry plugins or costs to every example. |
| Dart Dotprompt | Adopt a compact call/stream/render reference with awaited loading, positional input, named JSON schemas, variants/partials, tool-loop fields, and middleware registry resolution. Preserve project model selection and generated Schemantic conventions. No duplicate prompt catalog. |
| Dart Schemantic | Adopt the separate 0.2.x builder/dev-dependency guidance and zero-output diagnostic behind requested setup/version checks. Keep existing schema examples and generator conventions; no dependency or generator command ran. |
| Agent APIs | Adapt one compact selected guide per language. Dart keeps opt-in experimental server/client/io entrypoints; Python keeps `genkit.agent` preview APIs. Preserve state ownership, no-store round-tripping, stored-history restoration, interrupts, streaming/final responses, configured middleware/plugin arrays, and exact required Dart `agents(agents: ['registeredSubAgentName'])` configuration. Reject blanket flow-to-agent migration and automatic analyzer-warning suppression. |
| Python package generation | Adopt current `genkit-*` split-package names and `genkit_*` imports in selected setup/generation/prompt/evaluation examples. Adapt explicit resolved-SDK checks and legacy `genkit-plugin-*` / `genkit.plugins.*` compatibility. Preserve existing project managers, runtime floor 3.10+, model/provider choices, lockfiles, and no-upgrade boundaries. No invented compatibility floor or automatic package replacement. |
| Python prompts/evals | Adopt packed helper arguments and awaiting the final prompt response. Separate render-only work from model calls. Adopt selected evaluator names, singular `evaluator` and `EvalResponse.root`; distinguish local deterministic evaluators from live judges. Preserve existing structured-output/tool/embedding examples and inherited judge sample instead of redesigning them. |
| Python HTTP | Adapt selected `genkit_fastapi` routers/custom request handler and nested `.run(..., on_chunk=...).response` guidance in the compact agent reference. Keep the inherited legacy decorator/parallel-flow file byte-identical except for a compatibility warning and selected-guide link. Preserve route/schema/event-loop ownership rather than force a server rewrite. Reject header-as-identity and unauthenticated production recipes. |
| Optional CLI lifecycle | Adopt persistent `start`/`--noui`, explicit-input one-shot flow commands, `--non-interactive` before `--`, and JSON trace output. Adapt installed/pinned CLI selection, startup review, bounded/redacted traces, and live-call authorization. No CLI invocation or mandatory live validation. |
| Dart provider/MCP catalogs | No-op locally: Chrome/Shelf match source byte-for-byte; retain Anthropic, Firebase AI, Google GenAI, OpenAI, and MCP files unchanged. Reject moving model aliases and blanket retry changes. New typed provider catalogs, reasoning/telemetry details, and transport recipes remain deeper source material, not required additions to local runtime guidance. |
| Specialist source-only files and root mandates | Reject duplicate A2UI/artifact/background/branching/custom/deployment/delegation/session/state catalogs; selected pinned session/state/interrupt/HTTP links support deeper lookup. Reject upstream metadata/version fields, installers, automatic CLI/SDK upgrades, platform tooling mandates, mandatory Dev UI/traces, unsafe auto-approved tools, raw state logging, and secret persistence. Keep precise language-specific triggers, two-key frontmatter, compact routers, exact names/UI tokens, and hosted-action gates. |

Both skills remain `make it slim`; no inventory reclassification or new maintenance document was needed. Increment 18's Dart/Python deferral is historical and closed by this subset. Its JS/Go files and accepted records, Increment 17's absence record, and all Firebase subset/history/policy records remain unchanged. The two Genkit subsets compare all **79 runtime source files** across four skills at this pin (39 JS/Go plus 40 Dart/Python). This is selective documentation synchronization, not family-wide Firebase provenance advancement or SDK/runtime validation.

### Increment 19 checks and limits

Both target validators and all 38 installed Local Skill validators passed using the existing cached offline Python/PyYAML environment without installation or synchronization. All 38 frontmatter/YAML, exact single prompt tokens, and UI description lengths passed. Changed local links/anchors and pinned source links, Git diff checks, secret/home-path/artifact scans, complete inventories/blob identities, source-derived semantic assertions, unchanged local-file fingerprints, unrelated work, the ignored skill-creator cache, and the Git index passed preservation checks.

Actual changed Python fences compiled in memory with top-level-await support; no bytecode files, SDK imports, or runtime execution were used. Changed shell examples passed `bash -n`; new Dart prompt frontmatter parsed with PyYAML. Dart examples received source-derived/static checks only: no Dart SDK/compiler/analyzer was started. Syntax checks do not establish SDK type compatibility. Static routing cases distinguish Dart/Flutter from Python import errors, generic AI work from Genkit-specific requests, render-only work from live calls, existing flows from optional agents, stored versus client-owned state, legacy versus split-package APIs, and authorized local edits from hosted actions. Static review does not prove model compliance.

Inherited limitations outside the selected API changes remain: Dart MCP examples contain schematic schema/transport calls and bare model IDs; middleware filesystem examples can enable writes; Anthropic examples print message content. Python's legacy FastAPI examples expose unauthenticated public routes and use version-sensitive nested calls; generation examples print media URLs; the inherited judge assumes numeric output. Root gates and new compatibility warnings apply, but these examples were not redesigned or established as production-safe. Native parsing/builds, generated-schema compilation, SDK type/runtime compatibility, provider/model availability, and live routing remain untested.

No install, Cargo/native build, package/CLI/SDK upgrade, environment sync, Genkit/Firebase CLI/product call, SDK execution, authentication/config/credential access, live model/provider/API call, browser/daemon action, hosted write, Git transition, or delegation ran. Parent owns separately authorized tooling/runtime work and later review.

## Increment 10 package and source decisions

Official [npm metadata](https://registry.npmjs.org/firebase-tools/15.32.0) identifies `firebase-tools@15.32.0` with repository `firebase/firebase-tools`. The [v15.32.0 release](https://github.com/firebase/firebase-tools/releases/tag/v15.32.0) was published `2026-09-28T19:48:00Z`. Its annotated tag resolves to registry `gitHead` `2b3a61f93d1273adf5874b10d71a8d51e4b3da23`. Tag identity matched; GitHub reported the tag signature as unverified. No independent SLSA attestation check was performed.

The [official tarball](https://registry.npmjs.org/firebase-tools/-/firebase-tools-15.32.0.tgz) passed both digest checks:

- SHA-512 integrity: `sha512-yp0SOQFALo3q2K2/pBmWTrAM4C0503zK3UJ5IDQzr4o7i+5RKh3ZPX4RTkumCFt3STtI7EuR61M8tDJjNZmTYg==`
- SHA-1 shasum: `561c60680c137da07a704fd59ac38d6dc5098cf4`
- Both registry signature entries verified against the [npm signing keys](https://registry.npmjs.org/-/npm/v1/keys), key ID `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`, using payload `<name>@<version>:<dist.integrity>`.

The published manifest has no lifecycle scripts, 70 direct dependencies, and Node constraint `>=20.0.0 || >=22.0.0 || >=24.0.0`. Active Node `v24.18.0` and npm `12.0.2` satisfy the runtime requirement. Registry bin normalization removes `./`; dependency object key order also differs. Compare normalized paths and dependency values, not JSON serialization order. Archive paths were checked for traversal and links before extraction. All 982 installed package files matched the verified archive afterward.

### CLI installation and isolated help

Resolve the active executable, npm prefix, and package manifest without starting Firebase. A skill-only update does not authorize a package upgrade. For this approved update, the existing npm-global mechanism was:

```bash
npm install --global --prefix "$node_prefix" --registry=https://registry.npmjs.org \
  --ignore-scripts --no-audit --no-fund --update-notifier=false --save-exact firebase-tools@15.32.0
```

Use an empty temporary cwd, an allowlisted environment, isolated HOME/XDG/npm cache, and distinct empty `NPM_CONFIG_USERCONFIG` and `NPM_CONFIG_GLOBALCONFIG` files. Set `CI=1`, `NO_UPDATE_NOTIFIER=1`, and browser-download suppression variables. The dry run confined every planned path to `firebase-tools`; installation reported 671 changed packages and one removed nested dependency. Nested lifecycle hooks, including `re2` installation and `protobufjs` postinstall, were disabled. No browser, emulator, or separate binary download ran. npm emitted dependency deprecation warnings; this update did not run audit fixes or alter unrelated packages.

Inspect startup before help/version. `lib/bin/firebase.js` checks the runtime and dispatches to `lib/bin/cli.js`; configstore initialization, logging, and `fetchMOTD()` occur before help parsing. `CI=1` stops MOTD fetching. `NO_UPDATE_NOTIFIER=1` disables notifier configuration and its detached update process. Fresh config leaves usage collection disabled, but these flags alone do not isolate user state. Commander handles help before command actions; `lib/bin/progressiveHelp.js` builds grouped namespace help.

The check sandbox used Bubblewrap with separate network/PID/IPC/UTS namespaces, `--clearenv`, read-only system libraries and Node prefix, no host homes or repository mount, and fresh tmpfs HOME/XDG/cwd. A preflight confirmed a different network namespace, absent host home, and empty config. Only these 12 distinct help/version forms ran (root help was captured twice):

- `--version`, `--help`, `help --help`
- `apps --help`, `apps:sdkconfig --help`, `apps:create --help`, `apps:list --help`
- `projects --help`, `projects:create --help`, `login --help`, `use --help`, `init --help`

All passed. No login/logout, account/project listing, active-project selection, initialization, deployment, emulator, database, or product action ran. No Firebase/GCP API, account, credential, live model, browser, or MCP session was accessed.

### Adopt, adapt, and retain

| Input | Decision for basics only |
| --- | --- |
| Android source adds existing-config detection and Google services Gradle plugin setup | Adapt: inspect the module, app identity, and variant config first; show project/module plugin wiring. Preserve compatible pins, version catalogs, and convention plugins instead of forcing latest versions. |
| Android project/app creation and config retrieval | Retain separate exact action/target gates. Missing config does not authorize creation. Use identified existing App ID/project and verified `apps:sdkconfig --out` for a requested local write; preserve existing files. |
| Installed grouped help and setup flags | Adopt root → namespace → leaf discovery, colon-separated leaf names, command-scoped `--project`, Android/iOS identifier flags, and `--out` semantics. Do not copy the full product command catalog. |
| Upstream root/local setup mandates login, latest CLI, active-project inspection, MCP, and full skill installation | Reject mandatory setup. Keep reference-first task selection, installed/repository-pinned CLI selection, no automatic installation, and no live account/project inspection for local maintenance. |
| Existing Web/iOS/Flutter/service references versus upstream | Retain local gates, explicit targets, requested dependency commands, config reuse, and selective initialization. Upstream differences mostly remove those overlays; no wholesale import. |
| Twelve agent setup/refresh references | Compared all; upstream changes are formatting/list numbering, not useful new runtime behavior. Retain files unchanged behind an explicit, separately requested tooling gate. Their installer recipes are not Pi skill maintenance instructions. |
| 15.32.0 Functions kits, Extensions migration, and deployment fixes | Package update only; no new product workflows or behavior claims in basics. |
| Root/UI metadata and trim inventory | Keep `make it slim`, CLI-auth versus app-auth routing, two-key frontmatter, existing matching UI metadata, and compact root. No skill inventory change. |

### Increment 10 checks and limits

Run the [bounded checks below](#bounded-reference-regression-checks), the target validator, all Local Skill validators, metadata/link checks, and scoped diff/secret/home-path/artifact checks. The existing seven reference checks also inspect other family files for regression only; passing them does not mean those sources were synchronized.

The offline contract reads installed package source and help files captured in the sandbox. It never launches Firebase. Save captured help as `root.txt`, `apps.txt`, `apps_sdkconfig.txt`, `apps_create.txt`, `projects_create.txt`, `login.txt`, and `version.txt` outside the repository, then run:

```bash
uv run --offline python -B docs/skills/tests/test_firebase_basics_contract.py \
  --package-dir "$package_dir" --help-dir "$help_dir" -v
uv run --offline --with ruff ruff check --no-cache docs/skills/tests/test_firebase_basics_contract.py
```

Seven contracts passed: exact package/runtime/lifecycle metadata, grouped help/flags, Android command/config-output syntax, local-only task and installation boundaries, adjacent creation gates plus rejected ungated examples, Android config/plugin reuse and completion, and startup isolation requirements. Ruff and the existing seven bounded reference checks passed.

Target and all 38 Local Skill validators passed, including frontmatter, YAML, exact single prompt tokens, UI description lengths, and local links. All 16 local Markdown links in basics and this process resolved, including anchors. Scoped diff, secret/home-path, syntax, and artifact checks passed. Preservation fingerprints covered 3,781 existing repository files, 27,590 unrelated global-package/bin entries, and the Git index. Only the six assigned repository paths changed; `@playwright/cli@0.1.22`, other family skills, excluded prior work, and staging remained unchanged. No cache, log, or download artifact entered basics or the test folder. Root size changed from 49 lines / 2,837 characters to 45 lines / 3,817 characters; the added boundaries are deliberate, not a claim of token reduction. UI metadata and the existing `make it slim` inventory decision stayed unchanged.

Static/manual cases cover Android dependency-only changes, existing-config repair, requested config retrieval, exact new project/app registration, CLI login without a local browser, service-only initialization, and app-auth routing away from basics. Complete local deliverables without login, live discovery, new tooling, or deployment when those actions are unnecessary or unapproved. Static checks do not prove model compliance. Android builds, native dependency behavior with lifecycle hooks disabled, and live product behavior were not exercised. The other seven Firebase skills and four Genkit snapshots remain deferred.

## Increment 11 Auth and Firestore subset

The exact source is [commit daaf0e1](https://github.com/firebase/agent-skills/commit/daaf0e1577b2d4ac23cfa9d31f421178ef229735), tree `45a3e1c2e8ec436827e1dfd8fe8c86c781fad739`. All runtime files under the two upstream folders were compared: six Auth files and 15 Firestore files. There were no upstream scripts, assets, or UI metadata in these folders. The two local `security_rules.md` references are absent from this upstream Firestore subtree; retain them rather than importing the new rules-author skill/subagent dependency. Both skills remain `make it slim` with selective routing and matching exact-token UI metadata.

| Input | Increment 11 decision |
| --- | --- |
| Android setup, resolved dependencies, modern Kotlin imports, and property initialization | Adapt config/plugin reuse and Gradle dependency inspection. Preserve compatible BoM pins, catalogs, module/variant identity, offline checks, and the Basics app-config reference. Remove Auth's automatic `init auth`; do not import upstream CLI login, latest-version fetch, provisioning, or deployment prerequisites. |
| Auth platform routing and Web/Flutter domain troubleshooting | Add the existing iOS reference to the root. Adopt hostname-only authorized-domain guidance behind an exact action/domain/project gate. Fix Flutter 7.x account/token handling and await initialization before use. Keep application sign-in distinct from Basics CLI setup. |
| Auth rules and Firestore query examples | Replace blanket Auth grants with operation-specific ownership, immutable owners, schema/size validation, and bounded list queries. Preserve filters, ordering, and limits rather than bypassing indexes with unbounded client sorting. Keep audits read-only and tests local. |
| Enterprise SDK guidance | Retain named database identity across SDKs. Adopt Python client initialization and `db` reuse, Web pipeline execution/declaration guidance, and selected Android pipeline APIs. Verify APIs against the resolved SDK; reject mandatory pipeline architecture and invented compatibility claims. |
| Firestore provisioning, indexes, and rules | Preserve config-first edition/access-mode decisions, optional live discovery, and no creation on missing targets. Keep exact project/database/edition/access/location creation gates and separate deployment/service-enablement gates. Repair index example formatting without changing edition distinctions. Retain local rule checklists and explicit audit/local-validation boundaries. |
| CLI 15.32.0 source review | Read source only, never launch Firebase. Creation flags and shared options match the documented commands. Deployment preparation can create the first raw config entry before database filtering, with fallback location `nam5`; rules/index selectors can cover all configured databases. Require a reviewed single-database config and an existing target instead of relying on `--only` to isolate creation. Make Enterprise realtime defaults explicit. |
| Other runtime content and prior work | Retain unaffected examples and data-model content where differences are formatting or remove local safeguards. Preserve Increment 10 Basics/CLI work. No family-wide source claim, package upgrade, tooling installation, or new skill dependency. |

### Increment 11 checks and limits

Offline contracts live in `docs/skills/tests/test_firebase_auth_firestore_contract.py`. Use the existing `firebase-tools@15.32.0` package directory only as read-only source input:

```bash
uv run --offline python -B docs/skills/tests/test_firebase_auth_firestore_contract.py \
  --package-dir "$package_dir" -v
uv run --offline --with ruff ruff check --no-cache docs/skills/tests/test_firebase_auth_firestore_contract.py
```

The 18 contracts cover routing/completion, client-only setup, Android dependency/config reuse, current Kotlin initialization, Flutter/domain fixes, operation-specific ownership, query ordering/limits, named Enterprise targets, CLI flag declarations, deployment hazards, rejected ungated recipes, and parser-only JavaScript/Python snippets. The focused regressions add a source-derived optional-string fake matrix for both editions and Standard Flutter default/named selection, exact factory arguments, required instance injection, and no internal fallback. The Standard iOS Swift-fence regression checks mutually exclusive verified database selection after app configuration, required instance injection through the view and manager, the user document target, and unchanged listener cleanup. Run the existing seven [bounded reference checks](#bounded-reference-regression-checks) and the Increment 10 Basics contract against its previously captured help, not new CLI executions. Run target/all Local Skill validators plus metadata, local-link/anchor, diff, secret/home-path, artifact, and preservation checks.

Validation passed: 18 offline contracts, seven existing bounded checks, seven preserved Basics contracts, Ruff, both target validators, and all 38 Local Skill validators/metadata checks. The earlier two regressions failed before remediation (33 unittest failures) and passed afterward. The Standard iOS regression failed before its fix and passed afterward, including 26 negative fixtures for factories, optional/default/fallback injection, lifecycle removal, wrong targets, parameterless construction, and replaced tasks. The 120 fake cases cover absent selected fields, inclusive length bounds, number/null/list rejection, under/oversized strings, and independence from the unrelated literal `field` key. All 45 local Markdown links resolved, including anchors. JSON/Python and parser-only JavaScript checks, scoped diff checks, secret/home-path scans, and skill/test artifact scans passed. Focused iOS preservation fingerprints covered 3,780 untouched repository entries and the Git index with zero changes; only the three iOS remediation paths changed. Existing Swift model/write/bounded-read examples remained byte-identical. Standard iOS listener restart, removal, handle clearing, isolated deinit, identity task, and signout listener cleanup remained unchanged apart from the injected database receiver. Surrounding owner/auth/role/keys/access rules and Flutter collection operations remained byte-identical. Root diagnostics: Auth 39 lines / 2,425 characters → 46 / 3,353; Firestore 49 / 4,088 → 50 / 4,552. Added boundaries are deliberate, not a token-reduction claim.

Static/manual cases include dependency-only Android work, an existing named Enterprise database, local rules/index edits, a missing database, an exact creation request, a single-resource deployment request, and an audit-only request. Checks do not prove agent compliance or product behavior. No Firebase CLI, SDK, authentication, emulator, deployment, live API/model/browser, or live bypass test runs during this increment. Android/iOS/Flutter builds, rules compilation, and SDK runtime compatibility remain unverified. The other five Firebase skills and four Genkit snapshots remain deferred.

### Increment 11 focused Enterprise remediation

This remediation addresses three confirmed documentation findings only. It reuses the accepted source provenance above without another upstream sync. Auth and Firestore retain `make it slim`; their roots and UI metadata remain unchanged.

- Enterprise iOS now endorses named initialization only after `FirebaseApp.configure()` finishes, not lazy default initialization. Deliberately unsafe examples remain unchanged.
- Enterprise iOS now requires the caller to key `.task(id:)` to the optional authenticated UID. Source review covers `nil → A` (start), `A → B` (clear previous user data and restart), and `A → nil` (stop and clear data). Deinitialization and task cancellation do not replace identity handling. The existing listener code remains byte-identical; no view or injection rewrite was made.
- Enterprise provisioning now has one creation recipe with `--realtime-updates="<authorized-realtime-setting>"`. The preceding gate selects exactly `ENABLED` or `DISABLED` under explicit target authorization and stops on missing choice or authority. Default disclosure precedes the command. Project/database, Enterprise edition, native access, location, nondefault ID, and explicit access flags remain required. Read-only review of installed `firebase-tools@15.32.0`, `lib/commands/firestore-databases-create.js:77-109`, confirms both values and the enabled default. Source review covers each authorized value and the missing-choice stop without executing commands.

The separate propagation finding was not confirmed: existing Standard Android/Web prose qualifies default targets, and Enterprise named listener calls select the same verified target. Those references and SDK architecture remain outside this remediation.

Small assertions in two existing contract methods failed before the fix (four failing subtests) and passed afterward. All 18 offline Auth/Firestore contracts, Ruff, seven bounded reference checks, and all 38 Local Skill validators passed. Both target skills passed within the all-skill run. Validation used existing tooling and a cached Python/PyYAML environment without installation. Final checks passed: metadata for all 38 skills, nine changed-file local links/anchors, scoped diff/secret/home-path/artifact checks, unchanged Enterprise Swift fences, and preservation fingerprints for 47 files including the Git index.

The earlier Basics help captures were unavailable in this session, so its seven help-dependent contracts were not rerun; preserve their prior accepted evidence. No help was recaptured. No network, Firebase CLI/SDK/emulator/compiler, authentication, browser, hosted action, or Crit invocation ran. No Git transition occurred. Static checks do not establish runtime behavior or family completion. The working tree remains subject to parent inspection and the mandatory three-review gate.

## Increment 12 remaining five Firebase skills

Authenticated `gh api --method GET` resolved `firebase/skills` to `firebase/agent-skills`, then fetched `commits/main` and the complete recursive tree. Current source remains [commit daaf0e1](https://github.com/firebase/agent-skills/commit/daaf0e1577b2d4ac23cfa9d31f421178ef229735), dated `2026-09-28T18:55:10Z`, tree `45a3e1c2e8ec436827e1dfd8fe8c86c781fad739`. All 30 downloaded runtime blobs matched their Git blob SHA-1. The temporary evidence contains commit/tree metadata, per-file path/hash inventory, source contents, pre-edit local copies, and source-to-local diffs. Comparison with historical commit `073edf7bb747c27b9c911a9126adaa5bc4648fdc` separates new source changes from existing local overlays.

### Reviewed source inventory

Paths below are relative to `skills/` at that exact commit. Every file in these five upstream folders was compared; none contains scripts, assets, or UI metadata. All five local skills retain `make it slim`, with unchanged file counts of 6/5/16/4/3 respectively.

| Upstream folder | Files and retained mapping | Subtree SHA-1 |
| --- | --- | --- |
| `firebase-ai-logic-basics/` | 5: `SKILL.md`; `references/{flutter_setup,ios_setup,usage_patterns_android,usage_patterns_web}.md`. Local UI metadata is an overlay. | `de9ed09d632cc1e3ef74f5e9b07f067fa534cfae` |
| `firebase-app-hosting-basics/` | 4: `SKILL.md`; `references/{cli_commands,configuration,emulation}.md`. Local UI metadata is an overlay. | `d7a75aba4bc9330bd8a1fc1140467eecdcd98636` |
| `firebase-data-connect-basics/` | 17: `SKILL.md`, `examples.md`, `templates.md`; `reference/{cloud_functions,config,data_seeding,native_sql,operations,realtime,schema,sdk_admin_node,sdk_android,sdk_flutter,sdk_ios,sdk_web,search,security}.md`. Local `firebase-data-connect/reference/advanced.md` retains the combined search/functions/seeding material; no duplicate references were installed. Local UI metadata is an overlay. | `8d1bf6c9bf6df8e340c23be5bbe89be2191fc53e` |
| `firebase-hosting-basics/` | 3: `SKILL.md`; `references/{configuration,deploying}.md`. Local UI metadata is an overlay. | `782daac3a406a43702380a8f14a25c1fd69a139d` |
| `firebase-security-rules-auditor/` | 1: `SKILL.md`, compared with the local router and `references/audit-checklist.md`. Local UI metadata is an overlay. | `eba78c5ff0eaad6ee63b16d429f077f81c2108bd` |

### Per-skill decisions

| Skill | Adopt/adapt/reject result |
| --- | --- |
| AI Logic | Adopt upstream Web app-variable, `candidateCount`, awaited image response, and `responseSchema` fixes; Android non-KTX imports and content builder; Swift safety/tool/schema factories. Adapt supported-model placeholders rather than forcing a moving alias. Adapt the description/UI to upstream-supported Web, Android, iOS, Flutter, and Unity, without generic Gemini or Genkit routing. Keep platform references selective and Unity linked to official setup. Reject mandatory CLI provisioning, login, automatic tooling installation, and dependency upgrades; preserve existing app/config/dependency reuse and exact action/target gates. |
| App Hosting | **No runtime change.** All four upstream files are byte-identical to the historical pin. Current source-to-local differences are existing compact routing, safety overlays, and formatting. Retain Blaze, secret, backend/region/branch/rollout boundaries and Classic separation. Do not import the long deploy itinerary. |
| Data Connect / SQL Connect | Adopt nested `schema.datasource.postgresql.schemaValidation`, `adminNodeSdk`, Swift package examples, Web fetch-policy options, observer `onErr`, Swift query receiver, Dart result fields, profile fields matching the retained schema, null-safe CEL auth guards, and operation-name meaning. Adapt Android config/plugin and resolved-dependency inspection without mandatory CLI auth or latest-version lookups. Reject unconditional redeployment and the broad relational-database trigger. Retain the local folder, SQL Connect rename, Native SQL restrictions, generated schemas, operation authorization, React generation/config reuse, and exact hosted gates. Existing realtime links already cover the upstream repair; retain them unchanged. Keep the combined advanced reference rather than expanding to three separate guides. |
| Hosting Classic | **No runtime change.** All three upstream files are byte-identical to the historical pin. Retain local static/SPA routing and project/site/target/channel authorization boundaries rather than importing the upstream root tutorial. |
| Rules auditor | **No runtime change.** Upstream's code-span and JSON-format repairs are already represented in the local checklist. Reject the broader Cloud Storage description because the supplied audit model remains Firestore-specific. Retain read-only intent, conditional admin-email acceptance, concrete evidence, structured findings, and scope limits. |

The AI Logic structured-output example uses a small valid object schema instead of upstream's ellipsis placeholder. The [official structured-output guide](https://firebase.google.com/docs/ai-logic/generate-structured-output?api=dev&platform=web) confirms `Schema.object({ properties: ... })` and `Schema.string()`; no live model call was needed. Installed `firebase-tools@15.32.0` was read as source only: `lib/dataconnect/types.js:14-24` confirms nested schema validation, and `lib/init/features/dataconnect/sdk.js:268-278,336-348` confirms `adminNodeSdk` and the Swift package field. No CLI executable or package update ran.

### Increment 12 checks and limits

The five target validators and all 38 installed Local Skill validators/metadata checks passed using existing cached Python/PyYAML tooling without installation. The initial tracked-only enumeration found 37; validation then used all 38 installed roots, including the unchanged untracked skill. The existing seven bounded Firebase checks and all 18 Auth/Firestore contracts passed unchanged. Basics' earlier help-dependent contract evidence remains accepted; no help was recaptured. Parser-only Node checks passed for eight AI Logic Web fences and four changed-behavior SQL Connect fences. YAML and source-derived checks covered the changed config fields, profile schema alignment, auth guards, observer-versus-positional callbacks, Swift/Dart accessors, and Android setup boundaries. No new persistent test suite was added.

Manual positive/near-miss review covers Firebase AI Logic on each supported platform versus standalone Gemini/Genkit; client-only dependency work versus CLI login/service enablement; App Hosting SSR versus Classic static hosting; SQL Connect versus general PostgreSQL; and Firestore audit versus rule implementation or Cloud Storage review. Roots still select relevant references; local edits do not imply provisioning, model calls, or deployment. SQL Connect's existing local completion guidance and the auditor's scoped findings remain unchanged.

Only AI Logic, Data Connect, and this grouped provenance document changed. App Hosting, Hosting Classic, the auditor, Basics, Auth, Firestore, all four Genkit snapshots, existing tests, and the Git index remain unchanged from the start of this increment. No Firebase help/version/product command, SDK execution, compiler, emulator, authentication/config discovery, browser, live API/model evaluation, or hosted mutation ran. Native builds, SDK compatibility, model availability, and actual routing compliance remain unverified. The Genkit snapshots remain deferred; this record does not advance their provenance or the parent-owned review gate.

## Local safety rule

Firebase and Google Cloud are external hosted services. Reads, local emulation, local validation, and local code generation are allowed. Deploys, project creation, database creation, data writes, rule publishing, hosting deploys, quota changes, service enablement, and other hosted mutations require explicit user instruction for the exact action.

## Durable local overlays

Reapply these overlays after any upstream comparison. Do not restore contradictory instructions in a reference after fixing the root.

### Routing boundaries and metadata

- Use concise intent-specific descriptions, without an arbitrary local character cap. Keep `agents/openai.yaml` aligned with the skill's actual scope, with one matching `$skill-name` in each default prompt and valid 25–64-character UI short descriptions. Preserve intentional dependencies.
- Scope Genkit setup, implementation, and errors by SDK language. A Python import failure does not activate the Go or Dart skill; generic AI work without Genkit is not sufficient.
- `firebase-basics` authentication means Firebase CLI login and project selection, not application user sign-in. Route application authentication to `firebase-auth-basics`. Keep dependency-only and existing-config work independent of login, live account/project inspection, CLI installation, and agent tooling. Use installed/repository-pinned tools and selected references; do not deploy as validation.
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
8. Record the exact source commit and reviewed file subset when source content changes. Keep pending skills' historical provenance separate; a subset update must not advance a family-wide source pin.
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
