#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Candidate only. Supply an unlinked, extracted package under the isolated TMPDIR.
// No default target, live install, dependency loading, or subprocesses.
export const STOCK_SHA256 = "ceb93d567a76d7a5ac03ef7f55c9b437c6bcb8dda2dc82253840df16eaa716f5";
export const PATCHED_SHA256 = "6489bf4e87841ee193987f9787770c7f32e5db57d8389fb47c7d9b69bdb567fd";
const sha256 = (source) => createHash("sha256").update(source).digest("hex");

export function patchTranscriptSource(source) {
  const hash = sha256(source);
  if (hash === PATCHED_SHA256) return source;
  if (hash !== STOCK_SHA256) {
    throw new Error(`transcript.ts source drift (${hash}); expected exact stock or locally patched 0.9.1. Recheck the patch manually.`);
  }
  const patched = source.replace(
    "/** pi's canonical built-in section order; custom sections follow their replay position.",
    "/** pi's canonical built-in section order; custom sections follow all known built-ins.",
  ).replace(
    " * inherits its replayed predecessor's rank, so an already-canonical replay remains\n * unchanged and custom sections retain their position.",
    " * sorts after every known built-in. Equal ranks keep unknown names in replay order\n * because Array.sort is stable.",
  ).replace(
    "\tlet predecessorRank = -1;\n", "",
  ).replace(
    "\t\tconst rank = ranks.get(name) ?? predecessorRank;\n\t\tpredecessorRank = rank;",
    "\t\tconst rank = ranks.get(name) ?? Number.MAX_SAFE_INTEGER;",
  );
  if (sha256(patched) !== PATCHED_SHA256) throw new Error("Patch output hash mismatch; no file was written.");
  return patched;
}

function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function readIsolatedFile(root, rel) {
  const path = join(root, rel);
  const stat = lstatSync(path);
  // Shared files or linked parents could change a live install through the candidate.
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) {
    throw new Error(`Expected an unlinked regular file: ${rel}`);
  }
  return readFileSync(path, "utf8");
}

export function reapplyTranscriptOrderPatch(target) {
  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("Supply an explicit isolated pi-claude-bridge@0.9.1 package directory under TMPDIR.");
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
  const manifest = JSON.parse(readIsolatedFile(root, "package.json"));
  if (manifest.name !== "pi-claude-bridge" || manifest.version !== "0.9.1") {
    throw new Error("Expected pi-claude-bridge 0.9.1. Recheck the patch before applying it to another package/version.");
  }
  const source = readIsolatedFile(root, "src/transcript.ts");
  const patched = patchTranscriptSource(source);
  if (patched === source) return "already patched";
  writeFileSync(join(root, "src/transcript.ts"), patched);
  return "patched";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: node reapply-transcript-order-patch-0.9.1.mjs $TMPDIR/isolated-package");
  console.log(reapplyTranscriptOrderPatch(process.argv[2]));
  console.log(`SHA-256: ${PATCHED_SHA256}`);
}
