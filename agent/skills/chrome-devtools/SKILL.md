---
name: chrome-devtools
description: Uses Chrome DevTools via MCP for efficient debugging, troubleshooting and browser automation. Use when debugging web pages, automating browser interactions, analyzing performance, or inspecting network requests. This skill does not apply to `--slim` mode (MCP configuration).
---

# Chrome DevTools MCP

Use Chrome DevTools MCP for browser debugging, page inspection, performance traces, screenshots, network requests, console messages, and controlled browser automation.

## Safety and routing

- Browser automation can mutate hosted services. Keep interactions read-only unless the user explicitly requests the exact browser-side mutation.
- Use `take_snapshot` before interacting. Element `uid`s are snapshot-specific; refresh the snapshot after navigation or DOM changes.
- Use `filePath`, pagination, filters, and `includeSnapshot: false` to keep tool output small.
- Keep sequential steps sequential: navigate or select page, wait, snapshot, then interact. Parallelize only independent read-only checks.
- If Chrome DevTools MCP launch, connection, or target selection fails, switch to the `troubleshooting` skill.

## Page workflow

1. Open or choose a page with `new_page`, `navigate_page`, `list_pages`, and `select_page`.
2. Wait for known text or UI state with `wait_for` when needed.
3. Inspect structure with `take_snapshot`; use `take_screenshot` for visual layout or screenshot evidence.
4. Interact with `click`, `fill`, `press_key`, `hover`, `drag`, `upload_file`, or `handle_dialog` only after confirming the action is safe.
5. Inspect effects with a fresh snapshot, console/network tools, or `evaluate_script`.

## Tool selection

- Page structure and automation: `take_snapshot`.
- Visual state: `take_screenshot`.
- DOM data not present in the accessibility tree: `evaluate_script`.
- Network debugging: `list_network_requests` then `get_network_request` for selected request details.
- Console and browser issues: `list_console_messages` then `get_console_message`.
- Performance: `performance_start_trace`, `performance_stop_trace`, and `performance_analyze_insight`.
- Memory: `take_memory_snapshot`, then use the `memory-leak-debugging` skill.
- Extensions: require extension category tools to be enabled; install, reload, trigger, or uninstall extensions only for explicit extension-testing tasks.

## Maintenance

For future updates to this source, read `../../../docs/skills/chrome-devtools-skills-update-process.md`.
