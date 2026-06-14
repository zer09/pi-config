# ADR 0006: Adopt official RTK Pi extension

## Status

Accepted

## Context

This Pi config previously used a custom local RTK hook at `agent/extensions/rtk-hook/index.ts`. That hook acted as a fail-closed fallback for direct Pi `bash` calls: it maintained a local read-only allowlist, blocked common mutating patterns, and then called `rtk rewrite`.

RTK now provides an official Pi extension at `hooks/pi/rtk.ts`, installed globally as `agent/extensions/rtk.ts` by `rtk init --agent pi --global`. The official extension is intentionally a thin rewrite-only token optimizer. It delegates all rewrite decisions to `rtk rewrite` and the Rust registry, uses Pi's `ExtensionAPI` and `pi.exec`, supports timeout/cancellation, and avoids maintaining a second TypeScript rewrite policy.

Keeping both hooks active would make behavior depend on extension load order. Keeping the custom hook as the canonical RTK integration would preserve stricter local filtering, but it would also keep a policy fork that can drift from upstream RTK.

The detailed comparison that led to this decision was first written in the temporary report `plans/rtk-pi-hook-comparison-report.md`.

## Decision

Use the official RTK Pi extension as the canonical RTK rewrite integration for Pi.

- Keep `agent/extensions/rtk.ts` as the active RTK Pi extension.
- Keep the old custom `agent/extensions/rtk-hook` disabled or removed.
- Do not run both the official hook and the old custom hook at the same time.
- Do not maintain a separate RTK-specific read-only allowlist in the Pi RTK hook.
- Treat command safety, hosted-service mutation gates, destructive local action gates, and permission policy as separate Pi policy surfaces, not responsibilities of the RTK optimizer hook.
- Ensure those policy surfaces recognize both raw commands and `rtk`-wrapped commands such as `rtk git push`, `rtk gh api -X POST ...`, and `rtk kubectl apply ...`.
- When RTK rewrite behavior needs to change, prefer changing or configuring upstream RTK's Rust registry rather than forking the Pi hook.

## Consequences

- The Pi RTK hook is now aligned with upstream RTK and should need less local maintenance.
- RTK rewrite coverage can expand as upstream RTK expands without editing local TypeScript.
- The local fail-closed read-only behavior is no longer part of the RTK hook itself.
- Mutation and destructive-action protection must be enforced by the general Pi safety rules and mutation guard extensions.
- Any future guard that classifies shell commands must normalize or unwrap `rtk` prefixes before deciding whether a command is mutating.
- Operators should use `RTK_DISABLED=1` to disable the official RTK hook behavior for a process or command, not the old `PI_RTK_HOOK=0` switch.

## Validation

After migration, verify:

1. `rtk --version` is the intended release for the desired registry behavior.
2. `agent/extensions/rtk.ts` exists and matches the official RTK Pi extension.
3. `agent/extensions/rtk-hook` is absent or disabled.
4. Pi has been restarted or reloaded.
5. A read-only command such as `git status` is rewritten through RTK.
6. Mutation guards still block or require explicit permission for both raw and `rtk`-wrapped mutating commands.
