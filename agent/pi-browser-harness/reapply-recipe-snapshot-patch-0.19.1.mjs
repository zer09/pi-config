#!/usr/bin/env node
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Identity covers all 127 files from the registry-SRI-verified 0.19.1 archive.
const stockIdentity = "78b72214d79ae3880f36a5a220c94e445154ab7d9ead11d5c3089c7f30dbaa7e";
const sourceHashes = {
  "src/recipes/store.ts": "ee5f37cb5648121df44fa0036e67db45e6d62e9632652c3d3397f17dc706df9e",
  "src/recipes/trust.ts": "fde538decb812a308a93793a2cb30b803bd7a090cc3b6a2f9e412240f27e6dba",
  "src/recipes/run-tool.ts": "b8a0e744f3bc02f2f6ae82a44d4fb5fbe609185f0109f505989d8c8ef522fc06",
  "src/recipes/command.ts": "1c243bb7045d9dd696719a4551a2191af5beb207bf8d88dccc65c95dfae87456",
};
const edits = {
  "src/recipes/store.ts": [
    ['import { randomUUID } from "node:crypto";', 'import { createHash, randomUUID } from "node:crypto";'],
    ['readonly root: string };', 'readonly root: string; readonly sourceHash: string };'],
    ['  let text: string;\n  try {\n    text = await readFile(path, "utf8");', '  let bytes: Buffer;\n  try {\n    bytes = await readFile(path);'],
    ['  const parsed = parseRecipe(text);', '  const parsed = parseRecipe(bytes.toString("utf8"));'],
    ['  return ok({ recipe: parsed.data, path, root });', '  // Keep the identity of the bytes we parsed, even if another writer replaces the path.\n  return ok({ recipe: parsed.data, path, root, sourceHash: createHash("sha256").update(bytes).digest("hex") });'],
    ['const writeAtomic = async (path: string, text: string): Promise<void> => {', 'const writeAtomic = async (path: string, text: string): Promise<string> => {'],
    ['    await rename(tmp, path);', '    await rename(tmp, path);\n    return createHash("sha256").update(text).digest("hex");'],
    ['    await writeAtomic(path, stringifyRecipe(saved));\n    return ok({ recipe: saved, path, root });', '    const sourceHash = await writeAtomic(path, stringifyRecipe(saved));\n    return ok({ recipe: saved, path, root, sourceHash });'],
    ['export const recordRun = async (stored: StoredRecipe, lastRun: LastRun): Promise<void> => {\n  await writeAtomic(stored.path, stringifyRecipe({ ...stored.recipe, lastRun })).catch(() => undefined);\n};', 'export const recordRun = async (stored: StoredRecipe, lastRun: LastRun): Promise<StoredRecipe | undefined> => {\n  const recipe = { ...stored.recipe, lastRun };\n  const sourceHash = await writeAtomic(stored.path, stringifyRecipe(recipe)).catch(() => undefined);\n  return sourceHash === undefined ? undefined : { ...stored, recipe, sourceHash };\n};'],
  ],
  "src/recipes/trust.ts": [
    ['export const isTrusted = async (path: string, bytes: Uint8Array, scope?: string): Promise<boolean> => {\n  const store = await readStore();\n  return store[resolve(path)] === sha256(bytes)', 'const isTrustedHash = async (path: string, sourceHash: string, scope?: string): Promise<boolean> => {\n  const store = await readStore();\n  return store[resolve(path)] === sourceHash'],
    ['export const trust = async (path: string, bytes: Uint8Array, scope?: string): Promise<void> => {', 'export const isTrusted = (path: string, bytes: Uint8Array, scope?: string): Promise<boolean> => isTrustedHash(path, sha256(bytes), scope);\n\nconst trustHash = async (path: string, sourceHash: string, scope?: string): Promise<void> => {'],
    ['    [resolve(path)]: sha256(bytes),', '    [resolve(path)]: sourceHash,'],
    ['const isProject = (stored: StoredRecipe, cwd: string): boolean =>', 'export const trust = (path: string, bytes: Uint8Array, scope?: string): Promise<void> => trustHash(path, sha256(bytes), scope);\n\nconst isProject = (stored: StoredRecipe, cwd: string): boolean =>'],
    ['  const bytes = await readFile(stored.path).catch(() => undefined);\n  if (bytes !== undefined) await trust(stored.path, bytes).catch(() => undefined);', '  // Trust only our completed write, never a replacement left by another writer.\n  await trustHash(stored.path, stored.sourceHash).catch(() => undefined);'],
    ['  const scope = paramScope(stored.recipe, params);\n  if (await isTrusted(stored.path, bytes, scope)) return ok(undefined);', '  if (sha256(bytes) !== stored.sourceHash) return err(`recipe ${name} changed since it was loaded; run it again to approve the new bytes`);\n  const scope = paramScope(stored.recipe, params);\n  if (await isTrustedHash(stored.path, stored.sourceHash, scope)) return ok(undefined);'],
    ['  await trust(stored.path, bytes, scope);', '  await trustHash(stored.path, stored.sourceHash, scope);'],
  ],
  "src/recipes/run-tool.ts": [
    ['import { Type } from "typebox";', 'import { Type } from "typebox";\nimport { daemonSocketMayExist } from "../daemon/spawn";'],
    ['  concurrency: "parallel",\n  async handler', '  concurrency: "parallel",\n  // Approval must finish before even checking the browser connection.\n  ensureAlive: false,\n  async handler'],
    ['    if (!approved.success) return err({ kind: "invalid_state", message: approved.error });', '    if (!approved.success) return err({ kind: "invalid_state", message: approved.error });\n    if (!(await daemonSocketMayExist())) return err({ kind: "not_connected", message: "Browser harness not initialized. Run /browser-setup first" });\n    const alive = await client.ensureAlive();\n    if (!alive.success) return err({ kind: "not_connected", message: alive.error.message });'],
    ['      await recordRun(stored.data, { at, result: "ok" });\n      await trustWritten(stored.data, cwd);', '      const written = await recordRun(stored.data, { at, result: "ok" });\n      if (written !== undefined) await trustWritten(written, cwd);'],
    ['    await recordRun(stored.data, { at, result: "failed", step: outcome.failure.step });\n    await trustWritten(stored.data, cwd);', '    const written = await recordRun(stored.data, { at, result: "failed", step: outcome.failure.step });\n    if (written !== undefined) await trustWritten(written, cwd);'],
  ],
  "src/recipes/command.ts": [
    ['      const alive = await client.ensureAlive();\n      if (!alive.success) {\n        ctx.ui.notify(`Browser not connected: ${alive.error.message}. Run /browser-setup first.`, "error");\n        return;\n      }\n      const stored = await findRecipe', '      const stored = await findRecipe'],
    ['      ctx.ui.notify(`Running recipe ${name}…`, "info");', '      const alive = await client.ensureAlive();\n      if (!alive.success) {\n        ctx.ui.notify(`Browser not connected: ${alive.error.message}. Run /browser-setup first.`, "error");\n        return;\n      }\n      ctx.ui.notify(`Running recipe ${name}…`, "info");'],
    ['        await recordRun(stored.data, { at, result: "ok" });\n        await trustWritten(stored.data, ctx.cwd);', '        const written = await recordRun(stored.data, { at, result: "ok" });\n        if (written !== undefined) await trustWritten(written, ctx.cwd);'],
    ['      await recordRun(stored.data, { at, result: "failed", step: outcome.failure.step });\n      await trustWritten(stored.data, ctx.cwd);', '      const written = await recordRun(stored.data, { at, result: "failed", step: outcome.failure.step });\n      if (written !== undefined) await trustWritten(written, ctx.cwd);'],
  ],
};
const sha256 = content => createHash("sha256").update(content).digest("hex");
function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function readIsolatedFile(root, rel) {
  const path = join(root, rel), stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) throw new Error(`Expected an unlinked regular file: ${rel}`);
  return readFileSync(path);
}
function replaceUnique(content, before, after) {
  if (content.split(before).length !== 2) throw new Error("Mixed, partial, or drifted recipe snapshot patch anchor");
  return content.replace(before, after);
}
export function reapplyRecipeSnapshotPatch(target) {
  if (typeof target !== "string" || !target.trim()) throw new Error("Supply an explicit isolated pi-browser-harness@0.19.1 directory under canonical disposable TMPDIR.");
  const root = resolve(target), repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../..")), temp = process.env.TMPDIR;
  if (!temp || !isAbsolute(temp) || resolve(temp) !== temp || realpathSync(temp) !== temp || tmpdir() !== temp ||
      target !== root || realpathSync(root) !== root || !lstatSync(root).isDirectory() || !isWithin(temp, root) ||
      root === repository || isWithin(repository, root) || isWithin(root, repository) || root.split(sep).includes("node_modules")) {
    throw new Error("Refusing a non-isolated target; use a canonical extracted package under explicit disposable TMPDIR.");
  }
  const pkg = JSON.parse(readIsolatedFile(root, "package.json"));
  if (pkg.name !== "pi-browser-harness" || pkg.version !== "0.19.1") throw new Error("Expected exactly pi-browser-harness@0.19.1; no files changed.");
  const originals = {}, patched = {}, states = [];
  for (const [rel, changes] of Object.entries(edits)) {
    const current = readIsolatedFile(root, rel).toString("utf8"), stock = sha256(current) === sourceHashes[rel];
    let original = current;
    if (!stock) for (const [before, after] of [...changes].reverse()) original = replaceUnique(original, after, before);
    if (sha256(original) !== sourceHashes[rel]) throw new Error(`Drifted source: ${rel}; no files changed.`);
    let next = original;
    for (const [before, after] of changes) next = replaceUnique(next, before, after);
    if (!stock && current !== next) throw new Error("Mixed recipe snapshot patch state; no files changed.");
    originals[rel] = original; patched[rel] = next; states.push(stock);
  }
  if (states.some(Boolean) && !states.every(Boolean)) throw new Error("Mixed, partial recipe snapshot repair; no files changed.");
  const entries = [];
  function visit(dir, prefix = "") {
    const children = readdirSync(dir).sort();
    if (!children.length) throw new Error(`Unexpected empty directory: ${prefix}`);
    for (const name of children) {
      const rel = prefix ? `${prefix}/${name}` : name, path = join(root, rel), stat = lstatSync(path);
      if (stat.isDirectory() && realpathSync(path) === path) visit(path, rel);
      else { const bytes = readIsolatedFile(root, rel); entries.push([rel, sha256(originals[rel] ?? bytes)]); }
    }
  }
  visit(root);
  entries.sort(([a], [b]) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  if (entries.length !== 127 || sha256(JSON.stringify(entries)) !== stockIdentity) throw new Error("Drifted complete 127-file artifact identity; no files changed.");
  if (!states[0]) return "already patched: isolated pi-browser-harness@0.19.1";
  // Check every destination before the first write, including late failures.
  for (const rel of Object.keys(edits)) accessSync(join(root, rel), constants.W_OK);
  for (const [rel, text] of Object.entries(patched)) writeFileSync(join(root, rel), text);
  return "patched: isolated pi-browser-harness@0.19.1 exact-byte recipe snapshot";
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper $TMPDIR/isolated-pi-browser-harness-0.19.1-package");
  console.log(reapplyRecipeSnapshotPatch(process.argv[2]));
}
