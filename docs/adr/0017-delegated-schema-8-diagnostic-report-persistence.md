# ADR 0017: Delegated schema-8 diagnostic report persistence

## Status

Accepted (2026-08-29). Extends ADR 0016 (schema-7 maximum progress-gap telemetry). Supersedes ADR 0016's schema-7 version for newly written records only. Historical schema 3 through schema 7 files remain valid historical records and are never migrated, rewritten, or deleted. Every lease threshold, liveness decision, routing, role policy, recovery, cleanup, retention bound, analyzer statistic, and model-visible instruction is unchanged.

## Amendment (2026-09-13): Schema 9 selected active bash command

This amendment is current policy. It supersedes the schema-8 write version, success prefix, and analyzer eligibility below. It also narrows earlier raw-argument and command-line persistence prohibitions, including ADR 0015, only for the failure-only field defined here. The schema-8 sections below remain historical evidence; the report truncation rules still apply unchanged.

Every newly written run-telemetry record uses `schemaVersion: 9`. Success records use the exact `success-v9-` prefix and retain the newest 4,096 writer-owned regular files under the existing no-follow checks, ordering, and serialization. Historical schema 3-8 records, including `success-v8-` files, are not migrated, rewritten, or pruned. The read-only analyzer accepts only schema-9 completed invocations and keeps all existing aggregate statistics and the 1 MiB scan-input cap.

### One failure-only command object

The existing unsuccessful-run diagnostic JSON may contain one top-level `activeBashCommand` object with exactly `{ text, totalBytes, truncatedBytes }`. No separate forensic file or command log exists.

- At an accepted tool start, capture only a string `event.args.command` when the sanitized tool name is exactly `bash`. Missing and non-string commands are omitted; an empty string is retained with zero byte counts.
- `text` preserves the exact command, including multiline formatting, up to 4,096 UTF-8 bytes (`ACTIVE_BASH_COMMAND_MAX_BYTES`). Oversized commands keep the longest whole-character prefix within the bound. `totalBytes` is the original UTF-8 size; `truncatedBytes` is the number of omitted bytes, zero for an uncut command.
- The object belongs to the same tool that `activeToolFields()` selects: the stalest active tool, with ties resolved by most recent start. If that selected tool is not bash or has no string command, omit the object even if another active bash has a command.
- The bounded active-tool map keeps commands only until their tool ends or the attempt is cleared. The final selection travels in memory beside the supervisor result, outside `AttemptStatus` and its temporary `status.json`. It never enters attempts, progress, ToolResult content/details, failure Markdown, TUI rendering, success telemetry, or any automatically model-visible output.
- Fallback never accumulates command history. A two-route failure records only the final selected active bash command, matching the diagnosed status; a later catalog-only status or non-bash selection omits it.
- No other arguments, tool results, environment, stdout/stderr, or command history are captured by this field. Full argument HMAC digests still determine novelty independently of the command prefix; keys and digests remain ephemeral.

### Accepted private-local privacy risk

Like `delegateReport`, exact command text can contain secrets, paths, task content, or embedded provider data. This amendment intentionally accepts that risk; these two bounded failure-only objects are exceptions to the earlier metadata-only exclusions. There is no heuristic redaction, which could miss secrets and give false confidence.

The existing failure writer remains the only persistence path: `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop`, a 0700 directory, and 0600 atomic files. Writes remain best-effort and never change the run outcome. Permissions do not protect against the same local account or privileged readers. The extension does not upload these fields; operators must review and redact diagnostics before sharing them. Other raw content remains excluded outside these two explicit objects.

No model-visible instruction, tool schema, routing policy, resource policy, or liveness decision changes. No always-loaded or model-visible surface changes, so context-cost accounting needs no recount.

### Schema-9 validation

Monitor, supervisor, runner, diagnostics, rendering, and analyzer regressions cover exact multiline capture, safe byte bounds and metadata, selected-tool correlation, omission cases, digest novelty, fallback isolation, 0700/0600 containment, historical-file immunity, and all public-surface exclusions. Required gates are the full extension suite, documented transient-config strict TypeScript, routing validation, instruction synchronization/idempotence, stale-policy searches, and `git diff --check`. No provider inference is authorized.

## Historical context (schema 8)

Schema-7 run telemetry is metadata-only: when a delegate ended BLOCKED, FAILED, or in any supervision failure state, the failure diagnostic kept bounded typed fields but discarded the final report. The parent receives only the fixed sanitized failure Markdown, so the exact delegate-authored terminal evidence existed only in the supervision session and was lost when the process ended. Debugging an `invalid_result`, a rejected reason line, or a delegate that misused BLOCKED required rerunning the work.

The report is delegate-authored free text and can contain anything the child wrote, including task content, paths, or secrets the assignment itself referenced. Persisting it is a local privacy risk that the metadata-only invariant avoided.

## Historical decision (schema 8)

### Schema 8

Every newly written run-telemetry record uses `schemaVersion: 8` (agent/extensions/delegated-pi-loop/diagnostics.ts). Schema 8 keeps every schema-7 field, bound, and fail-closed rule unchanged and adds exactly one failure-only `delegateReport` object. Successful-run telemetry filenames move to the exact extension-owned `success-v8-` prefix with the unchanged 4,096-record retention. Historical schema 3 through 7 files are never migrated.

### The failure-only report object

Only failure diagnostics (unsuccessful runs) carry `delegateReport`, an object with `text`, `totalBytes`, and `truncatedBytes`. An empty report omits the field. Within the object, `totalBytes` is always the original report's exact UTF-8 byte count and `truncatedBytes` is the original bytes minus the stored text bytes, so the record proves how much evidence was kept even after a cut.

The stored `text` is bounded to `DELEGATE_TOOL_OUTPUT_LIMIT` (50 KiB):

- A report within the limit survives byte-for-byte.
- An oversized report with a recognized terminal suffix keeps that suffix verbatim at the end: the exact `DELEGATE_REASON`/`DELEGATE_RESULT` terminal lines with their line separator. Recognition requires a full strict parse of the whole report by the monitor's shared terminal parser (including its report-wide exactly-one-marker predicate) and accepts only a valid COMPLETED terminal, a BLOCKED or FAILED terminal with an accepted fixed reason code, or a BLOCKED or FAILED terminal with a genuinely missing reason (no reason line anywhere in the report). The remaining budget is spent on a UTF-8-safe body prefix, so the stored text stays valid UTF-8 and within the limit while the terminal evidence survives intact.
- An oversized report without a recognized terminal suffix (including look-alike tails with non-enum reason codes, misplaced or duplicate reason lines, a reason line paired with COMPLETED, no terminal marker, or an earlier recognized duplicate result marker that makes the report invalid to the parser) keeps only the UTF-8-safe prefix truncation. A report whose parse yields no outcome or a rejected reason status therefore never has its valid-looking final tail preserved after the body cut, which would otherwise hide the evidence behind one apparent valid terminal.

The global `truncateUtf8` helper is unchanged; the suffix-aware cut lives only in the diagnostics failure view.

### Local privacy risk

The report object deliberately accepts a local privacy risk: delegate-authored report text now rests on the same local disk as the rest of the diagnostic. The risk is bounded by every existing containment rule: writes go only to `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop` with a 0700 directory and 0600 files, one bounded object per unsuccessful run, and nothing is uploaded, synced, or sent to any external service. Prompts, raw stdout/stderr, tool arguments and results, checkpoint digests, HMAC keys, Git state, credentials, and provider bodies stay excluded. Successful-run records stay metadata-only and never carry the report.

### Model-visible exclusion

The report object never becomes model-visible. Parent ToolResult content and details, the failure Markdown, TUI rendering, and every fixed summary stay exactly as schema 7 defined them: the diagnostic file path travels only in ToolResult details for the TUI footer. The parent model still cannot read the report of a failed delegate; only a local human inspecting the private log can.

### Best-effort writes

Failure-diagnostic persistence remains best-effort: a create, write, chmod, or rename failure never masks the delegate outcome, temporary supervision artifacts are still removed, and the sanitized ToolResult is still returned without a diagnostic path. Success telemetry stays best-effort metadata-only with unchanged retention.

### Analyzer eligibility

The read-only `analyze:progress-gaps` analyzer (agent/extensions/delegated-pi-loop/analyze-progress-gaps.ts) keeps its aggregate-only statistics and remains eligible only for schema version exactly 8 records of completed invocations, using the completed supervised attempt's finite non-negative maximum. Schema 3 through 7 records are ignored as historical; failure records with their report objects are never in the eligible sample because eligibility requires a completed invocation. The 1 MiB scan-input cap stays, with the failure record staying under the 50 KiB report bound.

## Historical consequences (schema 8)

- An unsuccessful run leaves its exact final report, terminal lines included, in a private local log for human debugging, with byte-exact truncation metadata.
- Terminal evidence survives the 50 KiB cut for parser-valid terminal forms (completed, accepted-reason, and genuine missing-reason terminals); invalid or reason-rejected terminal tails lose the tail to prefix truncation, and their typed outcome fields still record the rejection.
- Local disk now holds delegate-authored failure text next to the metadata; a compromised local account reads it. The metadata-only invariant survives everywhere else: success records, model-visible surfaces, the parent ToolResult, and analyzer output.
- Rollback may stop writing the report object and restore schema 7 for new writes without deleting or rewriting already written schema-8 files.

## Historical validation (schema 8)

- Diagnostics tests pin byte-for-byte preservation under the limit, exact terminal-suffix preservation with a UTF-8-safe body prefix for oversized parser-valid terminals (completed, accepted-reason, and genuine missing-reason forms across LF and CRLF, including a multibyte prefix boundary one byte below the limit), prefix truncation for oversized text without a recognized suffix (including misplaced, duplicate, malformed, Unicode, and COMPLETED-paired reason lines, duplicate-marker reports whose earlier marker is either cut away or kept in the prefix, and indented or case-mismatched look-alike controls that keep exact suffix preservation), byte-exact `totalBytes`/`truncatedBytes` metadata, the parent ToolResult exclusion, and the success-record omission.
- The full delegated-pi-loop suite, strict all-file TypeScript, `git diff --check`, and current-policy stale-text searches must pass; no model-visible instruction text changes, so the instruction reference document needs no regeneration.
