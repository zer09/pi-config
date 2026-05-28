---
name: troubleshooting
description: Uses Chrome DevTools MCP and documentation to troubleshoot connection and target issues. Trigger this skill when list_pages, new_page, or navigate_page fail, or when the server initialization fails.
---

# Chrome DevTools MCP troubleshooting

Use this playbook when Chrome DevTools MCP fails to start, connect, list pages, navigate, or expose expected tools.

## Safety and routing

- Do not edit MCP configs, kill browsers, install packages, or change global tools unless the user explicitly asks for that action.
- Prefer read-only diagnostics first: capture the exact error, MCP client, OS/container context, Node version, and server args.
- Use Context Mode for logs, `npx --help` output, GitHub issue searches, and troubleshooting docs.
- If `npx chrome-devtools-mcp@latest` would download or execute a package for the first time, warn before running it.

## Fast triage

1. Find the active MCP configuration: `.mcp.json`, `gemini-extension.json`, `.claude/settings.json`, `.vscode/launch.json`, `.gemini/settings.json`, or the client-specific config the user names.
2. Check for wrong flags, missing environment variables, stale package versions, `--slim`, `--autoConnect`, `--browserUrl`, `--categoryExtensions`, and timeout settings.
3. Match the exact error to the known patterns below before suggesting config changes.
4. Fetch or read upstream `docs/troubleshooting.md` only when the local symptom is not obvious.
5. If still unclear, run focused diagnostics such as local `chrome-devtools-mcp --help`, package version checks, or a GitHub issue search with `gh issue list --repo ChromeDevTools/chrome-devtools-mcp --search "<error>" --state all`.

## Known patterns

- `Could not find DevToolsActivePort`: this is usually an `--autoConnect` handshake failure. Ask the user to confirm the named Chrome version is running, then have them enable remote debugging at `chrome://inspect/#remote-debugging`. After they confirm, call `list_pages` once to verify.
- Empty profile or no existing tabs: check for flag typos and whether the server is launching a new Chrome profile instead of attaching to an existing browser.
- Only a small tool subset is available: the MCP client may be in read-only, plan, or `--slim` mode. Disable that mode or adjust MCP server flags when the user wants full automation.
- Extension tools missing: require `--categoryExtensions`, and some Chrome versions need the server to launch Chrome instead of attaching with `--autoConnect` or `--browserUrl`.
- `Target closed`, protocol timeouts, socket closed, module-not-found, sandbox, WSL, or host validation errors: compare the exact message with upstream troubleshooting docs and client logs.

## Configuration advice

- Use `--browserUrl=http://127.0.0.1:9222` when attaching to an already debug-enabled Chrome is required.
- Use `--autoConnect` only when the environment supports Chrome remote debugging discovery.
- Add `--logFile <path>` for reproducible logs, and increase client startup timeout when the server starts slowly.
- Ask for the user's current MCP server JSON if the active configuration is unknown.

## Maintenance

For future updates to this source, read `../../../docs/skills/chrome-devtools-skills-update-process.md`.
