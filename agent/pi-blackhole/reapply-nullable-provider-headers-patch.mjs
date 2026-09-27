#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, "..", "npm", "node_modules", "pi-blackhole");

function replaceOnce(rel, oldText, newText) {
  const path = join(packageRoot, rel);
  let content = readFileSync(path, "utf8");
  if (content.includes(newText)) {
    console.log(`already patched: ${rel}`);
    return;
  }
  if (!content.includes(oldText)) {
    throw new Error(`Patch anchor not found in ${rel}. pi-blackhole changed; port patch manually.`);
  }
  content = content.replace(oldText, newText);
  writeFileSync(path, content);
  console.log(`patched: ${rel}`);
}

function replaceAllExact(rel, oldText, newText, expectedCount) {
  const path = join(packageRoot, rel);
  let content = readFileSync(path, "utf8");
  const count = content.split(oldText).length - 1;
  if (count === 0 && content.split(newText).length - 1 === expectedCount) {
    console.log(`already patched: ${rel}`);
    return;
  }
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} patch anchors in ${rel}, found ${count}. pi-blackhole changed; port patch manually.`);
  }
  content = content.replaceAll(oldText, newText);
  writeFileSync(path, content);
  console.log(`patched: ${rel}`);
}

if (!existsSync(packageRoot)) {
  throw new Error(`pi-blackhole package not found at ${packageRoot}`);
}

replaceOnce(
  "src/om/runtime.ts",
  `import type { AuthResult } from "@earendil-works/pi-ai";`,
  `import type { AuthResult, ProviderHeaders } from "@earendil-works/pi-ai";`,
);
replaceOnce(
  "src/om/runtime.ts",
  `      headers?: Record<string, string>;`,
  `      headers?: ProviderHeaders;`,
);
replaceAllExact(
  "src/om/runtime.ts",
  `        headers: auth.headers as Record<string, string> | undefined,`,
  `        headers: auth.headers,`,
  2,
);

replaceOnce(
  "src/om/provider-stream.ts",
  `interface RegisteredProviderConfig {`,
  `import type { ProviderHeaders } from "@earendil-works/pi-ai";\n\ninterface RegisteredProviderConfig {`,
);
replaceOnce(
  "src/om/provider-stream.ts",
  `  headers: Record<string, string> | undefined,\n  sessionId: string | undefined,\n): Record<string, string> | undefined {`,
  `  headers: ProviderHeaders | undefined,\n  sessionId: string | undefined,\n): ProviderHeaders | undefined {`,
);
replaceOnce(
  "src/om/provider-stream.ts",
  `    const attributed = withProviderAttributionHeaders(model, headers, sessionId) ?? {};`,
  `    // This transform receives post-auth string headers, so no nullable deletion\n    // marker can exist on this path even though the shared merge helper preserves them.\n    const attributed = withProviderAttributionHeaders(model, headers, sessionId) as\n      | Record<string, string>\n      | undefined;`,
);
replaceOnce(
  "src/om/provider-stream.ts",
  `    if (typeof next === "function") return (await next(attributed)) ?? attributed;\n    return attributed;`,
  `    const merged = attributed ?? {};\n    if (typeof next === "function") return (await next(merged)) ?? merged;\n    return merged;`,
);

for (const stage of ["observer", "reflector", "dropper"]) {
  const rel = `src/om/agents/${stage}/agent.ts`;
  replaceOnce(
    rel,
    `import type { Message, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";`,
    `import type {\n  Message,\n  Model,\n  ModelThinkingLevel,\n  ProviderHeaders,\n} from "@earendil-works/pi-ai";`,
  );
  replaceOnce(
    rel,
    `  headers?: Record<string, string>;`,
    `  headers?: ProviderHeaders;`,
  );
}

console.log("Nullable ProviderHeaders patch complete. Restart Pi or run /reload.");
