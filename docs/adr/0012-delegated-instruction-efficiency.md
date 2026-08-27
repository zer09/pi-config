# ADR 0012: Make delegated instructions compact, tool-attributed, and machine-timed

## Status

Accepted (2026-08-27). Extends ADR 0007 and ADR 0011. Routing, role permissions, concurrency, subprocess supervision, RPC framing, report parsing, fallback, cleanup, diagnostics, and resource isolation are unchanged.

Current-policy note (renewable liveness): the statement that the supervisor enforces a 45-minute productive-work deadline is superseded by ADR 0013. The supervisor still owns every wall-clock decision; the five-minute activity warning and ten-minute activity-idle termination are unchanged, and the 45-minute value is now a renewable maximum gap between novel structural checkpoints rather than a total-work ceiling. The recovery-eligibility phrase "with output and work budget remaining" is likewise superseded: recovery eligibility keeps the output cap, a running child, no prior recovery, no abort, and no begun liveness termination, but consults no work budget. No model-visible instruction changed.

## Context

ADR 0011 centralized every model-visible delegation instruction in `agent/extensions/delegated-pi-loop/instructions.ts` without changing its wording. The active parent surface still carried 24 long workflow guidelines, most of which did not name `delegate_run` even though Pi appends custom-tool guidelines as one flat ungrouped list. Solution and review waiver text repeated the same rules, schema descriptions repeated role lists already present in the generated enum and workflow, and runtime-enforced transport details consumed model context without helping the parent choose its next action.

Every child prompt also carried 460 local `o200k_base` tokens of shared instructions before its role contract and assignment. The 310-token terminal protocol dominated that cost. The report-recovery prompt repeated the complete reason-code list even though recovery runs in the same child session and the original terminal protocol remains in context.

The child attempt budget also asked the model to stop after ten minutes without new evidence. A model has no reliable wall-clock awareness unless it performs distracting clock checks. The supervisor already owns monotonic time and programmatically enforces a five-minute idle warning, ten-minute idle termination, and one 45-minute productive-work deadline.

Finally, `agent/AGENTS.md` already defines one exact-prefix `OVERRIDE:` mechanism for every agent workflow, gate, contract, sequence, delegation, review, verification, planning, and retry rule. Maintaining a second natural-language waiver grammar only for failed delegated gates duplicated permission semantics and increased ambiguity.

## Decision

### Parent guidelines become a labeled decision flow

`delegateRunPromptGuidelines` uses 15 ordered, labeled guidelines covering ownership, role scope, fast path, investigation, failed gates, partial evidence, oracle handling, execution, review, findings, remediation, routing, failure/authority, and skills. Every guideline begins with `delegate_run`, as required by Pi's flat custom-tool guideline model.

Dynamic solution and review role ids still derive from the validated routing snapshot. The workflow lists each configured role once and says to wait for every role; it no longer emits redundant English count words. The role schema description relies on the generated enum for exact ids instead of repeating both gate lists.

The tool descriptions and parameter descriptions state only model decisions and input semantics. Streaming timestamps, process implementation details, and other runtime-enforced mechanics stay out of permanent model text.

### The general override mechanism owns failed-gate permission

A required non-completed role blocks its gate by default. Continuing requires an applicable exact `OVERRIDE:` directive naming the failed role and current gate. Generic continue, commit, or skip-retry wording waives nothing. The parent records the override and never labels a failed role completed or passed.

Without a broader override, solution synthesis still requires at least one completed report and uses only completed reports plus parent-verified repository evidence. Findings from completed reviews remain binding and follow verification and remediation. The extension does not parse or persist override state; this remains parent-side orchestration policy governed by `agent/AGENTS.md`.

### The supervisor owns time

The child prompt keeps a semantic budget: at most two materially equivalent attempts for each proof or gate, repeat only when new evidence justifies it, then report `BLOCKED` if the result remains unavailable. The child prompt contains no minute, clock, or elapsed-time instruction.

The supervisor remains the only wall-clock authority. It uses monotonic time for the five-minute activity warning, ten-minute activity-idle termination, and, since ADR 0013, a renewable 45-minute structural-progress lease instead of a total productive-work deadline. This change does not alter the supervisor's time semantics; the lease replacement is governed by ADR 0013.

### Child prompts expose the task earlier and use a compact terminal grammar

The child prompt order is safety, role, assignment, attempt limits, then final protocol. Shared safety, role contracts, restart text, and report wording are shortened without changing permissions or required report content.

The terminal protocol shows the three exact valid terminal forms. BLOCKED and FAILED reason lists are generated from `BLOCKED_REASON_CODES` and `FAILED_REASON_CODES`, which are also consumed by the parser, so model-visible reason values cannot silently drift from runtime enforcement.

### Recovery remains programmatic and same-session

Recovery behavior is unchanged. When round 1 settles as `missing_report` or `invalid_result`, and the child is alive with output and work budget remaining, `supervisor.ts` programmatically sends one `prompt-2` command containing `REPORT_RECOVERY_PROMPT` to the same child process and session. The recovery prompt prohibits repeated work and asks for one self-contained report using existing evidence. It references the original final protocol instead of repeating every reason code.

Round 2 never receives another recovery prompt. Provider failure, prompt rejection, interruption, output exhaustion, deadline expiry, a stopped child, or an invalid second response still fails closed under the existing supervisor rules.

## Consequences

- Parent workflow guidelines become shorter and every flat guideline is unambiguous about its tool.
- The general `OVERRIDE:` mechanism becomes the single user-authorized process escape hatch in this configuration.
- Children no longer pretend to track wall-clock time; programmatic supervisor deadlines remain authoritative.
- Child assignments present the actual task before attempt and terminal details.
- Reason-code prompt text derives from the runtime enums.
- Same-session programmatic report recovery is preserved exactly.
- The synchronized reference document remains generated from `instructions.ts` through `docsync.ts`.
- Historical waiver and centralization decisions remain recorded in ADR 0007 and ADR 0011, with this ADR superseding their current model-visible wording.

## Validation

- Every parent guideline starts with `delegate_run`.
- Every catalog guideline starts with `delegate_model_catalog`.
- Dynamic routing snapshots regenerate exact solution and review role lists without count-word helpers.
- Child attempt text contains the two-attempt and new-evidence rules but no wall-clock terms.
- Every closed terminal reason code appears in the generated child terminal protocol.
- Parent workflow terms remain absent from child prompt templates.
- Same-process, same-session, one-round recovery tests remain unchanged except for the canonical recovery text.
- `npm run render:instructions-doc`, the full delegated-pi-loop suite, strict TypeScript, and whitespace checks must pass.
