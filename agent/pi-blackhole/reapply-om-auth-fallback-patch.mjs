#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "npm", "node_modules", "pi-blackhole");
const runtimePath = join(packageRoot, "src", "om", "runtime.ts");

function replaceOnce(content, oldText, newText, marker, label) {
  if (content.includes(marker)) {
    console.log(`already patched: ${label}`);
    return { content, changed: false };
  }
  if (!content.includes(oldText)) {
    throw new Error(`Patch anchor not found for ${label}. pi-blackhole changed; port patch manually.`);
  }
  console.log(`patched: ${label}`);
  return { content: content.replace(oldText, newText), changed: true };
}

if (!existsSync(packageRoot)) {
  throw new Error(`pi-blackhole package not found at ${packageRoot}`);
}
if (!existsSync(runtimePath)) {
  throw new Error(`runtime.ts not found at ${runtimePath}`);
}

let content = readFileSync(runtimePath, "utf8");
let changed = false;

{
  const result = replaceOnce(
    content,
    `export interface LaunchCtx {\n\thasUI: boolean;\n\tui?: { notify: Notify };\n}\n\n/** Default cooldown interval between failed consolidation runs (ms). */\nconst CONSOLIDATION_RETRY_COOLDOWN_MS = 30_000;\n`,
    `export interface LaunchCtx {\n\thasUI: boolean;\n\tui?: { notify: Notify };\n}\n\nasync function resolveRequestAuth(modelRegistry: any, model: any): Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }> {\n\tconst auth = await modelRegistry.getApiKeyAndHeaders(model);\n\tif (!auth.ok) return auth;\n\tif (auth.apiKey) return auth;\n\n\t// Pi's regular model execution can use provider env fallbacks such as GEMINI_API_KEY,\n\t// but getApiKeyAndHeaders intentionally doesn't include those fallbacks. OM workers\n\t// need the same provider-level fallback so env-authenticated Google models work here.\n\tif (model?.provider && typeof modelRegistry.getApiKeyForProvider === "function") {\n\t\tconst apiKey = await modelRegistry.getApiKeyForProvider(model.provider);\n\t\tif (apiKey) return { ...auth, apiKey };\n\t}\n\n\treturn auth;\n}\n\n/** Default cooldown interval between failed consolidation runs (ms). */\nconst CONSOLIDATION_RETRY_COOLDOWN_MS = 30_000;\n`,
    "async function resolveRequestAuth(",
    "runtime.ts auth helper",
  );
  content = result.content;
  changed ||= result.changed;
}

{
  const result = replaceOnce(
    content,
    `\t\t\tconst auth = await ctx.modelRegistry.getApiKeyAndHeaders(configured);\n\t\t\tif (!auth.ok || !auth.apiKey) {\n\t\t\t\tif (ctx.hasUI && ctx.ui) {\n\t\t\t\t\tctx.ui.notify(\n\t\t\t\t\t\t\`Observational memory: \${stageName} no auth for \${candidate.provider}\`,\n\t\t\t\t\t\t"warning",\n\t\t\t\t\t);\n\t\t\t\t}\n\t\t\t\tcontinue;\n\t\t\t}\n\n\t\t\treturn {\n\t\t\t\tok: true,\n\t\t\t\tmodel: configured,\n\t\t\t\tapiKey: auth.apiKey as string,\n\t\t\t\theaders: auth.headers as Record<string, string> | undefined,\n\t\t\t\tcooldownApplied: false,\n\t\t\t};\n`,
    `\t\t\tconst auth = await resolveRequestAuth(ctx.modelRegistry, configured);\n\t\t\tif (!auth.ok || !auth.apiKey) {\n\t\t\t\tif (ctx.hasUI && ctx.ui) {\n\t\t\t\t\tctx.ui.notify(\n\t\t\t\t\t\t\`Observational memory: \${stageName} no auth for \${candidate.provider}\`,\n\t\t\t\t\t\t"warning",\n\t\t\t\t\t);\n\t\t\t\t}\n\t\t\t\tcontinue;\n\t\t\t}\n\n\t\t\treturn {\n\t\t\t\tok: true,\n\t\t\t\tmodel: configured,\n\t\t\t\tapiKey: auth.apiKey,\n\t\t\t\theaders: auth.headers,\n\t\t\t\tcooldownApplied: false,\n\t\t\t};\n`,
    "const auth = await resolveRequestAuth(ctx.modelRegistry, configured);",
    "runtime.ts configured model auth",
  );
  content = result.content;
  changed ||= result.changed;
}

{
  const result = replaceOnce(
    content,
    `\t\t\tconst auth = await ctx.modelRegistry.getApiKeyAndHeaders(sessionModel);\n\t\t\tif (!auth.ok || !auth.apiKey) {\n\t\t\t\tconst provider = (sessionModel as { provider?: string }).provider ?? "unknown";\n\t\t\t\treturn { ok: false, reason: \`no API key for session model provider "\${provider}"\` };\n\t\t\t}\n\n\t\t\treturn {\n\t\t\t\tok: true,\n\t\t\t\tmodel: sessionModel,\n\t\t\t\tapiKey: auth.apiKey as string,\n\t\t\t\theaders: auth.headers as Record<string, string> | undefined,\n\t\t\t\tcooldownApplied: false,\n\t\t\t};\n`,
    `\t\t\tconst auth = await resolveRequestAuth(ctx.modelRegistry, sessionModel);\n\t\t\tif (!auth.ok || !auth.apiKey) {\n\t\t\t\tconst provider = (sessionModel as { provider?: string }).provider ?? "unknown";\n\t\t\t\treturn { ok: false, reason: \`no API key for session model provider "\${provider}"\` };\n\t\t\t}\n\n\t\t\treturn {\n\t\t\t\tok: true,\n\t\t\t\tmodel: sessionModel,\n\t\t\t\tapiKey: auth.apiKey,\n\t\t\t\theaders: auth.headers,\n\t\t\t\tcooldownApplied: false,\n\t\t\t};\n`,
    "const auth = await resolveRequestAuth(ctx.modelRegistry, sessionModel);",
    "runtime.ts session model auth",
  );
  content = result.content;
  changed ||= result.changed;
}

if (changed) writeFileSync(runtimePath, content);
console.log("OM auth fallback patch complete. Restart Pi or run /reload.");
