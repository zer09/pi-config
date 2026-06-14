# Figma MCP config reference

Use this snippet to register the Figma MCP server as a streamable HTTP server with bearer auth pulled from your env.

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
- Persist for future sessions: add the export line to your shell profile, then restart the shell or your IDE.
- Verify before launching the agent: confirm `FIGMA_OAUTH_TOKEN` is non-empty without printing the token value into logs or chat.

## Setup and verification checklist

- Add the snippet above to the agent MCP config under `[mcp_servers.figma]`.
- Restart the agent or IDE after updating config and env vars.
- Ask the agent to list Figma tools or run a simple read-only Figma call to confirm the server is reachable.

## Troubleshooting

- Token not picked up: export `FIGMA_OAUTH_TOKEN` in the same shell that launches the agent, or add it to your shell profile and restart.
- OAuth errors: verify the RMCP client setting is enabled if required and that the bearer token is valid. Tokens copied from Figma should not include surrounding quotes.
- Network or headers: keep the `X-Figma-Region` header; if your org uses another region, update the header consistently across config and requests.

## Usage reminders

- The server is link-based: copy the Figma frame or layer link, then ask the MCP client to implement that URL. The client extracts the node ID from the link; it does not browse the page.
- If output feels generic, restate the project-specific rules from the main skill and ensure you follow the required flow: `get_design_context`, optionally `get_metadata`, then `get_screenshot`.
