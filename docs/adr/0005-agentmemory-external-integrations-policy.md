# ADR 0005: AgentMemory external integrations policy

## Status

Accepted

## Context

Upstream AgentMemory includes optional integrations and workflows beyond the Pi-native extension, including Codex, GitHub Copilot MCP configuration, OpenCode capture, OpenClaw, Hermes, generic MCP configuration, Obsidian export, team/mesh sharing, and vision/image embeddings.

This Pi config already has a curated AgentMemory extension with local redaction, HTTPS guardrails, default-off gated tools, diagnostics, skill routing, and lifecycle capture. Installing additional integration config by default can duplicate capture hooks, create confusing provenance, increase maintenance burden, and bypass the curated Pi policy surface.

Some optional integrations also cross stronger boundaries:

- Obsidian export writes private memory content to files.
- Team and mesh sharing cross collaboration and privacy boundaries.
- Vision/image embeddings require provider, storage, and privacy decisions.
- Generic MCP config can expose upstream tools outside Pi's curated wrapper policy.

## Decision

Do not install or enable optional AgentMemory external integrations by default.

The Pi-native AgentMemory extension remains the canonical AgentMemory surface for Pi. Add an external integration only when the user actively uses that client or workflow and the change names the integration, owner, expected capture/provenance behavior, security boundaries, and removal path.

The following tool-backed external integration surfaces must stay not exposed unless a future policy explicitly adopts them:

- `memory_claude_bridge_sync`
- `memory_vision_search`
- `memory_team_share`
- `memory_team_feed`
- `memory_mesh_sync`
- `memory_obsidian_export`

Do not add AgentMemory as a generic Pi MCP server while the curated extension is active unless a future ADR explains how the generic MCP surface preserves the same policy gates.

## Consequences

- External AgentMemory clients are opt-in by active use case, not copied during routine upstream sync.
- Pi avoids duplicate capture paths and keeps memory provenance anchored in the Pi extension.
- Export, team/mesh, and vision/image memory remain unavailable until their storage, privacy, confirmation, and redaction policies exist.
- The sync checker enforces default-deny for tool-backed external integration surfaces.

## Validation

- `tool-policy.json` keeps the tool-backed external integration surfaces in `notExposedTools`.
- `check-upstream-sync.mjs` fails if those tools leave the not-exposed category without an explicit policy update.
- README and upgrade docs tell maintainers not to install optional external integration config by default.
