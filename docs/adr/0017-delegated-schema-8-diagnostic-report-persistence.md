# ADR 0017: Delegated schema-8 diagnostic report persistence

## Status

Accepted (2026-08-29). Extends ADR 0016 (schema-7 maximum progress-gap telemetry). Supersedes ADR 0016's schema-7 version for newly written records only. Historical schema 3 through schema 7 files remain valid historical records and are never migrated, rewritten, or deleted. Every lease threshold, liveness decision, routing, role policy, recovery, cleanup, retention bound, analyzer statistic, and model-visible instruction is unchanged.

## Context

Schema-7 run telemetry is metadata-only: when a delegate ended BLOCKED, FAILED, or in any supervision failure state, the failure diagnostic kept bounded typed fields but discarded the final report. The parent receives only the fixed sanitized failure Markdown, so the exact delegate-authored terminal evidence existed only in the supervision session and was lost when the process ended. Debugging an `invalid_result`, a rejected reason line, or a delegate that misused BLOCKED required rerunning the work.

The report is delegate-authored free text and can contain anything the child wrote, including task content, paths, or secrets the assignment itself referenced. Persisting it is a local privacy risk that the metadata-only invariant avoided.

## Decision

### Schema 8

Every newly written run-telemetry record uses `schemaVersion: 8` (agent/extensions/delegated-pi-loop/diagnostics.ts). Schema 8 keeps every schema-7 field, bound, and fail-closed rule unchanged and adds exactly one failure-only `delegateReport` object. Successful-run telemetry filenames move to the exact extension-owned `success-v8-` prefix with the unchanged 4,096-record retention. Historical schema 3 through 7 files are never migrated.

### The failure-only report object

Only failure diagnostics (unsuccessful runs) carry `delegateReport`, an object with `text`, `totalBytes`, and `truncatedBytes`. An empty report omits the field. Within the object, `totalBytes` is always the original report's exact UTF-8 byte count and `truncatedBytes` is the original bytes minus the stored text bytes, so the record proves how much evidence was kept even after a cut.

The stored `text` is bounded to `DELEGATE_TOOL_OUTPUT_LIMIT` (50 KiB):

- A report within the limit survives byte-for-byte.
- An oversized report with a recognized terminal suffix keeps that suffix verbatim at the end: the exact `DELEGATE_REASON`/`DELEGATE_RESULT` terminal lines with their line separator, when the final line is the `DELEGATE_RESULT` marker and a `DELEGATE_REASON` line directly above it, when present, carries one of the exact fixed reason codes for that outcome. The remaining budget is spent on a UTF-8-safe body prefix, so the stored text stays valid UTF-8 and within the limit while the terminal evidence survives intact.
- An oversized report without a recognized terminal suffix (including look-alike tails with non-enum reason codes, a reason line paired with COMPLETED, or no terminal marker) keeps only the UTF-8-safe prefix truncation.

The global `truncateUtf8` helper is unchanged; the suffix-aware cut lives only in the diagnostics failure view.

### Local privacy risk

The report object deliberately accepts a local privacy risk: delegate-authored report text now rests on the same local disk as the rest of the diagnostic. The risk is bounded by every existing containment rule: writes go only to `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop` with a 0700 directory and 0600 files, one bounded object per unsuccessful run, and nothing is uploaded, synced, or sent to any external service. Prompts, raw stdout/stderr, tool arguments and results, checkpoint digests, HMAC keys, Git state, credentials, and provider bodies stay excluded. Successful-run records stay metadata-only and never carry the report.

### Model-visible exclusion

The report object never becomes model-visible. Parent ToolResult content and details, the failure Markdown, TUI rendering, and every fixed summary stay exactly as schema 7 defined them: the diagnostic file path travels only in ToolResult details for the TUI footer. The parent model still cannot read the report of a failed delegate; only a local human inspecting the private log can.

### Best-effort writes

Failure-diagnostic persistence remains best-effort: a create, write, chmod, or rename failure never masks the delegate outcome, temporary supervision artifacts are still removed, and the sanitized ToolResult is still returned without a diagnostic path. Success telemetry stays best-effort metadata-only with unchanged retention.

### Analyzer eligibility

The read-only `analyze:progress-gaps` analyzer (agent/extensions/delegated-pi-loop/analyze-progress-gaps.ts) keeps its aggregate-only statistics and remains eligible only for schema version exactly 8 records of completed invocations, using the completed supervised attempt's finite non-negative maximum. Schema 3 through 7 records are ignored as historical; failure records with their report objects are never in the eligible sample because eligibility requires a completed invocation. The 1 MiB scan-input cap stays, with the failure record staying under the 50 KiB report bound.

## Consequences

- An unsuccessful run leaves its exact final report, terminal lines included, in a private local log for human debugging, with byte-exact truncation metadata.
- Terminal evidence survives the 50 KiB cut for recognized BLOCKED and FAILED terminal forms; malformed terminal tails lose the tail to prefix truncation, and their typed outcome fields still record the rejection.
- Local disk now holds delegate-authored failure text next to the metadata; a compromised local account reads it. The metadata-only invariant survives everywhere else: success records, model-visible surfaces, the parent ToolResult, and analyzer output.
- Rollback may stop writing the report object and restore schema 7 for new writes without deleting or rewriting already written schema-8 files.

## Validation

- Diagnostics tests pin byte-for-byte preservation under the limit, exact terminal-suffix preservation with a UTF-8-safe body prefix for oversized BLOCKED and FAILED forms (including a multibyte prefix boundary one byte below the limit), prefix truncation for oversized text without a recognized suffix, byte-exact `totalBytes`/`truncatedBytes` metadata, the parent ToolResult exclusion, and the success-record omission.
- The full delegated-pi-loop suite, strict all-file TypeScript, `git diff --check`, and current-policy stale-text searches must pass; no model-visible instruction text changes, so the instruction reference document needs no regeneration.
