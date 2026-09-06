# ADR 0018: Use write-free theme startup and a separate UI-prompt waiting state

## Status

Accepted (2026-09-06) for Pi 0.85.1. This decision changes presentation behavior only. It does not change delegated routing, liveness leases, prompt-response policy, telemetry content, model defaults, accounts, permissions, or compaction policy.

## Context

The startup wrapper previously detected Windows `AppsUseLightTheme` and rewrote `agent/settings.json` before ordinary interactive runs. The write fixed the first frame and resume startup, but it changed tracked bytes and mtime, could race concurrent starts, and made startup depend on valid writable JSON.

Pi 0.84.2 added `--use-theme <name[/name]>`, an initial per-run interactive selection that does not save settings. A theme pair follows terminal color-scheme reports. This configuration intentionally follows Windows `AppsUseLightTheme`; terminal appearance and the Windows application preference can disagree.

Pi 0.84.4 also added notification-only `ui_prompt_start` and `ui_prompt_end` extension events around blocking `ctx.ui` prompts. The footer already measures wall-clock prompt duration through `agent_settled`, so waiting for user input needs a separate state rather than a changed timer definition.

## Decision

### Startup theme

Keep Windows appearance detection in `agent/bin/pi`, but pass the detected `dark` or `light` value through `--use-theme` instead of writing settings. Prepend the injected option so the original argv remains unchanged and in order.

The wrapper parses supported flags only before `--`, skips option values, and bypasses management, metadata, export, print, JSON, and RPC invocations. A user-supplied `--use-theme` receives absolute precedence: the wrapper injects nothing, and `theme-overrides` does not change that run's theme even when saved settings contain another managed theme.

The wrapper sets `PI_THEME_WRAPPER_INJECTED=1` only on the real Pi process for its own default. `theme-overrides` uses that marker to distinguish the automatic first-frame selection from a user selection, then continues its existing Windows/OS appearance polling. The wrapper clears a stale inherited marker before every invocation.

Keep `PI_THEME_WRAPPER_DISABLE=1`, custom-theme backoff, local `dark` and `light` resources, and the saved `dark` fallback. Theme retry and polling timers are unrefed so a host teardown or startup benchmark is not kept alive by the extension. Do not adopt native `light/dark` pair switching because that would change the appearance source from Windows application preference to terminal reports.

### UI prompt and working state

The footer stores one boolean waiting state from `ui_prompt_start` through `ui_prompt_end` and renders `? waiting` outside the minimal layout. It stores no prompt title, prompt text, kind, or reason. Nested prompts are already coalesced by Pi's extension runner. Session shutdown clears the state.

The existing elapsed timer remains wall-clock time from accepted prompt start through `agent_settled`. Waiting does not pause it. `agent_settled` does not clear or fabricate UI-prompt completion, and UI-prompt completion does not imply agent settlement or successful tool completion.

Do not change delegated liveness. Pi RPC exposes blocking dialogs as `extension_ui_request`, not as new `ui_prompt_*` wire events. The delegated supervisor continues to cancel supported dialog requests, treat UI traffic as protocol-valid but not activity or structural progress, and preserve its existing headless policy.

Use Pi 0.85.0's default editor-border working indicator as shipped. This configuration has no custom editor and does not add a second spinner or call `setWorkingIndicator`, `setWorkingVisible`, `setWorkingMessage`, or `setEditorComponent` merely to opt into the new placement.

## Consequences

- Normal automatic startup does not create, rewrite, rename, chmod, or temporarily replace `settings.json`.
- First-frame selection still follows Windows `AppsUseLightTheme`, and runtime appearance changes still use the existing extension.
- Explicit per-run theme choices survive startup, reload, resume, and later polling until the user makes another explicit settings choice.
- Footer users can distinguish active work from a blocking extension prompt without changing elapsed-time accounting or telemetry privacy.
- Native theme-pair behavior remains available to explicit users, but it is not the automatic policy.

## Validation

- Wrapper tests cover explicit precedence, option values, spaces, `@file` inputs, repeated `--use-theme`, `--`, management/non-interactive bypasses, prompt command words, disabled mode, invalid/missing settings, byte/mtime/mode stability, and concurrent starts.
- Theme extension tests cover explicit-choice backoff, wrapper-injected continuation, session shutdown, and stale-context protection.
- Footer tests cover waiting start/end, timer independence, `agent_settled` separation, prompt-title exclusion, and session-shutdown clearing.
- Pi 0.85.1 source and published-artifact tests establish light-first/dark-second pair ordering, per-run non-persistence, and default-editor indicator placement. Real terminal appearance remains a manual visual check after starting a fresh process.
