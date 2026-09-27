# Local pi-btw patches

These notes track local changes made under `~/.pi/agent/npm/node_modules/pi-btw/`. Package upgrades or reinstalls can overwrite them. Re-check this file after every `pi-btw` update.

## 2026-09-26 — Pi 0.87.1 and `pi-btw@0.6.1`

Version 0.6.1 includes the child `ModelRuntime` adapter and canonical `SessionManager` seeding in its published source. The old migration patch is retired because upstream now copies native and legacy provider registrations and transient parent runtime credentials. The remaining local patch adds `{ signal: ctx.signal }` to `setRuntimeApiKey()` for cancellation. The helper rejects other package versions and is byte-idempotent. Six offline tests pass against Pi 0.87.1: stock-to-patch reapplication, two child turns seeded from context-edited parent history, summary failure and successful retry, in-memory branch/reset restoration, cancellation on real `new_session` shutdown followed by a fresh turn, and a separate two-process persisted-session restart. The restart fixture resumes its exact disposable session file and verifies one restored hidden exchange, canonical parent context, append-only history, and fresh synthetic runtime auth. Three independent reviews accepted each new test increment. The fresh delegated-path and interactive acceptance checks also pass.

Reapply the remaining patch after reinstalling this exact version:

```bash
node ~/.pi/agent/pi-btw/reapply-model-runtime-patch.mjs
node --test ~/.pi/agent/pi-btw/reapply-model-runtime-patch.test.mjs
node --test ~/.pi/agent/pi-btw/persisted-session-restart.test.mjs
```

## 2026-07-19 — Pi 0.80.8+ `ModelRuntime` child sessions (historical, retired in 0.6.1)

Why: `pi-btw@0.4.1` still passes `modelRegistry` to `createAgentSession()`. Pi 0.80.8 removed that SDK option in favor of `modelRuntime`. Pi silently ignores the obsolete property at runtime, so a BTW child session creates an independent runtime without extension provider registrations such as Cursor or Claude Bridge.

Behavior:

- Each BTW conversation or summarizer child session creates a current `ModelRuntime` using the normal Pi agent auth and model configuration.
- If the selected model belongs to a native extension provider, the complete provider object is copied into the child runtime.
- Otherwise, legacy public provider configuration is copied from the parent `ModelRegistry` into the child runtime.
- This includes native providers such as the configured `openai-codex-*` aliases.
- If the parent provider auth source is the transient `runtime` source used by `--api-key` or `ModelRuntime.setRuntimeApiKey()`, that resolved key is copied into the child runtime.
- The Pi command context `AbortSignal` cancels the child runtime credential sync on Pi 0.84.1+.
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
rg --no-ignore "createBtwModelRuntime|getRegisteredNativeProvider|registerNativeProvider|parentAuthStatus|setRuntimeApiKey|modelRuntime," ~/.pi/agent/npm/node_modules/pi-btw/extensions/btw.ts
node --test ~/.pi/agent/pi-btw/reapply-model-runtime-patch.test.mjs
```

Expected result: one `createBtwModelRuntime()` helper, native and legacy provider propagation, cancellation-aware runtime-only auth propagation, both child-session constructors passing `modelRuntime` rather than `modelRegistry`, and the five current offline regression tests. The historical 0.4.1 suite also had five tests; the current tests are different.

After reapplying, restart Pi or run `/reload`.

## 2026-09-06 — Pi 0.85.1 review (historical)

`pi-btw@0.4.1` remains the latest published release and still passes the removed `modelRegistry` option in both child constructors. The patch remains required. All five local regressions pass against the published Pi 0.85.1 bundle, including native provider registration, runtime-only key propagation with cancellation, and an offline child request. No upstream-equivalent release exists to retire the helper.
