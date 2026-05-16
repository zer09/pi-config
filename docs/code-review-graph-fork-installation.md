# Install the Code Review Graph Fork

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
python3 - <<'PY'
from importlib.metadata import distribution

dist = distribution("code-review-graph")
print(dist.version)
print(dist.read_text("direct_url.json"))
PY
```

Expected `direct_url.json` shape:

```json
{"url":"file:///home/USER/development/code-review-graph","dir_info":{"editable":true}}
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
python3 - <<'PY'
from importlib.metadata import distribution
print(distribution("code-review-graph").read_text("direct_url.json"))
PY
```

Checklist:

- `code-review-graph --version` prints the expected version.
- `direct_url.json` points to `~/development/code-review-graph` and includes `"editable": true`.
- `~/.pi/agent/mcp.json` uses `"command": "code-review-graph"` with `"args": ["serve"]`.
- Pi has been restarted after MCP configuration changes.
