# Historical: Install the Code Review Graph Fork

This document is archived for historical reference only. Active Pi Config routing now uses `codebase-memory-mcp` as the structural code graph provider.

This machine uses the fork at `git@github.com:zer09/code-review-graph.git` instead of the upstream package from `git@github.com:tirth8205/code-review-graph.git`.

Use a local checkout because the fork is not published to PyPI or another package index.

## Prerequisites

- SSH access to `git@github.com:zer09/code-review-graph.git`
- `git`
- `uv`

## Check out the fork

```bash
mkdir -p ~/development
git clone git@github.com:zer09/code-review-graph.git ~/development/code-review-graph
cd ~/development/code-review-graph
git remote add upstream git@github.com:tirth8205/code-review-graph.git 2>/dev/null || true
git fetch origin upstream
git checkout main
git pull --ff-only origin main
```

Verify the remotes:

```bash
git remote -v
```

Expected remotes:

```text
origin   git@github.com:zer09/code-review-graph.git (fetch)
origin   git@github.com:zer09/code-review-graph.git (push)
upstream git@github.com:tirth8205/code-review-graph.git (fetch)
upstream git@github.com:tirth8205/code-review-graph.git (push)
```

## Install the fork from the local checkout

Install with `uv tool install` from the checkout path. Use `--editable` so local source changes are reflected without rebuilding the package for every code edit.

```bash
uv tool install --force --reinstall --editable ~/development/code-review-graph
```

Verify the installed command:

```bash
command -v code-review-graph
code-review-graph --version
uv tool list | grep -A2 '^code-review-graph '
```

Verify that the installed tool points at the local checkout:

```bash
uv run python - <<'PY'
from pathlib import Path
import json

tool_dir = Path.home() / ".local/share/uv/tools/code-review-graph"
matches = list(tool_dir.glob("lib/python*/site-packages/code_review_graph-*.dist-info/direct_url.json"))
if not matches:
    raise SystemExit("direct_url.json not found for code-review-graph uv tool")
for path in matches:
    data = json.loads(path.read_text())
    print(data)
PY
```

Expected `direct_url.json` shape:

```json
{"url":"file://<home>/development/code-review-graph","dir_info":{"editable":true}}
```

The exact home directory will differ by machine.

## Update the Code Review Graph MCP server

Update the MCP configuration that Pi reads from `~/.pi/agent/mcp.json`.

Use the installed local command, not `uvx`. `uvx code-review-graph serve` can resolve a published package instead of the fork.

```json
{
  "mcpServers": {
    "code-review-graph": {
      "command": "code-review-graph",
      "args": ["serve"],
      "type": "stdio"
    }
  }
}
```

If the MCP host cannot find `code-review-graph` on `PATH`, set `command` to the expanded absolute path printed by:

```bash
command -v code-review-graph
```

Restart Pi after changing `mcp.json`, then reconnect or list the Code Review Graph MCP server. It should expose the Code Review Graph tools.

## MCP compatibility expectations

The installed MCP server should expose these behavior-level contracts. Consumer-facing Pi skills should describe these contracts, not repository provenance:

- `code_review_graph_get_minimal_context_tool` exists for compact orientation.
- `code_review_graph_get_architecture_overview_tool` accepts `detail_level` and supports `"minimal"`.
- Supported high-volume tools expose `detail_level` where documented by `code_review_graph_get_docs_section_tool(section_name="commands")`.
- `code_review_graph_get_community_tool` accepts `include_member_names` and `members_sample_limit` for bounded community output.
- `code_review_graph_apply_refactor_tool` defaults `dry_run` to `false`; use `dry_run: true` for previews unless edits are intended.

Expected MCP tool count is 30 unless the installed Code Review Graph version intentionally adds or removes tools.

## Install/update-only fork delta

Keep fork/upstream details in this installation document, not in consumer-facing agent rules. The current local fork is based on upstream v2.3.3 and adds these MCP compatibility checks:

- Bounded architecture overview responses with `detail_level` and minimal mode.
- Bounded community detail responses with sampled members by default.
- Schema-checked MCP docs via `docs/COMMANDS.md`, `docs/LLM-OPTIMIZED-REFERENCE.md`, and `code_review_graph_get_docs_section_tool(section_name="commands")`.
- Fork diagnostic docs via `code_review_graph_get_docs_section_tool(section_name="fork-differences")`.

## Update after pulling fork changes

```bash
cd ~/development/code-review-graph
git fetch origin
git pull --ff-only origin main
uv tool install --force --reinstall --editable .
code-review-graph --version
```

Reinstall after dependency, entry point, or packaging changes. Plain source edits are usually visible immediately because the tool is installed editable.

## Validation checklist

```bash
code-review-graph --version
uv run python - <<'PY'
from pathlib import Path
import json

tool_dir = Path.home() / ".local/share/uv/tools/code-review-graph"
for path in tool_dir.glob("lib/python*/site-packages/code_review_graph-*.dist-info/direct_url.json"):
    print(json.loads(path.read_text()))
PY
```

Checklist:

- `code-review-graph --version` prints the expected version.
- `direct_url.json` points to `~/development/code-review-graph` and includes `"editable": true`.
- `~/.pi/agent/mcp.json` uses `"command": "code-review-graph"` with `"args": ["serve"]`.
- The Code Review Graph MCP server exposes 30 tools.
- `code_review_graph_get_architecture_overview_tool` accepts `detail_level` and supports `"minimal"`.
- Supported high-volume tools expose `detail_level` where documented by `code_review_graph_get_docs_section_tool(section_name="commands")`.
- `code_review_graph_get_community_tool` accepts `include_member_names` and `members_sample_limit`.
- `code_review_graph_get_docs_section_tool(section_name="commands")` returns compact current MCP signatures.
- `code_review_graph_get_docs_section_tool(section_name="fork-differences")` returns the fork-differences summary.
- Pi has been restarted after MCP configuration changes.
