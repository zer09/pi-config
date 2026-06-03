# Context Mode routing

This reference expands the routing rules in `../SKILL.md`. The compact skill remains authoritative. Use this file when command routing is non-trivial, Context Mode tool choice is unclear, file/log/test/build output is involved, or examples are needed.

## Core rule

Use Context Mode as the default sandbox for read-only shell work and any output that may exceed 20 lines. Raw output must not flood the model context.

RTK may compress command output, but RTK does not replace Context Mode or programmed analysis.

## Direct Bash whitelist

Direct Bash is only for local mutations/navigation and short safe commands on this whitelist:

```text
mkdir, mv, cp, rm, touch, chmod, git add, git commit, git push,
git checkout, git branch, git merge, cd, pwd, which, kill, pkill,
npm install, pip install, echo, printf
```

Notes:

- `git push` is also an external hosted service mutation. Use it only when the user explicitly requested that exact push.
- `rm -rf` on directories requires symlink safety checks first.
- Package installation can mutate local state. Keep it scoped and intentional.
- Read-only commands such as `ls`, `find`, `grep`, `rg`, `cat`, `git status`, `git log`, tests, builds, and scripts should use Context Mode, not direct Bash.

## File read and write policy

- For editing a file: native `read` is allowed so you can make precise native `edit` calls.
- For analysis of a file: use `ctx_execute_file`.
- For creating or modifying files: use native `write` or `edit` only.
- Do not use `ctx_execute`, `ctx_execute_file`, or Bash to write files.
- Skip files over 100KB unless required. If required, process them with `ctx_execute_file`.

## Tool selection hierarchy

1. `ctx_search(sort: "timeline")` after resume or compaction when prior indexed context may contain state.
2. `ctx_batch_execute(commands, queries)` for shell research, multiple commands, tests, builds, git reads, and any command that may produce large output.
3. `ctx_search(queries: [...])` for follow-up questions over indexed output.
4. `ctx_execute(language, code)` for one-off commands, API calls, and programmed analysis.
5. `ctx_execute_file(path, language, code)` for file/log/data analysis.
6. `ctx_fetch_and_index` followed by `ctx_search` for URLs and web docs.
7. Native `read`, `write`, and `edit` only for file editing and file creation.
8. CodeGraph for structural code questions before grep/find/manual file reading.

## Context Mode tools

- `ctx_batch_execute`: primary shell research tool. Run commands, index output, and search results in one call. For 3+ independent I/O-bound commands, use `concurrency: 4-8`. Keep `concurrency: 1` for tests, builds, locks, ports, writes, or commands sharing state. Use `query_scope: "batch"` unless global memory search is intentional.
- `ctx_execute`: run a single sandboxed command or programmed analysis. Print only the compact answer.
- `ctx_execute_file`: read and analyze a file inside the sandbox. Print only the compact answer.
- `ctx_fetch_and_index`: fetch URL content, convert/index it, then use `ctx_search`. For multi-URL public docs, pass `requests` and `concurrency: 4-8`; lower concurrency if the host rate-limits.
- `ctx_index`: index already-available documentation or knowledge content. Prefer `path` plus a descriptive `source` label. Bound directory indexing with `maxDepth`, `maxFiles`, and `extensions`; avoid large inline `content`.
- `ctx_search`: search indexed content. Batch questions in one call, and scope with `source` when an indexed label is known.
- `ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_insight`, `ctx_purge`: management commands. `ctx_insight` opens the local analytics dashboard. Destructive purge requires explicit scope.

## Think in code

When the task requires counting, filtering, comparing, aggregating, parsing, or transforming data, write code inside `ctx_execute` or `ctx_execute_file` and print only the answer.

Do not load raw logs, JSON, CSV, test output, snapshots, diffs, or large file contents into context and analyze them mentally.

Preferred pattern:

```javascript
try {
  // Read/process data in the sandbox.
  // console.log only the summary, counts, or matching records needed.
} catch (e) {
  console.log(`ERROR ${e.message}`);
}
```

## Blocked routes

Do not use these routes for normal work:

- Raw `curl` or `wget` for web pages or docs. Use `ctx_fetch_and_index`.
- Inline HTTP scripts that dump raw responses into context. Use `ctx_execute` and summarize.
- WebFetch or browser fetches for docs when Context Mode can index the page. Use `ctx_fetch_and_index`, then `ctx_search`.
- Direct browser/web fetches for private GitHub data. Use authenticated `gh` through Context Mode/RTK.
- Direct Bash for commands that may produce more than 20 lines.
- Native `read` for analysis-only reads.
- Grep/find/manual source reading before CodeGraph for structural code questions.

## Decision tree

1. Would this mutate an external hosted service?
   - If no exact user instruction exists for the mutation, do not call it. Draft or summarize instead.
2. Is the command on the direct Bash whitelist and short/local?
   - If yes, direct Bash is allowed, subject to safety rules.
3. Is it read-only shell work?
   - Use `ctx_batch_execute` or `ctx_execute`, prefixing the command with `rtk` when available.
4. Could output exceed 20 lines?
   - Use Context Mode. Do not use direct Bash.
5. Are you analyzing data?
   - Use code inside `ctx_execute` or `ctx_execute_file`.
6. Is it a file read for analysis?
   - Use `ctx_execute_file`.
7. Is it a file read for editing?
   - Use native `read`, then native `edit`.
8. Is it a URL or web docs?
   - Use `ctx_fetch_and_index`, then `ctx_search`.
9. Is it codebase exploration, review, caller/callee lookup, architecture review, or impact analysis?
   - Use CodeGraph first. See `codegraph-protocol.md`.
10. If Context Mode, RTK, or CodeGraph fails, follow `fallback-and-troubleshooting.md`.

## CLI fallback

If Context Mode MCP tools are unavailable but the `context-mode` CLI is installed, use CLI fallbacks for read-only recovery:

```text
context-mode index <path> --source <label> --max-depth 5 --max-files 200
context-mode search "query terms" --source <label> --limit 5
context-mode doctor
context-mode upgrade
```

Keep the same routing rules: do not use CLI fallbacks to write project files, print large raw output, or bypass destructive-action gates.

## Platform forwarding privacy

Context Mode can forward session events to a configured platform endpoint when local platform config exists. Do not create, enable, or modify platform forwarding config unless the user explicitly asks for that exact setup. Treat `platform_url`, `api_key`, and equivalent endpoint or credential fields as secrets. Prompt analytics can include derived prompt features and deduped word tokens, so consider platform forwarding an external data-sharing decision.

## Management command behavior

- `ctx stats`, `ctx-stats`, `/ctx-stats`: call stats and display the full output verbatim.
- `ctx doctor`, `ctx-doctor`, `/ctx-doctor`: call doctor, run the returned command if provided, and display as a checklist.
- `ctx upgrade`, `ctx-upgrade`, `/ctx-upgrade`: call upgrade, run the returned command, display as a checklist, and tell the user to restart the session.
- `ctx purge`, `ctx-purge`, `/ctx-purge`: destructive. Use explicit scope and warn that it is irreversible.
- `ctx insight`, `ctx-insight`, `/ctx-insight`: open the local Context Mode analytics dashboard; use only when the user wants dashboard/metrics inspection.

## Session recovery

After `/clear`, `/compact`, or a long pause, the Context Mode knowledge base may still contain prior state. Search it before asking the user to repeat context.
