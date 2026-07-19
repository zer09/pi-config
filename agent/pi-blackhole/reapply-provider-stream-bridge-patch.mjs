#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, "..", "npm", "node_modules", "pi-blackhole");
const indexPath = join(packageRoot, "index.ts");
const marker = "registry.getRegisteredProviderIds";

if (!existsSync(indexPath)) {
  throw new Error(`pi-blackhole index.ts not found at ${indexPath}`);
}

const oldText = `\t\tconst registry = (ctx as any)?.modelRegistry;\n\t\tconst registered: Map<string, any> | undefined = registry?.["registeredProviders"];\n\t\tif (registered && typeof registered.forEach === "function") {\n\t\t\tregistered.forEach((config: any, _name: string) => {\n\t\t\t\tif (config && config.streamSimple && config.api && !providerStreams.has(config.api)) {\n\t\t\t\t\tproviderStreams.set(config.api, config.streamSimple);\n\t\t\t\t}\n\t\t\t});\n\t\t}\n`;

const newText = `\t\tconst registry = (ctx as any)?.modelRegistry;\n\t\tconst capture = (config: any) => {\n\t\t\tif (config && config.streamSimple && config.api && !providerStreams.has(config.api)) {\n\t\t\t\tproviderStreams.set(config.api, config.streamSimple);\n\t\t\t}\n\t\t};\n\n\t\t// Pi 0.80.8+ exposes registered provider configs through this public facade.\n\t\t// Scan it first so custom worker providers survive ModelRuntime-backed sessions.\n\t\tif (typeof registry?.getRegisteredProviderIds === "function" && typeof registry?.getRegisteredProviderConfig === "function") {\n\t\t\tfor (const providerId of registry.getRegisteredProviderIds()) {\n\t\t\t\tcapture(registry.getRegisteredProviderConfig(providerId));\n\t\t\t}\n\t\t}\n\n\t\t// Compatibility fallback for older Pi releases that exposed the registry map.\n\t\tconst registered: Map<string, any> | undefined = registry?.["registeredProviders"];\n\t\tif (registered && typeof registered.forEach === "function") {\n\t\t\tregistered.forEach(capture);\n\t\t}\n`;

const content = readFileSync(indexPath, "utf8");
if (content.includes(marker)) {
  console.log("already patched: public provider stream bridge");
} else {
  if (!content.includes(oldText)) {
    throw new Error("Patch anchor not found. pi-blackhole changed; port the provider stream bridge manually.");
  }
  writeFileSync(indexPath, content.replace(oldText, newText));
  console.log("patched: public provider stream bridge");
}

console.log("Provider stream bridge patch complete. Restart Pi or run /reload.");
