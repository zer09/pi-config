# Browser tool selection and diagnostics

Apply the [Required User Setup Gate](../SKILL.md#required-user-setup-gate) before any browser tool call. This includes search, reader, diagnostics, and page-state probes. Repeat the gate after disconnect; tool availability or an existing socket is not consent.

## Tool tree

```text
What do you need to know?

  Page structure, clickable controls, labels?
    -> browser_snapshot (default: accessibility tree with [eN] refs and @(x,y) for interactive elements)

  A specific element's value, attribute, or coordinates?
    -> browser_execute_js (el.innerText, el.getBoundingClientRect())

  Network behavior on the current page?
    -> browser_network_requests

  Pages on the web about a topic?
    -> browser_web_search (ranked links; follow with browser_read_page)

  An article's main content as clean text?
    -> browser_read_page (reader mode for a URL or owned targetId)

  JavaScript errors or an action that appeared to do nothing?
    -> browser_console (diagnostic only when something looks broken)

  Visual rendering: layout, colors, or whether a chart drew correctly?
    -> browser_screenshot (visual verification only)
```

Prefer snapshot refs such as `ref: "e7"` for `browser_click`, `browser_fill`, `browser_select_option`, and other ref-aware tools. Refs resolve the element at action time; coordinates can go stale after layout changes. After navigation, a major re-render, or `ref is stale`, take a fresh snapshot instead of retrying blindly. When no ref is available, pass fresh snapshot `@(x,y)` to `browser_click` or use a surgical DOM read. Do not take a screenshot to rediscover controls.

For an authorized form change, prefer `browser_fill` for controlled inputs; use `browser_type` for keystroke-sensitive widgets. Inspect the returned value and any "Page changes" diff, then verify the requested result with a fresh snapshot or surgical read. A page diff is not proof that a remote save succeeded.

`browser_web_search` uses an isolated tab; `browser_read_page` with `url` opens, reads, and closes an isolated tab; `browser_read_page` with `targetId` reads that existing session-owned tab in place. They still require per-task setup confirmation and use the authorized profile. Search for candidate URLs, then read promising results; reader mode strips page boilerplate. The package no longer supplies a deep-research skill, command, or researcher agent.

Keep tab operations inside the session's owned tabs. Isolation does not authorize access to another profile or the user's unrelated tabs.

## Diagnose an action that appeared to do nothing

For a planned diagnostic action, capture `browser_console`'s `nextCursor` before the action. Perform only an authorized action, then call:

```text
browser_console({ sinceSeq: <cursor> })
browser_network_requests({ sinceMs: 5000 })
```

The cursor separates new console messages from existing ones. Network requests show whether an API call fired and failed. Do not repeat a mutation only to collect diagnostics unless that repeat is authorized and safe.

The console buffer is page-scoped, clears on tab switch, and holds 500 records. Inspect only relevant entries; do not expose credentials, cookies, tokens, auth headers, or private payloads.

A CDP timeout can report `kind: "timeout"` rather than `cdp_error`. Treat a timed-out mutation's outcome as unverified, not as proof that nothing happened. If still connected, inspect the result before considering an authorized, safe retry.

If a dialog blocks progress, handle it under the root's dialog boundary before continuing. If connection fails, stop and repeat the user setup gate instead of probing the daemon or socket.
