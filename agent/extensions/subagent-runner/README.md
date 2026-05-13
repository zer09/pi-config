# subagent-runner

Pi extension that registers `subagent_run`.

`subagent_run` starts a scoped child Pi process, lets it use the normal Pi toolbox, and returns only compact structured JSON to the parent agent.

## Default invocation

```bash
pi --mode json \
  --session-dir ~/.pi/agent/subagent-sessions/<workstream>/<agent> \
  --continue \
  --append-system-prompt "<subagent bootstrap + role contract>" \
  "<task>"
```

`--continue` is always safe for normal calls: first run creates a session, later runs resume the most recent session in that isolated directory.

## Safety defaults

- Read-only mode by default.
- Context Watcher is mandatory in the child prompt.
- Code Review Graph first for supported code exploration and review.
- Context Mode for shell/read-only commands and large output.
- Child sessions live under `~/.pi/agent/subagent-sessions/`.
- Recursive sub-agent calls are disabled by default through `PI_SUBAGENT_CHILD=1`.
- Parent receives structured JSON only.

## Tool input

```json
{
  "agent": "investigator",
  "cwd": "<project-root>",
  "workstream": "pi-subagent-runner",
  "mode": "read",
  "task": "Investigate the scoped question and return structured findings.",
  "timeoutMs": 120000
}
```

Supported agents:

- `investigator`
- `reviewer`
- `tester`
- `docs-researcher`
- `oracle`

## Model selection

Prefer provider-qualified model ids from Pi's model list:

```bash
pi --list-models gpt-5.3-codex
```

Use the returned `provider/model` pair, for example `openai-codex/gpt-5.3-codex`. The runner validates `model` before launching a child. Exact short ids are normalized when they are unambiguous; ambiguous or unavailable model names fail before spawning Pi and return suggested provider-qualified ids.

## Smoke test

```bash
cd ~/.pi/agent/extensions/subagent-runner
bun run smoke.test.ts
```
