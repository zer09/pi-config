#!/usr/bin/env node
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// No default target, dependency loading, subprocesses, or installed-package writes.
// Identity covers all 99 files from the registry-SRI-verified 0.13.0 artifact.
const stockIdentity = "c8833eb4ef6ca35a5502e2961cf643257c25fb0c5f75fe2d5bdad34599a151e7";
const registryHash = "3c89a038bff1bbac37122630869e6b07479b072abb4a680cb7e25d9c5460da41";
const edits = [
  [
    "  const registered = new Set<string>();",
    "  // Pi can reuse this registry with a fresh API after session replacement.\n  const registeredByApi = new WeakMap<ToolRegistrar, Set<string>>();",
  ],
  [
    "    register: (pi, client) => {\n      for (const tool of tools) {",
    "    register: (pi, client) => {\n      let registered = registeredByApi.get(pi);\n      if (!registered) {\n        registered = new Set<string>();\n        registeredByApi.set(pi, registered);\n      }\n      for (const tool of tools) {",
  ],
];
const sha256 = content => createHash("sha256").update(content).digest("hex");
function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function readIsolatedFile(root, rel) {
  const path = join(root, rel), stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) {
    throw new Error(`Expected an unlinked regular file: ${rel}`);
  }
  return readFileSync(path);
}
function replaceUnique(content, before, after) {
  if (content.split(before).length !== 2) throw new Error("Mixed, partial, or drifted registry patch anchor");
  return content.replace(before, after);
}

export function reapplyRuntimeRegistrationPatch(target) {
  if (typeof target !== "string" || !target.trim()) {
    throw new Error("Supply an explicit isolated pi-browser-harness@0.13.0 directory under canonical disposable TMPDIR.");
  }
  const root = resolve(target);
  const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const temp = process.env.TMPDIR;
  if (!temp || !isAbsolute(temp) || resolve(temp) !== temp || realpathSync(temp) !== temp || tmpdir() !== temp ||
      target !== root || realpathSync(root) !== root || !lstatSync(root).isDirectory() ||
      !isWithin(temp, root) || root === repository || isWithin(repository, root) || isWithin(root, repository) ||
      root.split(sep).includes("node_modules")) {
    throw new Error("Refusing a non-isolated target; use a canonical extracted package under explicit disposable TMPDIR.");
  }
  const pkg = JSON.parse(readIsolatedFile(root, "package.json"));
  if (pkg.name !== "pi-browser-harness" || pkg.version !== "0.13.0") {
    throw new Error("Expected exactly pi-browser-harness@0.13.0; no files changed.");
  }
  const current = readIsolatedFile(root, "src/registry.ts").toString("utf8");
  const stock = sha256(current) === registryHash;
  let original = current;
  if (!stock) {
    // Reverse only in memory. Partial repairs must not become accepted inputs.
    for (const [before, after] of [...edits].reverse()) original = replaceUnique(original, after, before);
    if (sha256(original) !== registryHash) throw new Error("Drifted registry; no files changed.");
  }
  let patched = original;
  for (const [before, after] of edits) patched = replaceUnique(patched, before, after);
  if (!stock && current !== patched) throw new Error("Mixed registry patch state; no files changed.");

  // Preflight the complete artifact, not just the edited file, before any write.
  const entries = [];
  function visit(dir, prefix = "") {
    const children = readdirSync(dir).sort();
    if (!children.length) throw new Error(`Unexpected empty directory: ${prefix}`);
    for (const name of children) {
      const rel = prefix ? `${prefix}/${name}` : name, path = join(root, rel);
      const stat = lstatSync(path);
      if (stat.isDirectory() && realpathSync(path) === path) visit(path, rel);
      else {
        const bytes = readIsolatedFile(root, rel);
        entries.push([rel, sha256(rel === "src/registry.ts" ? original : bytes)]);
      }
    }
  }
  visit(root);
  entries.sort(([a], [b]) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  if (entries.length !== 99 || sha256(JSON.stringify(entries)) !== stockIdentity) {
    throw new Error("Drifted complete 99-file artifact identity; no files changed.");
  }
  if (!stock) return "already patched: isolated pi-browser-harness@0.13.0";
  accessSync(join(root, "src/registry.ts"), constants.W_OK);
  writeFileSync(join(root, "src/registry.ts"), patched);
  return "patched: isolated pi-browser-harness@0.13.0 per-runtime registration";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper $TMPDIR/isolated-pi-browser-harness-0.13.0-package");
  console.log(reapplyRuntimeRegistrationPatch(process.argv[2]));
}
