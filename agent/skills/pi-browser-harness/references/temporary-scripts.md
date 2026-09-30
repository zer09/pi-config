# Browser temporary scripts

Apply the [Required User Setup Gate](../SKILL.md#required-user-setup-gate) first. Scripts, daemon bindings, and raw CDP are not alternative ways to access the browser before user confirmation or after disconnect.

When a workflow repeats three or more times or needs Node.js APIs, write a temporary script and run it with `browser_run_script`. Use it only within the user's requested scope. Scripts receive a `daemon` binding for direct CDP access, avoiding long sequences of tool calls.

## Bindings

- `params`: arguments passed to `browser_run_script`.
- `daemon`: the package's `BrowserClient`, not a separate scripting API.
  - `daemon.evaluateJs(expression)`: run JavaScript in the current page.
  - `daemon.pageInfo()`: read page info or a pending dialog.
  - `daemon.listTabs()` / `daemon.switchTab(targetId)` / `daemon.newTab(url?)` / `daemon.current()`.
  - `daemon.session()` for raw CDP: `session.call`, `session.callOnTarget`, `session.callBrowser`, `session.takeDialog`.
- `require`, `fetch`, `JSON`, `Buffer`, `console`, `setTimeout`, `clearTimeout`.
- `signal`: `AbortSignal`.
- `onUpdate({ content: [{ type: 'text', text: '...' }] })`: progress callback.
- `ctx`: `ExtensionContext`.

The async methods listed above return `{ success: true, data }` or `{ success: false, error }`; check `success` before using `data`. `daemon.current()` and `daemon.session()` are synchronous. Use `evaluateJs` and `session().call`, not the obsolete `evaluateJS` or `daemon.cdp` names in some package examples.

## Limits

- Write and review the script before running it. Pass an absolute `.js` or `.mjs` path under the OS temp directory, the working directory, or `BH_SCRIPT_DIR`.
- `timeoutMs` defaults to 60,000 and accepts 100 through 600,000. Honor `signal`; a timeout or cancellation does not undo actions already taken.
- Return `{ content: [{ type: 'text', text: '...' }], details?: {...} }`; throw on failure. Script output must not claim success when a CDP result failed.
- Scripts have full Node.js access in the Pi process. Path and timeout checks are not a sandbox or permission to exceed the task.
- Do not use scripts for one-off actions; call `browser_*` tools directly after confirmation.
- Do not call `browser_*` tools from inside a script. Sequence separate tool calls outside.
- Keep the authorized profile/account. Do not launch a browser, bypass manual login, or extract credentials through script APIs.
- A script must not turn inspection into hosted mutations or bulk changes without the user's exact request and target.
- Keep output surgical and redact sensitive data. Do not save credentials or private page payloads in temporary scripts or logs.
- Stop on disconnect and repeat the setup gate. Handle blocking dialogs under the root's authorization boundary, not by blindly accepting them.
