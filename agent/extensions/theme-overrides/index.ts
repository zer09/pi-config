/**
 * Public Pi extension entry point and lifecycle wiring for theme-overrides.
 *
 * Pi auto-discovers this file at extensions/theme-overrides/index.ts. It owns the
 * mutable timer and generation state needed to apply theme overrides at session
 * startup, retry shortly after startup, poll periodically, and clean up reliably
 * on session shutdown. The actual override, config, palette, and system-detection
 * logic lives in focused helper modules.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { applyOverride } from "./apply-override.ts"
import { readPollIntervalMs } from "./config.ts"
import { APPLY_RETRY_DELAYS_MS } from "./constants.ts"

/**
 * Register the theme-overrides Pi extension.
 *
 * @param pi - Pi extension API used to subscribe to session lifecycle events.
 * @returns Nothing; handlers remain registered for the lifetime of the extension runtime.
 *
 * @example
 * ```ts
 * import themeOverrides from "./theme-overrides/index.ts"
 * themeOverrides(pi)
 * ```
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
        console.warn("[theme-overrides] failed to apply built-in theme override", error)
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
    const pollIntervalMs = readPollIntervalMs()

    void safeApply(ctx, activeGeneration)

    clearRetryTimers()
    retryTimers = APPLY_RETRY_DELAYS_MS.map((delay) => setTimeout(() => void safeApply(ctx, activeGeneration), delay))

    if (interval) clearInterval(interval)
    interval = setInterval(() => void safeApply(ctx, activeGeneration), pollIntervalMs)
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
