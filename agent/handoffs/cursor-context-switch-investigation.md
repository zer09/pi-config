# Cursor context-switch investigation

Date: 2026-05-06

## Summary

- Observed issue: after switching to Cursor model, agent appeared to forget prior context.
- Verified result: context was NOT lost in payload.
- Actual failure mode: Cursor entered tool-resume loop after tool pause/cancel.

## Evidence

### 1) Cursor payload contained prior context
From log:
- `/tmp/pi-cursor-provider-debug-2026-05-06T15-00-00-956Z-84878.log`
- Request `req-1` includes messages:
  - `Remember codeword: ORANGE-913`
  - assistant confirmation of `ORANGE-913`
  - repeated user asks for codeword
- `chat.parsed_messages` shows turns already containing correct answer.

Conclusion: provider received prior history correctly.

### 2) Loop behavior after tool pause/cancel
Same log shows sequence:
- `stream.tool_call_pause`
- `chat.resume_tool_results`
- `tool_resume.start`
- repeat across many requests

Conclusion: behavior drift came from tool continuation loop, not missing history.

### 3) Claude bridge check
- `~/.pi/agent/claude-bridge.log` showed normal import/rebuild paths with prior messages in latest runs.
- No direct evidence of context loss there for this scenario.

## Root cause assessment

Most likely root issue:
- Cursor provider tool continuation state persisted and kept re-entering resume path.
- Simple recall query got routed into tool workflow instead of direct answer path.

Not root cause:
- Context window exhaustion
- Missing prior messages in provider request payload

## Proposed patch (not implemented yet)

1) No-tool fast path for simple recall prompts
- Detect short factual recall prompts (e.g. "what is the codeword?")
- If recent turns already include direct answer, skip tool path.

2) Resume-loop breaker
- Cap consecutive `chat.resume_tool_results` attempts per (sessionId, turn/user prompt).
- If cap exceeded:
  - clear active bridge state for that key
  - reset continuation path
  - return clean failure or direct-answer attempt

3) Post-cancel cleanup hardening
- On cancellation-related pause, clear stale pending exec state more aggressively.
- Prevent repeated partial resume on identical turn.

## Repro notes

Minimal repro used:
1. `Remember codeword: ORANGE-913`
2. `What is the codeword?`
3. `/model` switch to Cursor
4. `What is the codeword?`

Observed with debug enabled:
- Cursor extension log: `/tmp/pi-cursor-provider-extension-debug-2026-05-06T15-00-00-952Z-84878.log`
- Cursor provider log: `/tmp/pi-cursor-provider-debug-2026-05-06T15-00-00-956Z-84878.log`

## Status

- Investigation done.
- Fix deferred (user testing different provider first).
