# Local pi-btw patches

These notes track local changes made under `~/.pi/agent/npm/node_modules/pi-btw/`. Package upgrades or reinstalls can overwrite them. Re-check this file after every `pi-btw` update.

## 2026-07-19 — Pi 0.80.8+ `ModelRuntime` child sessions

Why: `pi-btw@0.4.1` still passes `modelRegistry` to `createAgentSession()`. Pi 0.80.8 removed that SDK option in favor of `modelRuntime`. Pi silently ignores the obsolete property at runtime, so a BTW child session creates an independent runtime without extension provider registrations such as Cursor or Claude Bridge.

Behavior:

- Each BTW conversation or summarizer child session creates a current `ModelRuntime` using the normal Pi agent auth and model configuration.
- If the selected model belongs to an extension provider, its public provider configuration is copied from the parent `ModelRegistry` into the child runtime.
- If the parent provider auth source is the transient `runtime` source used by `--api-key` or `ModelRuntime.setRuntimeApiKey()`, that resolved key is copied into the child runtime.
- Stored, environment, command-backed, OAuth, built-in, and `models.json` auth continue to resolve canonically instead of being converted into runtime keys.
- BTW tool names, commands, model selection, thinking behavior, and persistence are unchanged.

Patched file:

- `~/.pi/agent/npm/node_modules/pi-btw/extensions/btw.ts`

Reapply helper:

```bash
node ~/.pi/agent/pi-btw/reapply-model-runtime-patch.mjs
```

Quick verification:

```bash
rg --no-ignore "createBtwModelRuntime|parentAuthStatus|setRuntimeApiKey|modelRuntime," ~/.pi/agent/npm/node_modules/pi-btw/extensions/btw.ts
node --test ~/.pi/agent/pi-btw/reapply-model-runtime-patch.test.mjs
```

Expected result: one `createBtwModelRuntime()` helper, runtime-only auth propagation, both child-session constructors passing `modelRuntime` rather than `modelRegistry`, and three passing regression tests.

After reapplying, restart Pi or run `/reload`.
