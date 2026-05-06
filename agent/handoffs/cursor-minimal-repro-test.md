# Cursor minimal repro test

## Purpose
Verify whether model switch to Cursor preserves context and does not enter tool-resume loop.

## Steps

1. Clear old logs
- `rm -f ~/.pi/agent/claude-bridge.log`
- `rm -f /tmp/pi-cursor-provider-debug-*.log /tmp/pi-cursor-provider-extension-debug-*.log`

2. Enable debug in same terminal
- `export PI_CURSOR_PROVIDER_DEBUG=1`
- `export CLAUDE_BRIDGE_DEBUG=1`

3. Start Pi in that same terminal

4. Send exact prompts
- `Remember codeword: ORANGE-913`
- `What is the codeword?`
- `/model cursor/default` (or preferred cursor model)
- `What is the codeword?`

5. If Cursor starts tool spam
- Cancel once
- Stop test (do not continue extra turns)

6. Collect logs
- `tail -n 200 ~/.pi/agent/claude-bridge.log`
- `ls -t /tmp/pi-cursor-provider-debug-*.log | head -n 1`
- `ls -t /tmp/pi-cursor-provider-extension-debug-*.log | head -n 1`

## Pass criteria
- Cursor answers codeword correctly after model switch.
- No repeating loop of:
  - `chat.resume_tool_results`
  - `tool_resume.start`
  - `stream.tool_call_pause`

## Fail criteria
- Cursor ignores known codeword despite payload containing prior turns.
- Repeated tool-resume loop after cancel.
