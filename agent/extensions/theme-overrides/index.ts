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
export default function themeOverridesExtension(pi: ExtensionAPI): void {
  let interval: ReturnType<typeof setInterval> | undefined
  let retryTimers: Array<ReturnType<typeof setTimeout>> = []
  let warned = false
  let applying = false
  let generation = 0

  const safeApply = async (ctx: ExtensionContext, activeGeneration: number): Promise<void> => {
    if (applying || activeGeneration !== generation) return

    applying = true
    try {
      await applyOverride(pi, ctx)
    } catch (error) {
      if (!warned) {
        warned = true
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Theme override failed: ${message}`, "warning")
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

    void safeApply(ctx, activeGeneration)

    clearRetryTimers()
    retryTimers = APPLY_RETRY_DELAYS_MS.map((delay) => setTimeout(() => void safeApply(ctx, activeGeneration), delay))

    if (interval) clearInterval(interval)
    interval = setInterval(() => void safeApply(ctx, activeGeneration), POLL_INTERVAL_MS)
  })

  pi.on("session_shutdown", () => {
    generation += 1
    clearRetryTimers()
    if (interval) {
      clearInterval(interval)
      interval = undefined
    }
  })
}
