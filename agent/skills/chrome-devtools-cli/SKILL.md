---
name: chrome-devtools-cli
description: Use this skill to write shell scripts or run shell commands to automate tasks in the browser or otherwise use Chrome DevTools via CLI.
---

# Chrome DevTools CLI

Use the `chrome-devtools` CLI when the user asks for shell automation around Chrome DevTools MCP. Prefer MCP tools for interactive debugging; use the CLI for repeatable commands, scripts, or pipelines.

## Safety and routing

- In Pi, run read-only CLI checks through Context Mode/RTK when output may exceed a few lines.
- Browser actions can mutate hosted services. Do not submit, save, delete, purchase, post, or change hosted data unless the user explicitly asked for that exact action.
- The background server starts implicitly on first command. Do not run `start`, `status`, or `stop` before every command.
- Use `--output-format=json`, `--filePath`, pagination, and filters for large output. Parse JSON with code instead of reading raw output.
- If first-time setup is needed, read `references/installation.md` and ask before installing or changing global tools.

## Command shape

```bash
chrome-devtools <tool> [arguments] [flags]
chrome-devtools <tool> --help
chrome-devtools <tool> --output-format=json
```

Typical flow:

```bash
chrome-devtools list_pages
chrome-devtools new_page "https://example.com"
chrome-devtools take_snapshot
chrome-devtools click "<uid>" --includeSnapshot false
chrome-devtools fill "<uid>" "text" --includeSnapshot false
```

## Command groups to remember

- Navigation: `list_pages`, `new_page`, `navigate_page`, `select_page`, `close_page`.
- Input: `click`, `fill`, `type_text`, `press_key`, `hover`, `drag`, `upload_file`, `handle_dialog`.
- Inspection: `take_snapshot`, `take_screenshot`, `evaluate_script`, `list_console_messages`, `get_console_message`.
- Network: `list_network_requests`, `get_network_request`.
- Performance and memory: `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, `take_memory_snapshot`.
- Emulation: `emulate`, `resize_page`.
- Extensions: `list_extensions`, `install_extension`, `reload_extension`, `trigger_extension_action`, `uninstall_extension`.
- Service management: `start`, `status`, `stop` only when explicitly managing the CLI server.

## Gotchas

- `uid`s come from `take_snapshot` and can expire after DOM changes.
- `take_snapshot` is better for automation; `take_screenshot` is better for visual evidence.
- Experimental tools require server flags before startup.
- Extension tools require the extension category to be enabled and may require launching Chrome rather than attaching to an existing instance.

## Maintenance

For future updates to this source, read `../../../docs/skills/chrome-devtools-skills-update-process.md`.
