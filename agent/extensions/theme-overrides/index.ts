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

/**
 * Register the theme-overrides Pi extension.
 */
export default function themeOverridesExtension(
  pi: ExtensionAPI,
  runOverride: typeof applyOverride = applyOverride,
): void {
  let interval: ReturnType<typeof setInterval> | undefined
  let retryTimers: Array<ReturnType<typeof setTimeout>> = []
  let warned = false
  let applying = false
  let generation = 0
  let runController: AbortController | undefined

  const safeApply = async (
    ctx: ExtensionContext,
    activeGeneration: number,
    signal: AbortSignal,
  ): Promise<void> => {
    if (applying || signal.aborted || activeGeneration !== generation) return

    applying = true
    try {
      await runOverride(pi, ctx, signal, () => activeGeneration === generation)
    } catch (error) {
      // Session replacement makes ctx stale, so only use its UI while this run still owns the session.
      if (signal.aborted || activeGeneration !== generation || warned) return

      warned = true
      try {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Theme override failed: ${message}`, "warning")
      } catch (notificationError) {
        console.warn("[theme-overrides] failed to report theme override error", error, notificationError)
      }
    } finally {
      applying = false
    }
  }

  const clearRetryTimers = (): void => {
    for (const timer of retryTimers) clearTimeout(timer)
    retryTimers = []
  }

  pi.on("session_start", (_event, ctx) => {
    generation += 1
    const activeGeneration = generation

    runController?.abort()
    const controller = new AbortController()
    runController = controller

    void safeApply(ctx, activeGeneration, controller.signal)

    clearRetryTimers()
    retryTimers = APPLY_RETRY_DELAYS_MS.map((delay) =>
      setTimeout(() => void safeApply(ctx, activeGeneration, controller.signal), delay),
    )

    if (interval) clearInterval(interval)
    interval = setInterval(() => void safeApply(ctx, activeGeneration, controller.signal), POLL_INTERVAL_MS)
  })

  pi.on("session_shutdown", () => {
    generation += 1
    runController?.abort()
    runController = undefined
    clearRetryTimers()
    if (interval) {
      clearInterval(interval)
      interval = undefined
    }
  })
}
