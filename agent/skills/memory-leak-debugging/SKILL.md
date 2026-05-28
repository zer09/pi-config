---
name: memory-leak-debugging
description: Diagnoses and resolves memory leaks in JavaScript/Node.js applications. Use when a user reports high memory usage, OOM errors, or wants to analyze heapsnapshots or run memory leak detection tools like memlab.
---

# Memory leak debugging

Use this skill for JavaScript, browser, and Node.js memory growth, OOMs, detached DOM nodes, leaked closures, retained listeners, and growing caches.

## Safety and routing

- Never read raw `.heapsnapshot` files into context. They are huge and may contain sensitive strings.
- Save snapshots to disk, then analyze them with `memlab` or the bundled comparison script.
- Use Context Mode for large tool output, logs, heap summaries, and repeated test runs.
- Confirm intent before clearing caches or nulling retained objects; some retained DOM nodes or caches are intentional.

## Workflow

1. Isolate whether the leak is browser-side, server-side, or test-harness-related.
2. For browser leaks, use Chrome DevTools MCP to capture baseline, after-action, and post-cleanup snapshots with `take_memory_snapshot`.
3. Repeat the suspected interaction enough times to amplify growth, then return the page to its initial state before the final snapshot.
4. Analyze snapshots with `memlab`; read `references/memlab.md` for command patterns.
5. If `memlab` is unavailable, run `references/compare_snapshots.js` against baseline and target snapshots and inspect only the summarized growth output.
6. Map retained objects back to code. Use `references/common-leaks.md` for common detached DOM, listener, closure, timer, observer, and cache patterns.
7. Fix the smallest root cause, then rerun the same scenario and compare memory growth again.

## Fallback script

```bash
node agent/skills/memory-leak-debugging/references/compare_snapshots.js <baseline.heapsnapshot> <target.heapsnapshot>
```

Adapt the path if running from a different working directory.

## Maintenance

For future updates to this source, read `../../../docs/skills/chrome-devtools-skills-update-process.md`.
