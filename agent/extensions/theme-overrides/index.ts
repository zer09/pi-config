/**
 * Public Pi extension entry point for manual theme synchronization.
 *
 * The startup wrapper selects the first-frame theme. This extension stays dormant
 * until the user runs /theme-sync.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { applyOverride } from "./apply-override.ts"

/**
 * Register the theme-overrides Pi extension.
 */
export default function themeOverridesExtension(
  pi: ExtensionAPI,
  runOverride: typeof applyOverride = applyOverride,
): void {
  pi.registerCommand("theme-sync", {
    description: "Sync the runtime theme with system appearance once",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return

      try {
        await runOverride(pi, ctx, new AbortController().signal, () => true)
      } catch (error) {
        try {
          const message = error instanceof Error ? error.message : String(error)
          ctx.ui.notify(`Theme sync failed: ${message}`, "warning")
        } catch (notificationError) {
          console.warn("[theme-overrides] failed to report theme sync error", error, notificationError)
        }
      }
    },
  })
}
