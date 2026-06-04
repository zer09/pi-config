# ADR 0004: AgentMemory workflow state policy

## Status

Accepted

## Context

AgentMemory exposes upstream tools for actions, frontiers, leases, signals, checkpoints, sentinels, routines, sketches, and crystallization. Those tools can turn AgentMemory from durable memory into a persistent workflow/task-state system.

Pi already has local workflow mechanisms: plans under `plans/`, session handoffs under `handoffs/`, Context Watcher routing, delegates, and ordinary in-session task planning. Enabling AgentMemory workflow state without a deliberate policy would split task authority across systems and make future agents unsure where live work state belongs.

## Decision

Do not expose AgentMemory workflow/task-state tools in Pi by default.

Pi plans, handoffs, delegates, Context Watcher, and normal agent planning remain the default systems for task and workflow state. AgentMemory remains the durable memory and provenance system: recall, preferences, prior decisions, file history, session history, commit provenance, lessons, diagnostics, and explicitly saved non-secret memories.

The following AgentMemory tools must stay not exposed unless a future ADR explicitly adopts a Pi role for persistent AgentMemory workflow state:

- `memory_action_create`
- `memory_action_update`
- `memory_frontier`
- `memory_next`
- `memory_lease`
- `memory_signal_send`
- `memory_signal_read`
- `memory_checkpoint`
- `memory_sentinel_create`
- `memory_sentinel_trigger`
- `memory_routine_run`
- `memory_sketch_create`
- `memory_sketch_promote`
- `memory_crystallize`

If a future slice proposes exposing any of these tools, it must first update or supersede this ADR with the ownership model, migration expectations, safety gates, and how it interacts with plans and handoffs.

## Consequences

- The Pi AgentMemory extension remains a curated memory surface, not a second task manager.
- Agents should put actionable plans in `plans/` or user-visible handoffs, not AgentMemory action/frontier/lease/signal state.
- Upstream workflow features can still be reconsidered later, but only with an explicit ADR and policy update.
- The sync checker enforces this default-deny decision so upstream drift does not accidentally expose workflow/task-state tools.

## Validation

- `tool-policy.json` classifies the workflow/task-state tools as not exposed.
- `check-upstream-sync.mjs` fails if those tools leave the not-exposed category without a deliberate policy change.
- AgentMemory docs and the bundled skill route workflow state back to Pi plans and handoffs.
