#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Candidate only. Supply an extracted, disposable package under the isolated TMPDIR.
// No default target, live install, dependency loading, or subprocesses.
// Fingerprints come from the registry-SRI-verified pi-btw@0.7.0 tarball.
const fingerprints = [
  ["package.json", "6d3261650cdc8a2786fd084e79c2c79b46c52d3e48acaac1f772102d3f500864"],
  ["extensions/btw.ts", "bc136ec4238e5c6cb39f299cc01e130dd322979100d766bcf931c0cfb9f67621"],
  ["extensions/btw-extension-tools.ts", "d3d69fc86e55ebb7734f80e6691a09b27a370d571cf6f81ffc3d053f038f3a5a"],
  ["skills/btw/SKILL.md", "f29ad6707c1440d4f14f9087f444989cfaf82efe8803f232f0e51aac606bee45"],
  ["README.md", "d8276bff81ce1b9126a4ec14a38a88469fda6b798bc2e53e8b39568f2fb4b5ab"],
  ["LICENSE", "724b6178338d5b81f4f931d5d859dda625b961832c45f2b5eca71545bc6454bd"],
  ["docs/btw-overlay.png", "9beaf91173519378b3fbe866ebae349438a68b497e94aa7cc7204139c6a101b4"],
];
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
  // Reject shared files and linked parents before reading or writing a candidate.
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) {
    throw new Error(`Expected an unlinked regular file: ${rel}`);
  }
  return readFileSync(path);
}

export function reapplyModelRuntimePatch(target) {
  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("Supply an explicit isolated pi-btw@0.7.0 package directory under TMPDIR.");
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
  if (pkg.name !== "pi-btw" || pkg.version !== "0.7.0") {
    throw new Error("Expected exactly pi-btw@0.7.0; no files changed.");
  }

  // Preflight the complete published package before ANY write, including a second pass.
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
      // Reverse only in memory; accepted patched bytes must restore verified stock.
      const original = alreadyPatched ? source.replace(patchedCall, stockCall) : source;
      if (sha256(original) !== expected) throw new Error(`Drifted file: ${rel}`);
    } else if (sha256(bytes) !== expected) {
      throw new Error(`Drifted file: ${rel}`);
    }
  }
  if (alreadyPatched) return "already patched: isolated pi-btw@0.7.0 cancellation-aware runtime auth";
  writeFileSync(join(root, "extensions/btw.ts"), source.replace(stockCall, patchedCall));
  return "patched: isolated pi-btw@0.7.0 cancellation-aware runtime auth";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper $TMPDIR/isolated-pi-btw-0.7.0-package");
  console.log(reapplyModelRuntimePatch(process.argv[2]));
}
