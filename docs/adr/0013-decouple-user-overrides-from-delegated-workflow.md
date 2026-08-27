# ADR 0013: Keep user overrides out of delegated workflow policy

## Status

Accepted (2026-08-27). Supersedes ADR 0012 only where ADR 0012 makes the general `OVERRIDE:` mechanism a delegated gate or process escape hatch. Instruction centralization, compact tool attribution, role policy, routing, concurrency, supervision, fallback, cleanup, diagnostics, resource isolation, and report recovery remain unchanged.

## Context

`agent/AGENTS.md` defines `OVERRIDE:` so the user can explicitly supersede conflicting user-configurable instructions. The mechanism covers global and project context files, local custom prompts, and agent-process rules within the authority available to those files.

ADR 0012 incorrectly reused that mechanism inside `delegate_run` guidance. The delegated workflow told the parent that failed gates could continue only after the user supplied a specific `OVERRIDE:` directive. This converted a user-controlled precedence mechanism into an agent-controlled workflow requirement. It also caused an orchestrator to request override syntax when the user had already given an ordinary instruction to continue after a delegate timeout.

A timeout or other non-completed result still needs explicit reporting and must not be mislabeled as success. That requirement does not justify making the user invoke an override mechanism. The agent must follow ordinary user instructions when they do not need to supersede a conflicting instruction, and only the user decides whether to issue `OVERRIDE:` when explicit precedence is needed.

## Decision

### Override remains user-controlled instruction precedence

`agent/AGENTS.md` describes `OVERRIDE:` only as a user-controlled instruction-precedence mechanism. An agent, delegate, extension, tool, or workflow must not request, require, or suggest override syntax. The mechanism is not a workflow step, gate, permission prompt, retry token, or failure-recovery command.

An exact user `OVERRIDE:` directive can supersede conflicting user-configurable instructions, including global or project `AGENTS.md` and `CLAUDE.md`, local `SYSTEM.md` or custom-prompt rules, and agent-process rules. Its stated scope and duration remain authoritative.

This repository rule cannot supersede actual platform system or developer instructions, platform safety controls, tool enforcement, operating-system permissions, or third-party access controls. Git and hosted-service actions still require explicit authorization for the named action.

### Delegated workflows never request override syntax

The canonical `delegateRunPromptGuidelines` contains no `OVERRIDE:` reference. A required non-completed solution, review, oracle, implementation, remediation, or verification result stops automatic advancement where applicable. The parent reports the result, preserves valid completed evidence and current tree state, and follows the user's ordinary next instruction.

A user request to continue, resume, or retry needs no special syntax. It does not convert a failed role into a completed or passed role. Before continuing a non-completed mutating role, the parent inspects the current tree because the prior attempt may have changed it.

If the user directs continuation from partial solution evidence, synthesis uses at least one completed report plus parent-verified repository evidence. Findings from completed reviews remain binding unless the user explicitly directs otherwise. These are default delegated-workflow behaviors, not override grammar.

### Automatic behavior remains bounded

The extension still performs only its configured automatic provider fallback and same-session report recovery. It does not create an unlimited retry loop. After bounded automatic behavior ends in a non-completed state, the parent reports that state and waits for or follows the user's next instruction.

## Consequences

- Agents no longer ask users to type `OVERRIDE:` after delegate timeouts or failed gates.
- Ordinary `continue`, `resume`, and `retry` instructions can keep the operation moving without special syntax.
- Only the user decides when an explicit precedence directive is necessary.
- Failed roles remain accurately reported and are never relabeled as completed or passed.
- Runtime routing, provider fallback, deadlines, cleanup, diagnostics, role isolation, and child prompts are unchanged.
- Historical waiver and exact-prefix decisions remain recorded in ADR 0007 and ADR 0012, but they no longer state current delegated-workflow policy.

## Validation

- No `delegate_run` prompt guideline contains `OVERRIDE:`.
- Parent guidelines state that failures stop automatic advancement and that the parent follows the user's next instruction.
- Parent guidelines state that continue, resume, or retry needs no special syntax.
- `agent/AGENTS.md` prohibits agents from requesting or suggesting an `OVERRIDE:` directive.
- `agent/AGENTS.md` preserves the actual platform and permission boundary.
- Generated instruction documentation matches `instructions.ts`.
- The full delegated-pi-loop suite, strict TypeScript checks, and whitespace checks pass.
