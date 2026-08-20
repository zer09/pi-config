---
name: pi-browser-harness
description: Direct browser control via CDP. Use when the user wants to automate, scrape, test, or interact with web pages. Before using any browser tool, require the user to start their browser, run /browser-setup, and confirm setup is complete. Default to browser_snapshot for understanding pages and browser_execute_js for surgical reads; use browser_screenshot only for visual verification.
---

# pi-browser-harness

Direct browser control of the user's running Chrome via CDP.

## Tool hierarchy

```
What do you need to know?

  ├─ Page structure / what's clickable / labels?
  │     → browser_snapshot     (DEFAULT — AX tree with @(x,y) per interactive element)
  │
  ├─ A specific element's value / attribute / coords?
  │     → browser_execute_js   (e.g. el.innerText, el.getBoundingClientRect())
  │
  ├─ Network behavior on the current page?
  │     → browser_network_requests
  │
  ├─ Find pages on the web about a topic?
  │     → browser_web_search    (ranked SERP — links only; follow up with browser_read_page)
  │
  ├─ An article's main content as clean text?
  │     → browser_read_page     (reader mode — a url or an owned targetId → boilerplate stripped)
  │
  ├─ JS errors / why did nothing happen after an action?
  │     → browser_console     (DIAGNOSTIC — only when something looks broken)
  │
  └─ Visual rendering (layout / colors / chart drew correctly)?
        → browser_screenshot   (LAST RESORT — pixels only)
```

Pass `@(x,y)` from `browser_snapshot` straight to `browser_click`. No screenshot round-trip.

`browser_web_search` and `browser_read_page` each run in their own isolated tab and never touch the user's current tab. For a multi-source question that needs a synthesized, cited report, use the **deep-research** skill (or `/deep-research <question>`): it fans out isolated `web-search-researcher` subagents over both tools and writes a source-cited Markdown report.

## Required User Setup Gate

Before the first browser tool call in a task:

1. Stop and ask the user to start Chrome, Chromium, Brave, or Edge.
2. Ask the user to enable remote debugging if it is not already enabled.
3. Ask the user to run `/browser-setup` in Pi.
4. Wait until the user explicitly confirms that setup completed.
5. Only then call a `browser_*` tool.

Do not call `browser_setup` for the user. Do not probe the browser, daemon, socket,
tabs, or page state before confirmation. Treat an existing daemon or socket as
insufficient because the user must authorize browser access for the current task.

If a browser tool later reports `not_connected`, a missing
`/tmp/pi-browser-daemon.sock`, or a daemon startup failure, stop again. Ask the user
to verify that the browser is running and rerun `/browser-setup`. Continue only
after the user confirms success.

## Browser profile

Every harness tab opens in one chosen browser profile, which determines the logins,
cookies, and extensions you're working with. The user picks it once via
`/browser-profile`; the choice persists across sessions in `~/.pi/agent/`.

The first setup in a fresh install shows that picker, so setup may pause briefly on
user input. This is expected. The result appears as
`Browser profile: <name> (<email>)`.

If setup reports `couldn't open a window in "…" automatically`, the harness could not
open the pinned profile's window. Tell the user to open that profile from their browser's
profile menu and retry, or to run `/browser-profile` to choose another. Never work around
it by opening tabs elsewhere because a different profile means different accounts.

## Connection

You're attached to the user's real Chrome. Never launch your own. If authentication is required, stop and ask the user. If `browser_page_info` returns a dialog, handle it first with `browser_handle_dialog`.

## Diagnosing a "nothing happened" moment

When an action runs but the page didn't change, capture `browser_console`'s `nextCursor` before the action. Take the action, then call `browser_console({ sinceSeq: <cursor> })`. This isolates what the action caused from existing messages. Pair it with `browser_network_requests({ sinceMs: 5000 })` to see if an API call fired and failed. The console buffer is page-scoped and clears on tab switch. Its capacity is 500 records.

## Temporary scripts

When a workflow repeats three or more times or needs Node.js APIs, write a script to disk and run it with `browser_run_script`. Scripts get a `daemon` binding for direct CDP access, which is faster than chaining tool calls.

**Bindings inside a script:**

- `params`: args passed to `browser_run_script`
- `daemon`:
  - `daemon.evaluateJs(expression)`: run JS in the current page
  - `daemon.pageInfo()`: `{ url, title, ... }` or `{ dialog }`
  - `daemon.listTabs()` / `daemon.switchTab(targetId)` / `daemon.newTab(url?)` / `daemon.current()`
  - `daemon.session(targetId)` for raw CDP: `session.call`, `session.callOnTarget`, `session.callBrowser`, `session.takeDialog`
- `require`, `fetch`, `JSON`, `Buffer`, `console`, `setTimeout`, `clearTimeout`
- `signal`: AbortSignal
- `onUpdate({ content: [{ type: 'text', text: '...' }] })`: progress callback
- `ctx`: `ExtensionContext`

**Do not:**

- Use scripts for one-off actions. Call `browser_*` tools directly.
- Call `browser_*` tools from inside a script. Sequence separate tool calls outside.

## Maintenance

This user-owned skill is the source of truth for browser-access consent. The npm package's bundled skill is disabled in `~/.pi/agent/settings.json`, so package updates cannot replace this file. After updating `pi-browser-harness`, compare its bundled `skills/pi-browser-harness/SKILL.md` with this file and merge useful tool guidance without removing the Required User Setup Gate.
