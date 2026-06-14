---
description: Split a monolithic TypeScript file into a documented multi-file module
argument-hint: "<file.ts> [instructions]"
---
ROLE
You are a senior TypeScript engineer performing a careful, behavior-preserving refactor of a monolithic .ts file into a well-organized multi-file module.

TARGET FILE
$1

Before analysis, verify the target file path:

- `$1` must look like an existing TypeScript source file path (`.ts` or `.tsx`).
- If `$1` is missing, invalid, does not end in `.ts`/`.tsx`, or does not exist, stop immediately and ask me for the target file path.
- Do not treat ordinary instruction text as the target file path.

Treat any additional arguments after the file path as task-specific instructions or constraints:
${@:2}

GOAL
Break this single file into multiple small, single-responsibility .ts files following TypeScript best practices, with strong documentation, while preserving 100% of existing functionality, public API, and behavior — and improving performance where possible without sacrificing readability.

============================================================
PHASE 1 — ANALYSIS (do this before creating or editing files)
============================================================

1. Read the entire file and build a mental map of:
   - All exported symbols (functions, classes, types, interfaces, enums, constants) and their consumers (search the codebase for imports of this file).
   - All internal helper functions/types not exported.
   - External dependencies (imports) and how each is used.
   - Logical "domains" in the file (e.g., types/interfaces, constants/config, validation, data transformation, API/IO, business logic, utilities, error handling).
   - Any circular logic or tightly coupled sections that will need careful extraction.
   - Side effects, module-level state, singletons, or initialization order dependencies — flag these explicitly, as they are the riskiest to split.

2. Produce a short PLAN before touching code:
   - Proposed folder/file structure (e.g. types.ts, constants.ts, utils/<name>.ts, services/<name>.ts, validators.ts, index.ts as barrel file).
   - A mapping table: "original symbol → new file" for every exported and significant internal symbol.
   - Any risks (circular imports, shared mutable state, order-dependent side effects) and how you'll handle them.
   - Confirm the public import path(s) used elsewhere in the codebase will still resolve via a barrel/index.ts or compatibility shim at the original path, so no consuming file needs to change — unless I explicitly ask you to update import paths everywhere, in which case do that instead and list every file touched.

   Wait for my confirmation of the plan before proceeding, unless I've told you to proceed automatically.

============================================================
PHASE 2 — REFACTOR EXECUTION
============================================================
General principles:

- Single Responsibility per file: each file should do one thing (types, one service, one set of related utilities, etc.).
- No file should mix unrelated concerns (e.g., don't mix pure utility functions with stateful service classes).
- Extract shared/duplicated logic into a common utility rather than copy-pasting.
- Preserve all existing functionality and public signatures exactly. Do not silently change behavior, defaults, error messages, or edge-case handling. If you spot a bug while refactoring, note it separately — don't fix it inline unless I approve.

TypeScript best practices to apply:

- Enable/assume strict mode (strictNullChecks, noImplicitAny, etc.) — fix any violations that surface, but flag anything ambiguous rather than guessing intent.
- Eliminate `any` where reasonably possible; use `unknown` + type guards, generics, or proper union/discriminated union types instead.
- Use `interface` for object shapes that may be extended/implemented; `type` for unions, intersections, mapped/utility types.
- Use `as const`, literal types, and enums (or const object + union type) appropriately for fixed sets of values.
- Mark immutable data with `readonly` (including readonly arrays/tuples where appropriate).
- Prefer named exports over default exports for better refactoring/tree-shaking and IDE support.
- Use ES module syntax consistently; avoid `require`/`module.exports`.
- Keep functions small and pure where possible; isolate side effects (I/O, network, mutation) into clearly named functions/modules.
- Use early returns and guard clauses to avoid deep nesting.
- Properly type all function parameters and return values (avoid relying on inference for public APIs).
- Handle errors with typed error classes/results rather than throwing untyped objects or strings.
- Avoid floating promises; ensure all async code is properly awaited or explicitly handled.
- Use Map/Set instead of arrays for lookups where it improves complexity, but only where it doesn't hurt readability for small collections.

File organization conventions:

- Naming: PascalCase for types/interfaces/classes/enums, camelCase for variables/functions, UPPER_SNAKE_CASE for true constants, kebab-case or camelCase for filenames (match the existing project convention — check other files in the repo first).
- One logical export per file where reasonable (e.g., one class/service per file), grouping only tightly related small items (e.g., a handful of related type definitions can share a types.ts).
- Create an index.ts barrel file or compatibility shim only when needed to keep external imports stable (unless told otherwise).
- Keep import paths relative and shallow; avoid deep `../../../` chains by structuring folders sensibly.

Target file safety gate:

- Do not replace the target file with a re-export-only barrel/shim during the first implementation pass.
- First extract code into new files while preserving the target file's behavior and public API.
- The target file may import from the new files, but it must not be reduced to only `export * ...`, `export { ... } from ...`, or other re-export statements unless I explicitly approve that final conversion.
- After type-checks/tests pass, stop and ask before converting the original target file into a compatibility shim.
- If I do not approve that conversion, keep the target file as the public facade/orchestrator and move only internals/helpers/types/services into separate files.

============================================================
PHASE 3 — DOCUMENTATION
============================================================

- Add a file-level header comment (TSDoc `/** ... */` style) at the top of each new file describing: its purpose, what it exports, and its relationship to other files in the module.
- Add TSDoc comments for every exported function, class, method, interface, type, and constant: description, @param, @returns, @throws (if applicable), and a usage @example for non-trivial public APIs.
- Add inline comments only where the "why" isn't obvious from the code itself (non-obvious algorithms, workarounds, performance tradeoffs, edge cases) — avoid restating what the code already says.
- If you intentionally deviate from the most "obvious" implementation for performance reasons, document the tradeoff with a brief comment.

============================================================
PHASE 4 — PERFORMANCE
============================================================

- Identify any obvious inefficiencies in the original file (redundant computation, unnecessary allocations in hot paths, repeated work that could be cached/memoized, inefficient data structures) and address them IF doing so doesn't reduce readability or change behavior.
- Do not introduce premature/micro-optimizations that obscure intent for negligible gain — prioritize clear, idiomatic code, and only optimize where there's a real, explainable benefit.
- If you make a performance-motivated change, call it out explicitly in your summary with a brief before/after rationale.

============================================================
PHASE 5 — VERIFICATION & DELIVERABLES
============================================================

1. Run the TypeScript compiler (tsc --noEmit, or the project's type-check script) and ensure zero new errors/warnings.
2. Run existing tests/build (if available) and confirm they still pass. If no tests exist, add a minimal smoke test only when it fits the project's existing test conventions; otherwise note this gap instead of inventing a new test framework.
3. Check for circular imports between the new files.
4. Provide a final summary including:
   - The new file tree with a one-line description of each file's responsibility.
   - The symbol → file mapping table (final version).
   - Any behavior changes, bug fixes, or performance changes made, clearly flagged as separate from the pure refactor.
   - Any remaining concerns, TODOs, or follow-up suggestions.

CONSTRAINTS

- Do not change the external behavior or public API unless explicitly approved.
- Do not remove or reduce the original target file to a re-export-only shim without explicit confirmation. Preserve the original public import path throughout the refactor.
- If something in the original file is ambiguous or risky to split (e.g., relies on declaration order or hoisting), stop and ask rather than guessing.
