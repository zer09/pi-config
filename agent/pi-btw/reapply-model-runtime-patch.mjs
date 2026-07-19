#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, "..", "npm", "node_modules", "pi-btw");
const extensionPath = join(packageRoot, "extensions", "btw.ts");
const marker = "async function createBtwModelRuntime(";

function replaceOnce(content, oldText, newText, label) {
  if (!content.includes(oldText)) {
    throw new Error(`Patch anchor not found for ${label}. pi-btw changed; port the patch manually.`);
  }
  return content.replace(oldText, newText);
}

if (!existsSync(extensionPath)) {
  throw new Error(`pi-btw extension not found at ${extensionPath}`);
}

let content = readFileSync(extensionPath, "utf8");
if (content.includes(marker)) {
  console.log("already patched: ModelRuntime child sessions");
  process.exit(0);
}

content = replaceOnce(
  content,
  `  createExtensionRuntime,\n  SessionManager,\n`,
  `  createExtensionRuntime,\n  ModelRuntime,\n  SessionManager,\n`,
  "ModelRuntime import",
);

content = replaceOnce(
  content,
  `}\n\nfunction extractText(parts: AssistantMessage["content"], type: "text" | "thinking"): string {\n`,
  `}\n\nasync function createBtwModelRuntime(ctx: ExtensionCommandContext, model: SessionModel): Promise<ModelRuntime> {\n  const modelRuntime = await ModelRuntime.create();\n  const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);\n  if (providerConfig) {\n    modelRuntime.registerProvider(model.provider, providerConfig);\n  }\n  return modelRuntime;\n}\n\nfunction extractText(parts: AssistantMessage["content"], type: "text" | "thinking"): string {\n`,
  "ModelRuntime helper",
);

content = replaceOnce(
  content,
  `    const { session } = await createAgentSession({\n      sessionManager: SessionManager.inMemory(),\n      model: settings.model,\n      modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],\n`,
  `    const modelRuntime = await createBtwModelRuntime(ctx, settings.model);\n    const { session } = await createAgentSession({\n      sessionManager: SessionManager.inMemory(),\n      model: settings.model,\n      modelRuntime,\n`,
  "BTW conversation child session",
);

content = replaceOnce(
  content,
  `    const { session } = await createAgentSession({\n      sessionManager: SessionManager.inMemory(),\n      model,\n      modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],\n`,
  `    const modelRuntime = await createBtwModelRuntime(ctx, model);\n    const { session } = await createAgentSession({\n      sessionManager: SessionManager.inMemory(),\n      model,\n      modelRuntime,\n`,
  "BTW summarizer child session",
);

writeFileSync(extensionPath, content);
console.log("patched: ModelRuntime child sessions");
console.log("pi-btw ModelRuntime patch complete. Restart Pi or run /reload.");
