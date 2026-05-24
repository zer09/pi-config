---
name: edge-case-analysis
description: "Find unhandled states, boundary/logic gaps, blast radius, coverage gaps, races, invalid inputs, and security/log anomalies via codebase-memory-mcp/context-mode."
---

# Edge Case Analysis Skill

## Purpose

Find hidden blast radius, impossible states, boundary failures, races, exceptions, missing tests, and assumptions past happy paths. Context Watcher owns shell routing, hosted-service mutation gates, file writes, RTK, and fallback.

## Core workflow

### Phase 1: Structural search

1. Select graph: `codebase_memory_mcp_list_projects`, matching `root_path`, then `codebase_memory_mcp_index_status(project=...)` and `codebase_memory_mcp_get_graph_schema(project=...)`.
2. Orient: `codebase_memory_mcp_get_architecture(project=...)`.
3. Find hubs/gaps: `codebase_memory_mcp_query_graph(project=..., query=..., max_rows=...)` over schema-confirmed `CALLS` edges for fan-in/fan-out; tests via `codebase_memory_mcp_trace_path(project=..., function_name=..., include_tests=true)` or `codebase_memory_mcp_search_code(project=..., pattern=..., mode="files")`; symbols via `codebase_memory_mcp_search_graph(project=..., query=...)`.
4. Fall back to Context Mode only for insufficient graph coverage, non-code content, or unauthorized/wasteful indexing.

### Phase 2: Path and boundary analysis

Trace critical symbols, then audit inputs/state.

1. Impact: `codebase_memory_mcp_detect_changes(project=..., since=... or base_branch=...)`, then `codebase_memory_mcp_trace_path(project=..., function_name=..., direction="both", depth=3, risk_labels=true)`.
2. Data flow: `codebase_memory_mcp_trace_path(project=..., function_name=..., mode="data_flow", parameter_name=...)` for parameters, IDs, auth values, payloads, or persisted values.
3. Cross-service: use `codebase_memory_mcp_trace_path(project=..., function_name=..., mode="cross_service")` or bounded `codebase_memory_mcp_query_graph(project=..., query=..., max_rows=...)` after `codebase_memory_mcp_get_graph_schema(project=...)` confirms edge types.
4. Boundaries: numeric ranges/precision; empty/long/unicode/special strings; `null`/missing/wrong/extra/deep fields; empty/single/huge/duplicate/unstable collections; concurrency/retries/partial failure/stale cache/idempotency.

### Phase 3: Runtime anomalies

Use Context Mode for logs, tests, builds, and output over 20 lines.

- Analyze with `ctx_execute_file` or `ctx_execute`; parse in code and print compact summaries.
- Search indexed output for `timeout`, `deadlock`, `retry`, `race condition`, `null`, `panic`, or domain errors.
- Prefix heavy read-only commands like `cargo test`, `pytest`, or `npm test` with `rtk` inside Context Mode when available.

## Command patterns

- Logic gaps: run Phase 1-2 graph tools, then boundary/state audit.
- Blast radius: `codebase_memory_mcp_trace_path(project=..., function_name=..., direction="both", risk_labels=true)` plus fan-in/fan-out Cypher.
- Log anomalies: `ctx_execute_file` or `ctx_execute` with scripted extraction.
- Test coverage: graph symbol/test search; fallback to Context Mode for naming conventions or unindexed tests.

## Guardrails

- Most codebase-memory tools require `project`; get it from `codebase_memory_mcp_list_projects`.
- Use `codebase_memory_mcp_get_code_snippet` only after `codebase_memory_mcp_search_graph` returns an exact `qualified_name`.
- Inspect `codebase_memory_mcp_get_graph_schema` before Cypher and keep `max_rows` bounded.
- Treat indexing, ADR updates, trace ingestion, persistence, and deletion as local memory mutations: index only when authorized/useful; delete projects only on exact user request.
- Native `read` is only for files you intend to edit; use Context Mode for analysis/large output.

## Maintenance

For future updates to this Custom Local Skill, read `../../../docs/skills/custom-local-skills-update-process.md`.
