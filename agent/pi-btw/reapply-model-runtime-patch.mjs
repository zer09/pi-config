#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, "..", "npm", "node_modules", "pi-btw");
const extensionPath = join(packageRoot, "extensions", "btw.ts");
const stockCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey);";
const patchedCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey, { signal: ctx.signal });";

if (!existsSync(extensionPath)) {
  throw new Error(`pi-btw extension not found at ${extensionPath}`);
}

const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
if (packageJson.version !== "0.6.1") {
  throw new Error(`Expected pi-btw 0.6.1, found ${packageJson.version ?? "unknown"}. Port the patch before applying it.`);
}

let content = readFileSync(extensionPath, "utf8");
if (content.includes(patchedCall)) {
  console.log("already patched: runtime-only auth propagation is cancellation-aware");
  process.exit(0);
}
if (!content.includes(stockCall)) {
  throw new Error("Patch anchor not found. pi-btw changed; port the runtime-auth cancellation patch manually.");
}

content = content.replace(stockCall, patchedCall);
writeFileSync(extensionPath, content);
console.log("patched: runtime-only auth propagation is cancellation-aware");
console.log("pi-btw ModelRuntime patch complete. Restart Pi or run /reload.");
