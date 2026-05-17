---
name: edge-case-analyst
description: "Systematically identifies unhandled states, boundary condition failures, and logic gaps in software by orchestrating code-review-graph and context-mode."
---

# Edge Case Analyst Skill

## Local metadata

Local version: 1.1.0

Focus areas:

- testing
- quality assurance
- logic audit
- security

## Purpose

To move beyond "happy-path" testing by identifying the hidden "blast radius" of code changes. This skill forces the analysis of null states, overflow conditions, race conditions, and unhandled exceptions that standard reviews often miss.

## Core Workflow

### Phase 1: Structural Vulnerability Search

Use the code-review-graph to locate high-risk areas based on complexity and lack of coverage.

1. **Identify Complexity**: Execute `code_review_graph_find_large_functions_tool`. Focus on functions with high line counts, as these are statistically more likely to contain hidden logic bugs.
2. **Audit Test Gaps**: Use `code_review_graph_query_graph_tool` with the `tests_for` pattern for any complex function found. If a critical function lacks associated tests, mark it as a primary target for unhandled edge cases.
3. **Architecture Overview**: Use `code_review_graph_get_architecture_overview_tool` to understand high-level dependencies before diving into specific files.

### Phase 2: Logical Path & Boundary Analysis

Trace data flow to find "impossible" states or unhandled input ranges.

1. **Trace Impacts**: Use `code_review_graph_get_affected_flows_tool` on recent changes to see how state transitions ripple through the system.
2. **Boundary Audit**: For every input parameter in an identified flow, evaluate the following:
 - **Numeric**: Check for 0, negative values, MAX_INT, and floating-point precision issues.
 - **Strings**: Test empty strings, excessively long inputs, special characters, and injection patterns.
 - **Objects**: Explicitly handle `null`, `undefined`, missing keys, or incorrect types.
3. **Blast Radius**: Use `code_review_graph_get_impact_radius_tool` to find distant files that may rely on implicit assumptions of the code being changed.

### Phase 3: Runtime Anomaly Detection

Analyze logs and test outputs for rare error patterns using context-mode.

1. **Sandbox Processing**: For large test outputs or logs (>20 lines), NEVER read them directly into context. Use `ctx_execute_file` or `ctx_execute` to analyze the data within the sandbox.
2. **Error Extraction**: Use `ctx_search` with a queries array (e.g., `["timeout", "deadlock", "retry", "race condition"]`) to find anomalies in indexed log files.
3. **Token Efficiency**: Always prefix heavy shell commands (like `cargo test`, `pytest`, or `npm test`) with `rtk` to reduce token consumption by up to 90%.

## Mandatory Commands

- **"Find logic gaps in [feature]"**: Triggers `code_review_graph_get_affected_flows_tool` followed by a boundary analysis of all inputs.
- **"Audit blast radius"**: Triggers `code_review_graph_get_impact_radius_tool` to identify ripple effects in the codebase.
- **"Analyze log anomalies"**: Triggers `ctx_execute_file` to script a programmatic extraction of non-standard error patterns from log files.
- **"Check test coverage for [function]"**: Uses `code_review_graph_query_graph_tool` with `tests_for` to identify untested logic paths.

## Reference Patterns

- **Graph-First**: Always verify the code-review-graph is updated before starting an analysis. If the graph is stale, run `/code-review-graph:build-graph`.
- **Root Graph Database**: For repo-scoped or grouped-root work, build/query the Code Review Graph database at the root that contains all relevant code. Nested sub repos are part of that root graph database. Do not require each sub repo to be registered separately.
- **Daemon Status**: `0 registered repos` means the daemon has no global roots; it does not mean Code Review Graph is unavailable. If the daemon is stopped, unavailable, or empty, build/query the current repo root or grouped feature root directly before falling back.
- **No Cross-Repo By Default**: Do not use global `cross_repo_search` for repo-scoped, root-scoped, or feature-scoped edge-case analysis unless the user explicitly asks to search unrelated registered repos.
- **Sandbox-Only**: Adhere to the `filename` + `ctx_index` pattern for any data over 50KB to preserve the context window.
- **RTK-Default**: Use `rtk` for all read-only operations (git, ls, find, grep) to maintain session speed and quality.
