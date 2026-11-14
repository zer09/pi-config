#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Candidate only: an explicit extracted package under the isolated OS TMPDIR.
// No default/live target, dependency loading, subprocesses, or downloads.
// Verified pi-btw@0.8.1 archive:
// sha512-Aol1JFiillvkAjtv4elc9sVg8Cb8XqIvEsPUMm4AD4csLELHrqvcRqCEJxAH4oLFYjxJ3uHO+sPYz1BD1B6o9A==
const fingerprints = [
  ["package.json", "13638ba6fb0270cdffe994b705c1d50df6591bb12ca7ca151115c61df9e641cb"],
  ["extensions/btw.ts", "2135f3dd58eac0dbba728982794ebba6a84bc2dcb372f4e89ce583749fd3e7b1"],
  ["extensions/btw-extension-tools.ts", "4c4bbc2b675ab16b8330dcadb6acfe05678c3c36f62611f61bfecea297b9fe65"],
  ["extensions/btw-ssh-workspace.ts", "176aff249c75a46bc80c5c329a6c33ebfc99979f1fc039fb26670b85ada8b8db"],
  ["skills/btw/SKILL.md", "f29ad6707c1440d4f14f9087f444989cfaf82efe8803f232f0e51aac606bee45"],
  ["README.md", "84328b514388c3a8885b38fdf03385492c873a858f399dcedc9432c4b6269b07"],
  ["LICENSE", "724b6178338d5b81f4f931d5d859dda625b961832c45f2b5eca71545bc6454bd"],
  ["docs/btw-overlay.png", "9beaf91173519378b3fbe866ebae349438a68b497e94aa7cc7204139c6a101b4"],
];
const patchedFingerprint = "7ad87e46639723979d7e199f22db7739ced696efd3a8451afc69d86446eadc8d";
const stockCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey);";
const patchedCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey, { signal: ctx.signal });";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function readIsolatedFile(root, rel) {
  const path = join(root, rel);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) {
    throw new Error(`Expected an unlinked regular file: ${rel}`);
  }
  return readFileSync(path);
}

function checkInventory(root, prefix = "") {
  const files = [];
  for (const name of readdirSync(join(root, prefix))) {
    const rel = join(prefix, name);
    const stat = lstatSync(join(root, rel));
    if (stat.isDirectory()) files.push(...checkInventory(root, rel));
    else {
      // Reject links before traversal or reading, including links in unchanged files.
      if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Expected an unlinked regular file: ${rel}`);
      files.push(rel);
    }
  }
  return files;
}

export function reapplyModelRuntimePatch(target) {
  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("Supply an explicit isolated pi-btw@0.8.1 package directory under TMPDIR.");
  }
  const root = resolve(target);
  const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  if (
    realpathSync(root) !== root ||
    !isWithin(realpathSync(tmpdir()), root) ||
    root === repository || isWithin(repository, root) ||
    root.split(sep).includes("node_modules")
  ) {
    throw new Error("Refusing a non-isolated target; use an unlinked extracted package under TMPDIR.");
  }

  const manifest = readIsolatedFile(root, "package.json");
  const pkg = JSON.parse(manifest);
  if (pkg.name !== "pi-btw" || pkg.version !== "0.8.1") {
    throw new Error("Expected exactly pi-btw@0.8.1; no files changed.");
  }
  const actualFiles = checkInventory(root).sort();
  const expectedFiles = fingerprints.map(([rel]) => rel).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Drifted whole-package inventory; no files changed.");
  }

  // Preflight every published file before ANY write, including an already-patched pass.
  let source;
  let alreadyPatched = false;
  for (const [rel, expected] of fingerprints) {
    const bytes = rel === "package.json" ? manifest : readIsolatedFile(root, rel);
    if (rel === "extensions/btw.ts") {
      source = bytes.toString("utf8");
      const stockCount = source.split(stockCall).length - 1;
      const patchedCount = source.split(patchedCall).length - 1;
      if (stockCount + patchedCount !== 1) throw new Error(`Mixed, duplicate, or missing patch anchor: ${rel}`);
      alreadyPatched = patchedCount === 1;
      if (sha256(bytes) !== (alreadyPatched ? patchedFingerprint : expected)) throw new Error(`Drifted file: ${rel}`);
    } else if (sha256(bytes) !== expected) {
      throw new Error(`Drifted file: ${rel}`);
    }
  }
  if (alreadyPatched) return "already patched: isolated pi-btw@0.8.1 cancellation-aware runtime auth";
  writeFileSync(join(root, "extensions", "btw.ts"), source.replace(stockCall, patchedCall));
  return "patched: isolated pi-btw@0.8.1 cancellation-aware runtime auth";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper $TMPDIR/isolated-pi-btw-0.8.1-package");
  console.log(reapplyModelRuntimePatch(process.argv[2]));
}
