/**
 * Public Pi extension entrypoint for native CodeGraph tools.
 *
 * Pi auto-discovers this file from `package.json`. It intentionally remains the
 * public facade/orchestrator rather than a re-export-only shim: it reads session
 * configuration, creates the graph lifecycle manager, wires cleanup, and
 * registers the focused tool modules.
 */

import { parseAutoInitPolicy, parseSyncTtlMs } from "./config.ts";
import { GraphManager } from "./graph-manager.ts";
import { registerCodeGraphTools } from "./tools/register-tools.ts";
import type { ExtensionAPI } from "./types.ts";

/**
 * Register the native CodeGraph Pi extension.
 *
 * @param pi - Pi extension API used for tool registration and lifecycle events.
 * @returns Nothing; registered tools and shutdown handlers live for the session.
 *
 * @example
 * ```ts
 * import codegraphExtension from "./index.ts";
 * codegraphExtension(pi);
 * ```
 */
export default function codegraphExtension(pi: ExtensionAPI): void {
  const manager = new GraphManager({
    pi,
    syncTtlMs: parseSyncTtlMs(),
    autoInitPolicy: parseAutoInitPolicy(),
  });

  pi.on("session_shutdown", async () => {
    await manager.closeAll();
  });

  registerCodeGraphTools(pi, manager);
}
