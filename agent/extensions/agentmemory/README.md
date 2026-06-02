<p align="center">
  <img src="../../assets/banner.png" alt="agentmemory" width="640" />
</p>

<h1 align="center">
  &nbsp;agentmemory for pi
</h1>

<p align="center">
  <strong>Your pi sessions remember useful cross-session context.</strong><br/>
  <sub>Persistent memory via <a href="https://github.com/rohitg00/agentmemory">agentmemory</a>, exposed to pi through a curated native extension.</sub>
</p>

---

## Quick setup

Start the agentmemory server in a separate terminal:

```bash
npx @agentmemory/agentmemory
```

Place this folder under pi's global extensions directory:

```bash
~/.pi/agent/extensions/agentmemory
```

If you prefer explicit loading, enable it in `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["~/.pi/agent/extensions/agentmemory"]
}
```

Pi can also auto-discover extensions in `~/.pi/agent/extensions/`, and `/reload` can hot-reload extension changes.

## What it adds

Default Pi tools:

- `memory_health` - check whether the AgentMemory REST server is reachable
- `memory_search` - friendly compatibility search for prior decisions, bugs, workflows, and preferences
- `memory_save` - save durable non-secret facts, workflows, preferences, or bug fixes
- `memory_smart_search` - MCP-compatible hybrid AgentMemory search
- `memory_recall` - richer prior-session recall with format and token-budget controls
- `memory_sessions` - list recent AgentMemory sessions
- `memory_file_history` - retrieve history for specific files
- `memory_timeline` - chronological observations around an anchor
- `memory_patterns` - recurring patterns across sessions
- `memory_profile` - project/profile summary
- `memory_commit_lookup` - sessions linked to a commit SHA
- `memory_commits` - recent commits linked to sessions
- `memory_diagnose` - read-only diagnostics
- `memory_verify` - provenance verification by memory ID
- `memory_lesson_recall` - recall durable lessons

Command and lifecycle behavior:

- `/agentmemory-status` - check health from inside pi
- `resources_discover` - contributes the bundled `skills/agentmemory/SKILL.md` skill
- `before_agent_start` - injects relevant memories into the prompt
- `agent_end` - captures completed conversation turns back to AgentMemory

This extension intentionally does not expose all AgentMemory MCP tools by default.

## Bundled skill

The Pi-specific AgentMemory skill lives beside the extension:

```text
agent/extensions/agentmemory/skills/agentmemory/SKILL.md
```

The extension publishes that directory through Pi's `resources_discover` event. Keeping the skill bundled with the extension makes upstream sync easier and avoids a separate global `agent/skills/agentmemory` copy.

## Safety behavior

- Delegate child sessions are skipped when `PI_DELEGATE_CHILD` is set.
- Headless sessions do not write UI status.
- Bearer auth is sent only as an `Authorization` header.
- `AGENTMEMORY_REQUIRE_HTTPS=1` refuses to send a bearer token over plaintext HTTP to non-loopback hosts.
- `memory_save` refuses obvious secret-looking values.
- Conversation capture redacts obvious secret-looking values before calling `/agentmemory/observe`.
- Broad, destructive, or mutating AgentMemory tools are not registered by default.

Gated tools reserved for explicit future workflows:

```text
memory_lesson_save
memory_consolidate
memory_reflect
memory_insight_list
memory_audit
memory_export
memory_governance_delete
memory_heal
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AGENTMEMORY_URL` | `http://localhost:3111` | AgentMemory server URL |
| `AGENTMEMORY_SECRET` | (none) | Bearer token for protected instances |
| `AGENTMEMORY_REQUIRE_HTTPS` | (off) | When set to `1`, refuse bearer auth over plaintext HTTP to non-loopback hosts |
| `PI_DELEGATE_CHILD` | (off) | Local pi delegate marker; skips AgentMemory tools, hooks, and bundled skill discovery |

## Upstream sync workflow

The default tool policy lives in:

```text
tool-policy.json
```

Run the local sync checker after updating the upstream AgentMemory clone:

```bash
node scripts/check-upstream-sync.mjs --upstream /home/gc/development/agentmemory
```

Useful inspection command:

```bash
node scripts/extract-upstream-tools.mjs --upstream /home/gc/development/agentmemory
```

The checker verifies that every upstream MCP tool is categorized as default, gated, or not exposed, that server cases match the registry, and that local Pi safety invariants are still present.

## Smoke test

Run pi and ask it to use `memory_health`, or call the command directly:

```text
/agentmemory-status
```

You should see `agentmemory healthy` and a footer status like `🧠 agentmemory`.

## See also

- [agentmemory main README](../../README.md)
- [Hermes integration](../hermes/README.md)
- [OpenClaw integration](../openclaw/README.md)
