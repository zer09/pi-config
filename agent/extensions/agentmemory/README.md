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
- `memory_slot_list` - list read-only AgentMemory slots
- `memory_slot_get` - read a named AgentMemory slot
- `memory_mcp_resources` - list read-only AgentMemory MCP resources
- `memory_mcp_resource_read` - read an exact `agentmemory://` MCP resource URI
- `memory_mcp_prompts` - list AgentMemory MCP prompt templates
- `memory_mcp_prompt_get` - return MCP prompt text for review, not automatic execution

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
- Pi-local secret refusal and AgentMemory output redaction are enabled by default; `PI_AGENTMEMORY_SECURITY_ENABLED=0` disables only those local checks.
- `memory_save` refuses obvious secret-looking values when security is enabled.
- Conversation capture redacts obvious secret-looking values before calling `/agentmemory/observe` when security is enabled.
- MCP resource and prompt wrappers are read-only; prompt wrappers return text for agent review and do not auto-inject or execute returned prompts.
- Slot reads are default read-only tools. Slot writes are persistent state changes and stay gated; normal new memories should use `memory_save` unless the user explicitly asks for a named slot write.
- Broad, destructive, or mutating AgentMemory tools are not registered by default.
- Set `AGENTMEMORY_PI_ENABLE_GATED=1` to register gated wrappers. High-risk gated wrappers still require exact local `confirm` phrases and strip `confirm` before forwarding upstream.

Gated tools registered only when `AGENTMEMORY_PI_ENABLE_GATED=1`:

```text
memory_lesson_save
memory_consolidate
memory_reflect
memory_insight_list
memory_audit
memory_export
memory_governance_delete
memory_heal
memory_slot_create
memory_slot_append
memory_slot_replace
memory_slot_delete
```

Confirmation phrases:

```text
memory_export: confirm="export agentmemory"
memory_heal: confirm="heal agentmemory" unless dryRun is true
memory_governance_delete: confirm="delete memories:<comma-separated sorted ids>"
memory_slot_create: confirm="create slot:<label>"
memory_slot_append: confirm="append slot:<label>"
memory_slot_replace: confirm="replace slot:<label>"
memory_slot_delete: confirm="delete slot:<label>"
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AGENTMEMORY_URL` | `http://localhost:3111` | AgentMemory server URL |
| `AGENTMEMORY_SECRET` | (none) | Bearer token for protected instances |
| `AGENTMEMORY_REQUIRE_HTTPS` | (off) | When set to `1`, refuse bearer auth over plaintext HTTP to non-loopback hosts |
| `AGENTMEMORY_PI_ENABLE_GATED` | (off) | When set to `1`, register gated AgentMemory wrappers. Destructive or broad-private operations still require exact user intent and local `confirm` phrases. |
| `PI_AGENTMEMORY_SECURITY_ENABLED` | `1` | Enables Pi-local save refusal and AgentMemory output redaction. Set to `0`, `false`, `no`, `off`, or `disabled` to disable those local checks. Unknown values stay enabled. Bearer HTTPS enforcement and URL diagnostic scrubbing are independent. |
| `PI_DELEGATE_CHILD` | (off) | Local pi delegate marker; skips AgentMemory tools, hooks, and bundled skill discovery |

## Upstream sync workflow

Use the canonical upgrade guide before syncing a new upstream AgentMemory version:

```text
docs/agentmemory-upgrade-process.md
```

The default tool policy lives in:

```text
tool-policy.json
```

Run the local sync checker after updating or selecting the upstream AgentMemory clone:

```bash
npm run check:sync -- --upstream <path-to-agentmemory-clone>
```

You can also set `AGENTMEMORY_UPSTREAM=<path-to-agentmemory-clone>` and run `npm run check:sync`.

Useful inspection command:

```bash
node scripts/extract-upstream-tools.mjs --upstream <path-to-agentmemory-clone>
```

The checker verifies that every upstream MCP tool is categorized as default, gated, or not exposed, that server cases match the registry, and that local Pi safety invariants are still present.

## Smoke test

Run pi and ask it to use these read-only checks:

```text
memory_health
memory_diagnose
memory_slot_list
memory_mcp_resources
memory_mcp_prompts
/agentmemory-status
```

For direct HTTP smoke checks against the default local server:

```bash
curl http://localhost:3111/agentmemory/health
curl http://localhost:3111/agentmemory/diagnostics/followup
```

You should see `agentmemory healthy`, a footer status like `🧠 agentmemory`, no policy drift warning when the server version matches `tool-policy.json`, and followup diagnostic data when the server exposes `/agentmemory/diagnostics/followup`.

## See also

- [agentmemory main README](../../README.md)
- [Hermes integration](../hermes/README.md)
- [OpenClaw integration](../openclaw/README.md)
