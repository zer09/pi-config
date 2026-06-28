import { createToolRegistrations } from "./tools.js";
import type { ExtensionApiLike } from "./types.js";

export default function webSearchExaExtension(pi: ExtensionApiLike): void {
  for (const tool of createToolRegistrations()) {
    pi.registerTool(tool);
  }
}

export { normalizeGeminiExaResponse, extractBenchmarkResponseJson } from "./normalize.js";
export { classifyFallbackRoute, selectFallbackRoute } from "./routing.js";
export { normalizeUrl, cacheKeyForUrl } from "./url.js";
export { executeWebSearchExa, executeFetchGrounding, executeFetchContents } from "./tools.js";
