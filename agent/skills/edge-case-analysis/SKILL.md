---
name: edge-case-analysis
description: "Systematically identifies unhandled states, boundary condition failures, and logic gaps by orchestrating codebase-memory-mcp and context-mode. Use when reviewing code for edge cases, blast radius, coverage gaps, race conditions, invalid inputs, or log anomalies."
---

# Edge Case Analysis Skill

## Local metadata

Local version: 1.1.3

Focus areas:

- testing
- quality assurance
- logic audit
- security

## Purpose

Move beyond happy-path testing by identifying the hidden blast radius of code changes. Focus on null states, overflow conditions, race conditions, unhandled exceptions, missing tests, and implicit assumptions that standard reviews often miss.

## Core workflow

### Phase 1: Structural vulnerability search

Use codebase-memory-mcp to locate high-risk areas based on architecture, connectivity, and test proximity.

1. **Project and schema**: Call `codebase_memory_mcp_list_projects`, select the project whose `root_path` matches the active repo, then call `codebase_memory_mcp_index_status` and `codebase_memory_mcp_get_graph_schema`.
2. **Architecture overview**: Use `codebase_memory_mcp_get_architecture(project=...)` for first-pass high-level dependencies before diving into specific files.
3. **High fan-in/fan-out**: Use `codebase_memory_mcp_query_graph` over `CALLS` edges to find functions with many callers or callees. These are common blast-radius and assumption hubs.
4. **Test gaps**: Use `codebase_memory_mcp_search_graph(include_tests=true, query=...)` and `codebase_memory_mcp_search_code(mode="files", path_filter=...)` to look for nearby tests for critical symbols. Fall back to Context Mode searches when graph coverage is insufficient.

### Phase 2: Logical path and boundary analysis

Trace data flow to find impossible states or unhandled input ranges.

1. **Trace impacts**: Use `codebase_memory_mcp_detect_changes(project=..., since=... or base_branch=...)`, then `codebase_memory_mcp_trace_path(project=..., function_name=..., direction="both", depth=3, risk_labels=true)` on changed or critical symbols.
2. **Data flow**: Use `codebase_memory_mcp_trace_path(project=..., function_name=..., mode="data_flow", parameter_name=...)` when a parameter, ID, auth value, or payload field must be tracked across calls.
3. **Cross-service edges**: Use `codebase_memory_mcp_trace_path(project=..., function_name=..., mode="cross_service")` or `query_graph` only when `get_graph_schema` shows HTTP, async, or cross-service edge types.
4. **Boundary audit**: For every input in an identified flow, evaluate:
   - **Numeric**: 0, negative values, max/min values, overflow, rounding, and precision.
   - **Strings**: empty strings, long inputs, unicode, path separators, special characters, and injection patterns.
   - **Objects**: `null`, `undefined`, missing keys, wrong types, extra keys, and circular or deeply nested data.
   - **Collections**: empty lists, single item, very large lists, duplicates, and unstable ordering.
   - **State**: concurrent writes, retries, partial failure, stale cache, and idempotency.

### Phase 3: Runtime anomaly detection

Analyze logs and test outputs for rare error patterns using Context Mode.

1. **Sandbox processing**: For large test outputs or logs over 20 lines, never read them directly into context. Use `ctx_execute_file` or `ctx_execute` to analyze data inside the sandbox.
2. **Error extraction**: Use code to parse anomalies and print compact summaries. Use `ctx_search` with targeted queries such as `timeout`, `deadlock`, `retry`, `race condition`, `null`, or `panic` for indexed outputs.
3. **Token efficiency**: Prefix heavy read-only shell commands such as `cargo test`, `pytest`, or `npm test` with `rtk` inside Context Mode.

## Mandatory command patterns

- **"Find logic gaps in [feature]"**: Use `detect_changes`, `search_graph`, and `trace_path(project=..., function_name=..., mode="data_flow" or "calls")`, then perform boundary analysis of inputs and state transitions.
- **"Audit blast radius"**: Use `trace_path(project=..., function_name=..., direction="both", risk_labels=true)` plus fan-in/fan-out Cypher to identify ripple effects.
- **"Analyze log anomalies"**: Use `ctx_execute_file` or `ctx_execute` to script extraction of non-standard error patterns.
- **"Check test coverage for [function]"**: Use codebase-memory symbol search plus graph/test file searches; fall back to Context Mode searches for test naming conventions not captured by the graph.

## Reference patterns

- **Graph-first**: Verify the codebase-memory project and index status before structural analysis. If the graph is stale or missing and indexing is authorized and useful, run `codebase_memory_mcp_index_repository(repo_path=...)`.
- **Project required**: Most codebase-memory query tools require `project`. Get it from `list_projects`; do not guess.
- **Focused source**: Use `get_code_snippet` only after `search_graph` finds an exact `qualified_name`. Use native `read` only for files you intend to edit.
- **Cypher scope**: Inspect `get_graph_schema` before writing Cypher. Keep `max_rows` bounded.
- **No graph mutation casually**: Treat indexing, ADR updates, trace ingestion, persistence, and project deletion as deliberate local memory operations.
- **Sandbox-only**: Use Context Mode for any data over 20 lines and for all shell/test/log/build output.
- **RTK-default**: Use `rtk` for read-only shell operations inside Context Mode.

## Maintenance

For future updates to this custom Local Skill, read `../../../docs/skills/custom-local-skills-update-process.md`.
