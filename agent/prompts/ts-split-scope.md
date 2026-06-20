---
description: Split and simplify a TypeScript scope into a documented multi-file structure
argument-hint: "<scope> [-- instructions]"
---
ROLE
You are a senior TypeScript engineer performing a careful, behavior-preserving refactor across MULTIPLE TypeScript files: a module, package, directory tree, or whole project. You will both (a) split oversized/monolithic files into well-organized single-responsibility files and (b) simplify over-engineered single-use data flows — without changing observable behavior or the public API.

RAW ARGUMENTS
$ARGUMENTS

SCOPE PARSING
Parse the raw arguments before doing any code analysis.

Preferred usage:

```text
/ts-split-scope <scope> -- [instructions]
```

`<scope>` may be:

- a directory (e.g. `src/services/`),
- a glob (e.g. `src/**/*.ts`),
- a comma-separated or quoted list of files/globs/directories,
- a single package in a monorepo (e.g. `packages/core`),
- or `.` / `all` to mean the entire project.

Rules:

- If `--` is present, treat everything before `--` as the scope and everything after it as task-specific instructions/constraints.
- If `--` is not present, infer the scope only when the path/glob/dir is unambiguous. Treat the remaining text as instructions only if doing so is clearly safe.
- If no scope was provided, ask me whether to target the whole project or a specific scope — do NOT silently assume the whole project.
- If the scope resolves to zero TypeScript files, or looks like ordinary instruction text rather than a path/glob/dir/package, stop and ask for the scope.
- Never treat task instructions as the scope path.
- If the scope is `.` or `all`, confirm that I really want a project-wide refactor before proceeding unless I already explicitly said to proceed automatically.

Before any analysis, resolve and confirm the scope:

- Expand the scope into the concrete list of in-scope `.ts`/`.tsx` files.
- Show me the count and a compact file tree/list.
- Confirm which parts are in scope and which are out of scope.

GOAL
Reorganize the in-scope code into small, single-responsibility, well-documented files following TypeScript best practices, AND collapse over-engineered single-use flows into clean higher-level functions — while preserving 100% of existing functionality, public API, exported signatures, error messages, and behavior. Improve performance only where it's safe and explainable.

============================================================
PHASE 0 — SCOPE, BASELINE & SAFETY (do this first)
============================================================

1. Establish the project shape:
   - Locate and read every relevant `tsconfig*.json`, `package.json` (root + packages), and any project references / path aliases. Note compiler strictness settings actually in effect.
   - Detect monorepo structure (workspaces, project references, package boundaries). Refactors must NOT cross package boundaries unless I explicitly ask.
   - Identify the test runner, build script, lint/format config, and the type-check command (e.g. `tsc --noEmit`, `pnpm typecheck`, `nx run ...`). Record the exact commands you will use to verify later.
   - Check existing filename/style conventions across the repo (kebab-case vs camelCase files, barrel usage, folder layout) and match them.

2. Establish a clean baseline BEFORE editing:
   - Confirm the working tree is clean. If it is not clean, stop and ask before editing so my existing changes are not mixed with the refactor.
   - Recommend doing this work on a dedicated branch so it's reviewable and revertable; do not create/switch branches unless I explicitly ask.
   - Run the type-check and test/build commands once now and record the baseline result. If the project does not currently type-check or pass tests, STOP and tell me — do not refactor on top of a broken baseline unless I explicitly approve.

3. Map the public API surface that must stay stable:
   - Package entry points (`main`, `module`, `types`, `exports` in package.json).
   - Public barrels / `index.ts` files.
   - Every import path into the in-scope files that originates from OUT-OF-SCOPE code (other packages, app code, tests). These import paths must continue to resolve unchanged unless I explicitly ask you to update consumers.

============================================================
PHASE 1 — PROJECT-WIDE ANALYSIS (before creating/editing files)
============================================================

1. Build a dependency graph across all in-scope files:
   - For each file: exported symbols (functions, classes, types, interfaces, enums, constants) and their consumers (in-scope AND out-of-scope), plus internal (non-exported) helpers/types.
   - Edges between in-scope files, and edges from out-of-scope files into the scope (the API surface to preserve).
   - External dependencies (third-party / Node imports) and how each is used.

2. Identify logical domains spanning files (types/interfaces, constants/config, validation, data transformation, API/IO, business logic, utilities, error handling) and note where the current file layout cuts across these domains awkwardly.

3. Flag the risky stuff explicitly:
   - Existing circular imports (between in-scope files, or in-scope ↔ out-of-scope).
   - Module-level state, singletons, side-effectful module loads, and initialization-order dependencies — these are the most dangerous to move.
   - Code that relies on declaration order / hoisting.
   - Re-export chains and barrels that other code depends on.

4. Catalog the two refactor opportunities separately:

   A. SPLIT candidates — oversized or mixed-concern files that should be broken into single-responsibility files.

   B. SIMPLIFY candidates — over-engineered single-use data flows. Look specifically for:
      - internal helpers/types that are used exactly once,
      - exported helpers/types that are used exactly once but are NOT part of the public API surface,
      - a value that is computed in one place, passed through an intermediate object/parameter/caller, then consumed by another function in the same module,
      - pass-through fields/types/imports that exist only to ferry a value between two functions.
      For each, sketch the collapsed shape: one higher-level function at the existing public boundary where possible, remaining helpers made private, pass-through fields/types/imports removed.

   Public API warning: if an exported symbol is part of a package entry point, public barrel, or any preserved import path, do NOT remove it, un-export it, rename it, or change its signature without explicit approval — even if current search results show only one consumer.

   Note where splitting and simplifying pull in opposite directions: splitting fragments code into more files (which can create new single-use cross-file helpers and pass-through), while simplification consolidates. Decide per case. Do not split a flow you are about to collapse, and do not fragment so aggressively that you manufacture the very over-engineering the simplify step removes. When in doubt, simplify the flow first, THEN split along clean domain boundaries.

============================================================
PHASE 2 — PLAN (wait for my confirmation)
============================================================

Produce a written PLAN before touching code:

- Proposed folder/file structure for the scope (e.g. `types.ts`, `constants.ts`, `utils/<name>.ts`, `services/<name>.ts`, `validators.ts`, `index.ts` barrel), respecting existing repo conventions.
- A symbol → new file mapping table for every exported symbol and every significant internal symbol across the scope.
- A SIMPLIFICATIONS list: each single-use flow to collapse, with a one-line before → after and the public boundary it preserves. Mark which symbols/types/fields/imports get removed and which helpers become private. Any public API removal/change must be marked as REQUIRES APPROVAL.
- A RISK register: circular imports, shared mutable state, order-dependent side effects, large blast-radius moves — and your mitigation for each.
- A BATCHING/SEQUENCING plan: project-wide refactors must be done in reviewable increments (e.g. one module/domain per batch), with a type-check + test checkpoint between batches. Identify the safest order (leaf/low-dependency modules first; entry points last).
- API STABILITY confirmation: state how each preserved import path continues to resolve (via barrel/`index.ts` or compatibility shim at the original location). If I've asked you to update consumers instead, list every consuming file you'll touch.

Wait for my confirmation of the plan before proceeding, unless I've told you to proceed automatically. For large scopes, also confirm the batch boundaries.

============================================================
PHASE 3 — EXECUTION
============================================================

Work batch by batch per the agreed sequence. After each batch: type-check, run tests if present, and pause for a checkpoint summary before the next batch unless I explicitly approved fully automatic execution.

--- 3A. SPLIT (organize into files) ---

General principles:
- Single Responsibility per file: types, one service, one set of related utilities, etc. Never mix unrelated concerns (e.g. pure utilities with stateful service classes).
- Extract shared/duplicated logic into a common utility rather than copy-pasting.
- Preserve all existing functionality and public signatures EXACTLY. Do not silently change behavior, defaults, error messages, or edge-case handling. If you spot a bug, note it separately — don't fix it inline unless I approve.

TypeScript best practices to apply:
- Assume strict mode (strictNullChecks, noImplicitAny, etc.); fix violations that surface, but flag anything ambiguous rather than guessing intent.
- Eliminate `any` where reasonable; prefer `unknown` + type guards, generics, or proper union/discriminated-union types.
- `interface` for object shapes meant to be extended/implemented; `type` for unions, intersections, mapped/utility types.
- Use `as const`, literal types, and enums (or const-object + union type) for fixed value sets.
- Mark immutable data `readonly` (including readonly arrays/tuples where appropriate).
- Prefer named exports over default exports.
- ES module syntax only; no `require`/`module.exports`.
- Keep functions small and pure where possible; isolate side effects (I/O, network, mutation) into clearly named functions/modules.
- Early returns and guard clauses over deep nesting.
- Fully type public function parameters and return values; don't rely on inference for public APIs.
- Typed error classes/result types over throwing untyped objects or strings.
- No floating promises; await or explicitly handle all async.
- Map/Set for lookups where it improves complexity AND readability for the collection size.

File organization conventions:
- Naming: PascalCase for types/interfaces/classes/enums; camelCase for variables/functions; UPPER_SNAKE_CASE for true constants; filenames match the existing repo convention.
- One logical export per file where reasonable; group only tightly related small items (e.g. a few related types in `types.ts`).
- Create barrels/compatibility shims only where needed to keep external imports stable.
- Keep import paths relative and shallow; structure folders to avoid deep `../../../` chains.

Public-facing file safety gate:
- In the first implementation pass, do NOT reduce any public-facing file (package entry point, public barrel, or any file imported by out-of-scope code) to a re-export-only shim. First extract internals/helpers/types/services into new files while keeping each public file behaving as a real facade/orchestrator.
- A public file may import from the new files, but must not be reduced to only `export * ...` / `export { ... } from ...` re-exports unless I explicitly approve that conversion.
- After type-checks/tests pass, STOP and ask before converting any original public file into a pure compatibility shim. If I don't approve, keep it as the public facade and move only internals.

--- 3B. SIMPLIFY (collapse over-engineered single-use flows) ---

For each SIMPLIFY candidate from the plan:
- Collapse the compute → pass-through → consume chain into one higher-level function at an existing public boundary where possible.
- Make helpers private only when they are not part of the public API surface and not imported by out-of-scope code.
- Inline trivial single-use helpers only when that improves clarity and does not change stack traces/error semantics in a meaningful public way.
- Remove now-dead pass-through fields, intermediate types, and imports that existed only to carry the value between functions, but never remove public fields/types without explicit approval.
- Preserve existing behavior and output exactly — same results, same ordering, same error messages, same error types, same side effects.
- Update tests only to preserve coverage under the new organization (for example import paths or fixture locations). Do not weaken assertions. If a test directly covers an internal API you propose to privatize, flag it and ask before changing the test.
- Stay strictly within scope: avoid unrelated refactors, drive-by renames, or behavior tweaks while simplifying. One concern at a time.

Apply the Phase 1 tension rule: don't collapse a flow only to re-split it, and don't split a flow you've identified for collapse.

============================================================
PHASE 4 — DOCUMENTATION
============================================================

- Add a file-level header comment (TSDoc `/** ... */`) at the top of each new file: its purpose, what it exports, and its relationship to the rest of the module/project.
- Add or preserve TSDoc for exported functions, classes, methods, interfaces, types, and constants that are newly created, moved, or substantially rewritten. Include description, `@param`, `@returns`, `@throws` (if applicable), and a `@example` for non-trivial public APIs.
- Do not add documentation churn to unrelated or untouched public APIs just because they are in scope.
- Inline comments only where the "why" isn't obvious (non-obvious algorithms, workarounds, performance tradeoffs, edge cases) — don't restate the code.
- Document any intentional deviation from the obvious implementation (e.g. for performance) with a brief tradeoff note.

============================================================
PHASE 5 — PERFORMANCE
============================================================

- Address obvious inefficiencies (redundant computation, unnecessary allocations in hot paths, repeated work that could be cached/memoized, inefficient data structures) ONLY where it doesn't reduce readability or change behavior.
- No premature/micro-optimizations that obscure intent for negligible gain.
- Call out every performance-motivated change explicitly with a brief before/after rationale.

============================================================
PHASE 6 — VERIFICATION & DELIVERABLES
============================================================

1. Run the project's type-check (`tsc --noEmit` or the recorded command) across the whole project — not just the scope — and ensure ZERO new errors/warnings vs. the Phase 0 baseline.
2. Run existing tests and build; confirm they still pass. If no tests exist, add a minimal smoke test only if it fits the project's existing conventions; otherwise note the gap rather than inventing a test framework.
3. Check for circular imports across the new structure (and confirm you didn't introduce any in-scope ↔ out-of-scope cycles).
4. API stability check: confirm the set of public exports and their signatures is unchanged, and that every preserved import path still resolves. Show a before/after of the public export surface.
5. Provide a final summary:
   - New file tree with a one-line responsibility per file.
   - Final symbol → file mapping table.
   - List of simplified flows: what was collapsed, what became private, what was removed.
   - Any behavior changes, bug fixes, or performance changes — each clearly flagged as separate from the pure refactor.
   - Per-batch checkpoint results (if batched).
   - Remaining concerns, TODOs, and follow-up suggestions (including any candidates you deliberately left alone).

CONSTRAINTS

- Do not change external behavior or the public API unless explicitly approved.
- Do not cross package boundaries in a monorepo unless explicitly asked.
- Do not reduce any public-facing file to a re-export-only shim without explicit confirmation; preserve original public import paths throughout.
- Stay within the requested scope; no unrelated refactors, renames, or behavior tweaks — especially during simplification.
- Work in reviewable batches with a verification checkpoint between each.
- If something is ambiguous or risky to move (declaration-order/hoisting reliance, shared mutable state, side-effectful module load, init-order coupling), STOP and ask rather than guessing.
