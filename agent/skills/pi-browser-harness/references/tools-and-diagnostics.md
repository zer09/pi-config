# Browser tool selection and diagnostics

Apply the [Required User Setup Gate](../SKILL.md#required-user-setup-gate) before any browser tool call. This includes search, reader, diagnostics, and page-state probes. Repeat the gate after disconnect; tool availability or an existing socket is not consent.

## Tool tree

```text
What do you need to know?

  Page structure, clickable controls, labels?
    -> browser_snapshot (default: accessibility tree with @(x,y) for interactive elements)

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

Pass `@(x,y)` from `browser_snapshot` straight to `browser_click`. Do not take a screenshot to rediscover those coordinates.

`browser_web_search` and `browser_read_page` each use an isolated tab and do not touch the user's current tab. They still require per-task setup confirmation and use the authorized profile. Reader mode strips page boilerplate.

For a synthesized, cited multi-source report, the package can supply `deep-research` or `/deep-research <question>`, using isolated `web-search-researcher` agents. Use that separate workflow only if available and authorized; it is not required for ordinary browser control.

## Diagnose an action that appeared to do nothing

For a planned diagnostic action, capture `browser_console`'s `nextCursor` before the action. Perform only an authorized action, then call:

```text
browser_console({ sinceSeq: <cursor> })
browser_network_requests({ sinceMs: 5000 })
```

The cursor separates new console messages from existing ones. Network requests show whether an API call fired and failed. Do not repeat a mutation only to collect diagnostics unless that repeat is authorized and safe.

The console buffer is page-scoped, clears on tab switch, and holds 500 records. Inspect only relevant entries; do not expose credentials, cookies, tokens, auth headers, or private payloads.

If a dialog blocks progress, handle it under the root's dialog boundary before continuing. If connection fails, stop and repeat the user setup gate instead of probing the daemon or socket.
