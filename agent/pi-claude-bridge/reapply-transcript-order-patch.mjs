#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STOCK_SHA256 = "0288ae8f565921ed4449bbfd250f4e32dd0104cc347d1f414aaa9c1902b50960";
export const PATCHED_SHA256 = "d4583d9739b3d9a65d0b458c6d50261a7fe8dc8a07ef5e7fce81b1a904b05427";
const sha256 = (source) => createHash("sha256").update(source).digest("hex");

export function patchTranscriptSource(source) {
  const hash = sha256(source);
  if (hash === PATCHED_SHA256) return source;
  if (hash !== STOCK_SHA256) {
    throw new Error(`transcript.ts source drift (${hash}); expected exact stock or locally patched 0.8.0. Recheck the patch manually.`);
  }
  const patched = source.replace(
    "\t// sections, future built-ins) keep their replayed position so an already-canonical\n\t// replay is untouched.",
    "\t// sections, future built-ins) follow all known built-ins and keep their relative\n\t// replay order, matching pi's canonical builder.",
  ).replace(
    " * inherits its replayed predecessor's rank, so replay order that is already canonical\n * (fresh pi sections, extension customs at the tail) sorts as a no-op.",
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

export function reapplyTranscriptOrderPatch(packageRoot) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (manifest.name !== "pi-claude-bridge" || manifest.version !== "0.8.0") {
    throw new Error("Expected pi-claude-bridge 0.8.0. Recheck the patch before applying it to another package/version.");
  }
  const target = join(packageRoot, "src", "transcript.ts");
  const source = readFileSync(target, "utf8");
  const patched = patchTranscriptSource(source);
  if (patched === source) return "already patched";
  writeFileSync(target, patched);
  return "patched";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error("Usage: node reapply-transcript-order-patch.mjs [package-root]");
  const here = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(process.argv[2] ?? join(here, "..", "npm", "node_modules", "pi-claude-bridge"));
  console.log(`${reapplyTranscriptOrderPatch(packageRoot)}: ${join(packageRoot, "src", "transcript.ts")}`);
  console.log(`SHA-256: ${PATCHED_SHA256}`);
  console.log("Restart Pi or run /reload while idle to activate the local patch.");
}
