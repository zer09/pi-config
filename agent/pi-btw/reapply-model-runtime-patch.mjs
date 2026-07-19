#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, "..", "npm", "node_modules", "pi-btw");
const extensionPath = join(packageRoot, "extensions", "btw.ts");
const currentMarker = 'parentAuthStatus.source === "runtime"';
const previousHelper = `async function createBtwModelRuntime(ctx: ExtensionCommandContext, model: SessionModel): Promise<ModelRuntime> {
  const modelRuntime = await ModelRuntime.create();
  const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);
  if (providerConfig) {
    modelRuntime.registerProvider(model.provider, providerConfig);
  }
  return modelRuntime;
}`;
const currentHelper = `async function createBtwModelRuntime(ctx: ExtensionCommandContext, model: SessionModel): Promise<ModelRuntime> {
  const modelRuntime = await ModelRuntime.create();
  const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);
  if (providerConfig) {
    modelRuntime.registerProvider(model.provider, providerConfig);
  }

  // A fresh child runtime cannot see credentials supplied only to the parent with
  // --api-key or ModelRuntime.setRuntimeApiKey(). Copy only that transient source;
  // stored, environment, command-backed, and OAuth auth resolve normally.
  const parentAuthStatus = ctx.modelRegistry.getProviderAuthStatus(model.provider);
  if (parentAuthStatus.source === "runtime") {
    const parentAuth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (parentAuth.ok && parentAuth.apiKey) {
      await modelRuntime.setRuntimeApiKey(model.provider, parentAuth.apiKey);
    }
  }
  return modelRuntime;
}`;

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
if (content.includes(currentMarker)) {
  console.log("already patched: ModelRuntime child sessions with runtime auth");
  process.exit(0);
}

if (content.includes(previousHelper)) {
  content = content.replace(previousHelper, currentHelper);
  writeFileSync(extensionPath, content);
  console.log("upgraded: previous ModelRuntime patch with runtime auth propagation");
  console.log("pi-btw ModelRuntime patch complete. Restart Pi or run /reload.");
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
  `}\n\n${currentHelper}\n\nfunction extractText(parts: AssistantMessage["content"], type: "text" | "thinking"): string {\n`,
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
console.log("patched: ModelRuntime child sessions with runtime auth");
console.log("pi-btw ModelRuntime patch complete. Restart Pi or run /reload.");
