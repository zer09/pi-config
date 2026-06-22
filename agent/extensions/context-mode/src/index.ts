import { resetBackendCache } from "./backend.js";
import { createLeanToolRegistrations } from "./tools.js";
import type { ExtensionApiLike } from "./types.js";

export default function contextModeLeanExtension(pi: ExtensionApiLike): void {
  for (const tool of createLeanToolRegistrations()) {
    pi.registerTool(tool);
  }

  pi.on?.("session_shutdown", () => {
    resetBackendCache();
  });
}

export { callCtxTool, loadBackend, resolveContextModeServer, resetBackendCache } from "./backend.js";
export { getLeanToolDefinitionPayloads, LEAN_TOOL_METADATA } from "./schemas.js";
export { createLeanToolRegistrations, executeLeanTool } from "./tools.js";
