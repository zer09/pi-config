# Isolated sessions and snapshots

## Start and scope a session

Use the installed `playwright-cli`; check `NO_UPDATE_NOTIFIER=1 playwright-cli --version` and `NO_UPDATE_NOTIFIER=1 playwright-cli <command> --help` when syntax is uncertain. Missing packages or browser binaries are blockers, not permission to install them.

Choose a task-specific session name and pass `-s=task-name` on every session command. Do not reuse another task's session. Profiles are in memory by default, but snapshots and other artifacts can still be written to disk.

Inspect `.playwright/cli.config.json` and relevant `PLAYWRIGHT_MCP_*` overrides without printing secret values. They can change the browser, persistence, or connection target. Do not launch with an unexpected profile, CDP endpoint, or remote endpoint.

For an isolated bundled Chromium session, use a task-local config such as `isolated-cli.json`:

```json
{
  "browser": {
    "browserName": "chromium",
    "isolated": true,
    "launchOptions": {
      "channel": "chromium"
    }
  }
}
```

```bash
playwright-cli -s=task-name open --config=isolated-cli.json
playwright-cli -s=task-name goto https://example.com
playwright-cli -s=task-name snapshot
```

Use `--headed` on `open` only when a visible isolated browser is needed. Headless sessions expire after one hour without commands by default; headed sessions do not. `open --idle-timeout=<ms>` changes that timeout, and `0` disables it. If a session expires, reopen it and reconstruct only the authorized state.

## Inspect and target

Read the snapshot file path returned by the CLI. Use fresh element refs such as `e5`; refresh after navigation or a page change rather than guessing refs.

```bash
playwright-cli -s=task-name snapshot --depth=4
playwright-cli -s=task-name snapshot e5
playwright-cli -s=task-name find "Search"
playwright-cli -s=task-name find --regex "/search/i"
playwright-cli -s=task-name fill e5 "example query"
playwright-cli -s=task-name press Enter
```

These refs are examples, not stable identifiers. CSS selectors and Playwright locators are also accepted as targets. Use `generate-locator e5 --raw` when a reusable locator is needed.

For a specific DOM property missing from the snapshot:

```bash
playwright-cli -s=task-name eval "el => el.getAttribute('data-testid')" e5
```

Use screenshots for visual verification, not routine control discovery. Use `snapshot --filename=after.yaml` or `screenshot --filename=after.png` only when the task needs that artifact and its contents are safe to save.

`--raw` returns only the result, omitting status, generated code, and snapshot sections. Do not use it when collecting generated TypeScript. `--json` wraps replies as JSON. Neither flag redacts sensitive data.

## Saved state

Use `state-save` and `state-load` only for explicitly requested state persistence or reuse. Use a private path outside the checkout, supplied through `STATE_FILE`, and never print the file or its cookies/tokens.

```bash
playwright-cli -s=task-name state-save "$STATE_FILE"
playwright-cli -s=task-name state-load "$STATE_FILE"
```

Load state into the intended isolated session before navigating to the target page. Saved storage state is not a complete browser-profile backup. Do not extract state from the user's browser; that browser remains under `pi-browser-harness`.

## Close only this task's session

```bash
playwright-cli -s=task-name close
```

Do not use `close-all`, `kill-all`, or `delete-data` as routine cleanup. They can affect unrelated sessions or destroy saved data. Stop active traces and recordings before closing. Keep a session open only at the user's request, and report its name.
