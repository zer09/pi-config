/**
 * Public Pi extension entry point and lifecycle wiring for theme-overrides.
 *
 * Pi auto-discovers this file at extensions/theme-overrides/index.ts. It owns the
 * mutable timer and generation state needed to apply theme overrides at session
 * startup, retry shortly after startup, poll periodically, and clean up reliably
 * on session shutdown.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { applyOverride } from "./apply-override.ts"
import { APPLY_RETRY_DELAYS_MS, POLL_INTERVAL_MS } from "./constants.ts"
import { detectOS } from "./system-appearance.ts"
import { isThemeOverrideAllowed } from "./theme-state.ts"
import type { DetectedOS, ThemeKind } from "./types.ts"
import { startWindowsAppearanceWatcher } from "./windows-appearance-watcher.ts"

/**
 * Register the theme-overrides Pi extension.
 */
export default function themeOverridesExtension(
  pi: ExtensionAPI,
  runOverride: typeof applyOverride = applyOverride,
  startWindowsWatcher: typeof startWindowsAppearanceWatcher = startWindowsAppearanceWatcher,
  detectHostOS: () => DetectedOS = detectOS,
): void {
  let interval: ReturnType<typeof setInterval> | undefined
  let retryTimers: Array<ReturnType<typeof setTimeout>> = []
  let stopWindowsWatcher: (() => void) | undefined
  let warned = false
  let applying = false
  let generation = 0
  let runController: AbortController | undefined

  const reportFailure = (
    ctx: ExtensionContext,
    activeGeneration: number,
    signal: AbortSignal,
    error: unknown,
  ): void => {
    // Session replacement makes ctx stale, so only use its UI while this run still owns the session.
    if (signal.aborted || activeGeneration !== generation || warned) return

    warned = true
    try {
      const message = error instanceof Error ? error.message : String(error)
      ctx.ui.notify(`Theme override failed: ${message}`, "warning")
    } catch (notificationError) {
      console.warn("[theme-overrides] failed to report theme override error", error, notificationError)
    }
  }

  const safeApply = async (
    ctx: ExtensionContext,
    activeGeneration: number,
    signal: AbortSignal,
    detectedKind?: ThemeKind,
  ): Promise<void> => {
    if (applying || signal.aborted || activeGeneration !== generation) return

    applying = true
    try {
      await runOverride(pi, ctx, signal, () => activeGeneration === generation, detectedKind)
    } catch (error) {
      reportFailure(ctx, activeGeneration, signal, error)
    } finally {
      applying = false
    }
  }

  const clearRetryTimers = (): void => {
    for (const timer of retryTimers) clearTimeout(timer)
    retryTimers = []
  }

  const clearPolling = (): void => {
    clearRetryTimers()
    if (interval) {
      clearInterval(interval)
      interval = undefined
    }
    stopWindowsWatcher?.()
    stopWindowsWatcher = undefined
  }

  pi.on("session_start", (_event, ctx) => {
    generation += 1
    const activeGeneration = generation

    runController?.abort()
    clearPolling()
    const controller = new AbortController()
    runController = controller

    if (detectHostOS() === "WSL") {
      if (ctx.mode !== "tui" || !isThemeOverrideAllowed(ctx)) return

      try {
        stopWindowsWatcher = startWindowsWatcher({
          signal: controller.signal,
          pollIntervalMs: POLL_INTERVAL_MS,
          onAppearance: (kind) => void safeApply(ctx, activeGeneration, controller.signal, kind),
          onError: (error) => reportFailure(ctx, activeGeneration, controller.signal, error),
        })
      } catch (error) {
        reportFailure(ctx, activeGeneration, controller.signal, error)
      }
      return
    }

    void safeApply(ctx, activeGeneration, controller.signal)

    retryTimers = APPLY_RETRY_DELAYS_MS.map((delay) =>
      setTimeout(() => void safeApply(ctx, activeGeneration, controller.signal), delay),
    )
    for (const timer of retryTimers) timer.unref?.()

    interval = setInterval(() => void safeApply(ctx, activeGeneration, controller.signal), POLL_INTERVAL_MS)
    interval.unref?.()
  })

  pi.on("session_shutdown", () => {
    generation += 1
    runController?.abort()
    runController = undefined
    clearPolling()
  })
}
