# Figma MCP config reference

This TOML example applies to hosts using `[mcp_servers]` configuration. Use the active host's MCP schema and configuration location. The example registers streamable HTTP with bearer auth read from the environment.

```toml
[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
http_headers = { "X-Figma-Region" = "us-east-1" }
```

## Notes and options

- The bearer token must be available as `FIGMA_OAUTH_TOKEN` in the environment that launches the agent.
- Keep the region header aligned with your Figma region. If your org uses another region, update `X-Figma-Region` consistently.
- OAuth on streamable HTTP requires the RMCP client when the host supports that setting.
- Optional per-server timeouts, such as `startup_timeout_sec` and `tool_timeout_sec`, can be set inside `[mcp_servers.figma]` if needed.

## Env var setup

- One-time set for current shell: `export FIGMA_OAUTH_TOKEN="<token>"`
- For future sessions, use the host's supported secret mechanism or inject the variable from a credential manager. Do not save literal tokens in rule files or configuration examples.
- Verify before launching the agent: confirm `FIGMA_OAUTH_TOKEN` is non-empty without printing the token value into logs or chat.

## Setup and verification checklist

- Add the snippet above to the agent MCP config under `[mcp_servers.figma]`.
- Restart the agent or IDE after updating config and env vars.
- Ask the agent to list Figma tools or run a simple read-only Figma call to confirm the server is reachable.

## Troubleshooting

- Token not picked up: make `FIGMA_OAUTH_TOKEN` available in the environment that launches the agent, then restart the agent.
- OAuth errors: verify the RMCP client setting is enabled if required and that the bearer token is valid. Tokens copied from Figma should not include surrounding quotes.
- Network or headers: keep the `X-Figma-Region` header; if your org uses another region, update the header consistently across config and requests.

## Usage reminders

- Remote requests use a frame or layer link to identify the target; supported desktop requests can use the current selection. See [tools and prompt patterns](figma-tools-and-prompts.md) for context-only requests.
- For code deliverables, use [figma-implement-design](../../figma-implement-design/SKILL.md), which owns the required context workflow and project integration decisions.
