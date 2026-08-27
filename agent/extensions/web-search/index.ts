/**
 * Root Pi extension entry point for the web-search package.
 *
 * Registers the user-facing web_search, web_code_search, and fetch_contents
 * tools from the package root entry point. The agent selects semantic intent
 * through the public tool schemas; provider routing and operational fallback
 * stay internal to the extension.
 */
import { createToolRegistrations } from "./src/tools.js";
import type { ExtensionApiLike } from "./src/types.js";

/**
 * Registers all web-search extension tools with Pi.
 *
 * @param pi - Pi extension API used to register tool definitions.
 * @returns Nothing.
 */
export default function webSearchExtension(pi: ExtensionApiLike): void {
  for (const tool of createToolRegistrations()) {
    pi.registerTool(tool);
  }
}
