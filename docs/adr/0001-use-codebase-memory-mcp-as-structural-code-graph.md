# Use codebase-memory-mcp as the structural code graph

Pi Config now treats `codebase-memory-mcp` as the canonical structural code graph provider for Context Watcher, reader delegates, and graph-first analysis skills. Code Review Graph was removed from the active MCP configuration, so keeping Code Review Graph in runtime instructions created a broken mandatory route; codebase-memory-mcp preserves local graph-first exploration, caller/callee tracing, Cypher queries, change impact analysis, and architecture memory while matching the active toolchain.

## Consequences

- Active routing must verify codebase-memory project/index status before structural code work.
- Worktree guidance uses project/index lifecycle rules instead of daemon/watch rules.
- Code Review Graph installation notes are historical only and must not be used as active routing guidance.
