#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync, writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.9.mjs";
import { reapplyNullableProviderHeadersPatch } from "./reapply-nullable-provider-headers-patch-0.5.9.mjs";
import { reapplyContextEditCompactionPatch } from "./reapply-context-edit-compaction-patch-0.5.9.mjs";

const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const liveTarget = join(repository, "agent/npm/node_modules/pi-blackhole");
// Enable the source entrypoint last. No dependencies, bundle, or npm lock is a write target.
const patchFiles = [
  "src/core/unified-config.ts",
  "src/om/model-budget.ts",
  "src/commands/memory.ts",
  "src/om/runtime.ts",
  "src/om/provider-stream.ts",
  "src/om/agents/observer/agent.ts",
  "src/om/agents/reflector/agent.ts",
  "src/om/agents/dropper/agent.ts",
  "src/hooks/before-compact.ts",
  "package.json",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (stat) => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.mtimeNs, stat.ctimeNs].join(":");

function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function regularFile(path) {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || realpathSync(path) !== path) {
    throw new Error(`Expected an unlinked regular file: ${path}`);
  }
  return { bytes: readFileSync(path), identity: identity(stat) };
}

function assertPackageVersion(bytes) {
  const pkg = JSON.parse(bytes);
  if (pkg.name !== "pi-blackhole" || pkg.version !== "0.5.9") {
    throw new Error("Expected exactly pi-blackhole@0.5.9; no target files changed.");
  }
}

function readPinnedArchive(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("Supply an explicit absolute --tarball path; no archive is fetched.");
  }
  const archive = regularFile(path).bytes;
  if (`sha512-${createHash("sha512").update(archive).digest("base64")}` !== registryIntegrity) {
    throw new Error("Archive does not match the pinned pi-blackhole@0.5.9 registry SRI.");
  }
  // Only this pinned archive format is supported, not arbitrary tar input.
  const tar = gunzipSync(archive);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    const rel = name.slice("package/".length);
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    if (
      header.toString("utf8", 156, 157) !== "0" || header[345] !== 0 ||
      !name.startsWith("package/") || rel.includes("\\") ||
      rel.split("/").some((part) => part === "" || part === "." || part === "..") ||
      files.has(rel) || !Number.isInteger(size) || size < 0 || offset + 512 + size > tar.length
    ) throw new Error(`Unsupported pinned archive entry: ${name}`);
    files.set(rel, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (files.size !== 132) throw new Error("Expected 132 files in the pinned archive.");
  assertPackageVersion(files.get("package.json"));
  return files;
}

function dependencySnapshot(root) {
  if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) {
    throw new Error("Expected a canonical node_modules directory.");
  }
  const entries = [];
  function visit(path, rel) {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) {
      // npm .bin links are safe only when they stay inside this dependency tree.
      if (!rel || !isWithin(root, realpathSync(path))) {
        throw new Error(`Dependency link escapes node_modules: ${rel}`);
      }
      entries.push([rel, identity(stat), "link", readlinkSync(path)]);
    } else if (stat.isDirectory()) {
      entries.push([rel, identity(stat), "directory"]);
      for (const name of readdirSync(path).sort()) visit(join(path, name), join(rel, name));
    } else {
      const file = regularFile(path);
      entries.push([rel, file.identity, hash(file.bytes)]);
    }
  }
  visit(root, "");
  return JSON.stringify(entries);
}

function readPackage(root, stock) {
  if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) {
    throw new Error("Expected a canonical, non-symlink package directory.");
  }
  const directories = new Set(["."]);
  for (const rel of stock.keys()) {
    for (let dir = dirname(rel); dir !== "."; dir = dirname(dir)) directories.add(dir);
  }
  const files = new Map();
  const entries = [];
  let dependencies = "absent";
  function visit(path, rel) {
    if (rel === "node_modules") {
      dependencies = dependencySnapshot(path);
      return;
    }
    const stat = lstatSync(path, { bigint: true });
    if (stat.isDirectory() && realpathSync(path) === path) {
      if (!directories.has(rel)) throw new Error(`Unexpected package directory: ${rel}`);
      entries.push([rel, identity(stat), "directory"]);
      for (const name of readdirSync(path).sort()) visit(join(path, name), join(rel, name));
    } else {
      if (!stock.has(rel)) throw new Error(`Unexpected package file: ${rel}`);
      const file = regularFile(path);
      files.set(rel, file);
      entries.push([rel, file.identity, hash(file.bytes)]);
    }
  }
  visit(root, ".");
  if (files.size !== stock.size) throw new Error("Incomplete package-owned file inventory.");
  return { files, dependencies, stamp: JSON.stringify([entries, dependencies]) };
}

function expectedPatchedPackage(stock) {
  const temp = realpathSync(tmpdir());
  if (temp === repository || isWithin(repository, temp) || temp.split(sep).includes("node_modules")) {
    throw new Error("Expected an isolated OS temp directory outside the repository and node_modules.");
  }
  const scratch = mkdtempSync(join(temp, "pi-blackhole-0.5.9-reapply-"));
  try {
    const root = join(scratch, "package");
    for (const [rel, bytes] of stock) {
      const path = join(root, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes, { flag: "wx" });
    }
    // Reuse the accepted candidates unchanged and in their required order.
    reapplyCompactAfterPercentPatch(root);
    reapplyNullableProviderHeadersPatch(root);
    reapplyContextEditCompactionPatch(root);
    const patched = new Map([...readPackage(root, stock).files].map(([rel, file]) => [rel, file.bytes]));
    const changed = [...stock.keys()].filter((rel) => !stock.get(rel).equals(patched.get(rel))).sort();
    if (JSON.stringify(changed) !== JSON.stringify([...patchFiles].sort())) {
      throw new Error("Candidate changes exceed or omit the accepted ten-file patch set.");
    }
    const manifest = stock.get("package.json").toString().replace(
      '"extensions": [\n      "./dist/index.js"',
      '"extensions": [\n      "./index.ts"',
    );
    if (!patched.get("package.json").equals(Buffer.from(manifest))) {
      throw new Error("Candidate manifest changed more than pi.extensions.");
    }
    return patched;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function matches(files, expected) {
  return [...expected].every(([rel, bytes]) => files.get(rel).bytes.equals(bytes));
}

function reapplyPatches(root, tarballPath) {
  if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) {
    throw new Error("Expected a canonical, non-symlink package directory.");
  }
  assertPackageVersion(regularFile(join(root, "package.json")).bytes);
  const stock = readPinnedArchive(tarballPath);
  const before = readPackage(root, stock);
  const patched = expectedPatchedPackage(stock);
  if (matches(before.files, patched)) return "already patched: pi-blackhole@0.5.9";
  if (!matches(before.files, stock)) {
    throw new Error("Mixed, partial, or drifted package; no target files changed.");
  }

  // Recheck after reference construction. Open without truncation and validate
  // every descriptor before writing, so a bad last file cannot cause partial edits.
  if (readPackage(root, stock).stamp !== before.stamp) {
    throw new Error("Target changed during preflight; no target files changed.");
  }
  const opened = [];
  try {
    for (const rel of patchFiles) {
      const path = join(root, rel);
      const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
      opened.push([rel, fd]);
      const stat = fstatSync(fd, { bigint: true });
      if (
        !stat.isFile() || stat.nlink !== 1n || realpathSync(path) !== path ||
        identity(stat) !== before.files.get(rel).identity || !readFileSync(fd).equals(stock.get(rel))
      ) throw new Error(`Target changed before write: ${rel}; no target files changed.`);
    }
    for (const [rel, fd] of opened) {
      const bytes = patched.get(rel);
      let offset = 0;
      while (offset < bytes.length) {
        const count = writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (count === 0) throw new Error(`Incomplete write: ${rel}`);
        offset += count;
      }
      ftruncateSync(fd, bytes.length);
    }
  } finally {
    for (const [, fd] of opened) closeSync(fd);
  }
  const after = readPackage(root, stock);
  if (!matches(after.files, patched) || after.dependencies !== before.dependencies) {
    throw new Error("Post-write verification failed; inspect the target before continuing.");
  }
  return "patched: pi-blackhole@0.5.9 (9 source files and pi.extensions)";
}

// Tests can patch disposable roots, never a caller-selected persistent/live path.
export function reapplyIsolatedPatches(target, tarballPath) {
  if (typeof target !== "string" || !isAbsolute(target)) {
    throw new Error("Supply an explicit absolute isolated package directory.");
  }
  const root = resolve(target);
  if (!isWithin(realpathSync(tmpdir()), root) || root === repository || isWithin(repository, root)) {
    throw new Error("Refusing a non-isolated target outside the OS temp directory.");
  }
  return reapplyPatches(root, tarballPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== "--live" || args[1] !== "--tarball" || !isAbsolute(args[2])) {
    throw new Error("Usage: node reapply-live-0.5.9-patches.mjs --live --tarball /absolute/pi-blackhole-0.5.9.tgz");
  }
  console.log(`${reapplyPatches(liveTarget, args[2])}: ${liveTarget}`);
}
