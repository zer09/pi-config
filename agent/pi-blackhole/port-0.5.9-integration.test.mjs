import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.9.mjs";
import { reapplyNullableProviderHeadersPatch } from "./reapply-nullable-provider-headers-patch-0.5.9.mjs";
import { reapplyContextEditCompactionPatch } from "./reapply-context-edit-compaction-patch-0.5.9.mjs";

// Acquisition is separate: npm pack with --ignore-scripts, empty user/global npm
// configs, isolated HOME/cache/environment, and no dependency installation.
// PI_BLACKHOLE_0_5_9_TARBALL=/tmp/.../pi-blackhole-0.5.9.tgz node --test <this-file>
// This gate compiles source but never executes Blackhole, providers, or sessions.
// Package discovery and settled lifecycle verification belong to later increments.
const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../..");
const installed = join(repository, "agent/npm/node_modules/pi-blackhole");
const installedDependencies = join(repository, "agent/npm/node_modules");
const piDependencyNames = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
const settingsPath = join(repository, "agent/settings.json");
const configPath = join(here, "pi-blackhole-config.json");
const percentFiles = [
  "package.json",
  "src/core/unified-config.ts",
  "src/om/model-budget.ts",
  "src/commands/memory.ts",
];
const nullableFiles = [
  "src/om/runtime.ts",
  "src/om/provider-stream.ts",
  "src/om/agents/observer/agent.ts",
  "src/om/agents/reflector/agent.ts",
  "src/om/agents/dropper/agent.ts",
];
const contextFiles = ["src/hooks/before-compact.ts"];
const intendedFiles = [...percentFiles, ...nullableFiles, ...contextFiles].sort();
const oldHelperNames = [
  "reapply-compact-after-percent-patch.mjs",
  "reapply-nullable-provider-headers-patch.mjs",
  "reapply-provider-stream-bridge-patch.mjs",
  "reapply-local-patches.test.mjs",
];
const acceptedCandidateNames = [
  "reapply-compact-after-percent-patch-0.5.9.mjs",
  "reapply-compact-after-percent-patch-0.5.9.test.mjs",
  "reapply-nullable-provider-headers-patch-0.5.9.mjs",
  "reapply-nullable-provider-headers-patch-0.5.9.test.mjs",
  "reapply-context-edit-compaction-patch-0.5.9.mjs",
  "reapply-context-edit-compaction-patch-0.5.9.test.mjs",
];
const read = (root, rel) => readFileSync(join(root, rel), "utf8");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function snapshot(root, includeMtimes = false) {
  const files = {};
  function visit(path, rel) {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) {
      files[rel] = `link:${readlinkSync(path)}`;
    } else if (stat.isDirectory()) {
      files[rel] = "directory";
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${rel}/${name}`);
    } else {
      files[rel] = hash(readFileSync(path));
    }
    if (includeMtimes) files[rel] += `:${stat.mtimeNs}`;
  }
  visit(root, "");
  return files;
}

function changedEntries(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((rel) => before[rel] !== after[rel])
    .sort();
}

function protectedSnapshot() {
  const paths = [
    installed,
    settingsPath,
    configPath,
    ...oldHelperNames,
    ...acceptedCandidateNames,
    ...readdirSync(here)
      .filter((name) => /\.(mjs|md)$/.test(name) && name !== "port-0.5.9-integration.test.mjs")
      .filter((name) => !oldHelperNames.includes(name) && !acceptedCandidateNames.includes(name)),
  ].map((path) => path.includes(sep) ? path : join(here, path));
  return Object.fromEntries(paths.map((path) => [path, snapshot(path)]));
}

function unpackPinnedArchive(tarball) {
  assert.equal(
    `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    registryIntegrity,
    "archive must match the pinned pi-blackhole@0.5.9 registry SRI",
  );
  const tar = gunzipSync(tarball);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0", `archive entry must be a regular file: ${name}`);
    assert.equal(header[345], 0, "archive must not use a tar prefix");
    assert.ok(name.startsWith("package/"), `unexpected archive entry: ${name}`);
    const rel = name.slice("package/".length);
    assert.ok(rel && !rel.split("/").some((part) => part === ".." || part === ""));
    assert.ok(!files.has(rel), `duplicate archive entry: ${rel}`);
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    files.set(rel, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(files.size, 132, "unexpected file count in the pinned registry archive");
  return files;
}

function extractArchive(files, target) {
  mkdirSync(target, { recursive: true });
  for (const [rel, bytes] of files) {
    const path = join(target, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}

function loadModule(candidates, label) {
  const candidate = candidates.find((path) => typeof path === "string" && existsSync(path));
  assert.ok(candidate, `${label} is required locally; no dependency installation is allowed by this gate`);
  return createRequire(import.meta.url)(candidate);
}

function typeDiagnostics(root, dependencyRoot, typescript, packagedFiles) {
  const packagedProductionFiles = [...packagedFiles.keys()]
    .filter((rel) => rel === "index.ts" || (rel.startsWith("src/") && rel.endsWith(".ts")))
    .sort();
  assert.equal(packagedProductionFiles.length, 123, "expected 123 packaged production TypeScript files");
  // Tests and tsup/vitest configs need dev dependencies absent from this offline gate.
  const rootNames = typescript.sys.readDirectory(
    root,
    [".ts"],
    ["**/*.test.ts", "**/*.spec.ts", "**/test/**", "**/tests/**", "**/__tests__/**"],
    ["index.ts", "src/**/*.ts"],
  ).sort();
  assert.deepEqual(
    rootNames.map((path) => relative(root, path)),
    packagedProductionFiles,
    "current production sources must match all 123 packaged TypeScript files",
  );
  const options = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    forceConsistentCasingInFileNames: true,
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.Bundler,
    types: ["node"],
    typeRoots: [join(dependencyRoot, "@types")],
  };
  const program = typescript.createProgram(rootNames, options);
  const programRoots = program.getRootFileNames();
  assert.deepEqual(programRoots, rootNames, "every production source must be an explicit TypeScript root in sorted order");
  const patchedFiles = intendedFiles.filter((rel) => rel.endsWith(".ts"));
  assert.equal(patchedFiles.length, 9, "expected nine patched TypeScript files");
  for (const rel of patchedFiles) {
    assert.ok(programRoots.includes(join(root, rel)), `${rel}: patched TypeScript file must be a root`);
  }
  for (const path of rootNames) {
    assert.ok(program.getSourceFile(path), `${relative(root, path)}: production root must be loaded`);
  }
  return typescript.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    file: diagnostic.file ? relative(root, diagnostic.file.fileName) : undefined,
    message: typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
}

function formatDiagnostics(diagnostics) {
  return diagnostics.map(({ file, code, message }) =>
    `${file ?? "<global>"} TS${code}: ${message}`).join("\n");
}

function clonePackage(from, root) {
  const parent = mkdtempSync(join(root, "case-"));
  const target = join(parent, "package");
  cpSync(from, target, { recursive: true });
  return { parent, target };
}

function replaceUnique(target, rel, oldText, newText) {
  const path = join(target, rel);
  const source = readFileSync(path, "utf8");
  assert.equal(source.split(oldText).length, 2, `${rel}: expected one fixture anchor`);
  writeFileSync(path, source.replace(oldText, newText));
}

function applyAll(target) {
  return [
    reapplyCompactAfterPercentPatch(target),
    reapplyNullableProviderHeadersPatch(target),
    reapplyContextEditCompactionPatch(target),
  ];
}

test("integrated offline pi-blackhole@0.5.9 port gate", { timeout: 120_000 }, async (t) => {
  const protectedBefore = protectedSnapshot();
  assert.equal(JSON.parse(readFileSync(join(installed, "package.json"))).version, "0.5.8");
  const root = mkdtempSync(join(realpathSync(tmpdir()), "pi-blackhole-0.5.9-integration-"));
  t.after(() => {
    try {
      assert.deepEqual(
        protectedSnapshot(),
        protectedBefore,
        "live 0.5.8, settings, config, old helpers, and accepted candidate files changed",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const suppliedTarball = process.env.PI_BLACKHOLE_0_5_9_TARBALL;
  assert.ok(suppliedTarball, "set PI_BLACKHOLE_0_5_9_TARBALL from a separate isolated npm acquisition");
  const tarballPath = realpathSync(suppliedTarball);
  const temporaryRoots = [realpathSync("/tmp"), realpathSync(tmpdir())];
  assert.ok(temporaryRoots.some((temporaryRoot) => isWithin(temporaryRoot, tarballPath)),
    "the tarball must be a disposable /tmp acquisition");
  assert.ok(lstatSync(tarballPath).isFile(), "the tarball path must be a regular file");
  const files = unpackPinnedArchive(readFileSync(tarballPath));
  const stockPackage = JSON.parse(files.get("package.json").toString("utf8"));
  assert.deepEqual(
    { name: stockPackage.name, version: stockPackage.version },
    { name: "pi-blackhole", version: "0.5.9" },
  );
  assert.deepEqual(stockPackage.pi?.extensions, ["./dist/index.js"]);

  const stockRoot = join(root, "stock", "package");
  extractArchive(files, stockRoot);
  const stockBefore = snapshot(stockRoot);

  const percentageRoot = clonePackage(stockRoot, root).target;
  const percentageBefore = snapshot(percentageRoot);
  assert.match(reapplyCompactAfterPercentPatch(percentageRoot), /^patched:/);
  const percentageAfter = snapshot(percentageRoot);
  assert.deepEqual(
    changedEntries(percentageBefore, percentageAfter),
    percentFiles.map((rel) => `/${rel}`).sort(),
  );
  const percentagePackage = JSON.parse(read(percentageRoot, "package.json"));
  const expectedPackage = structuredClone(stockPackage);
  expectedPackage.pi.extensions = ["./index.ts"];
  assert.deepEqual(percentagePackage, expectedPackage, "the percentage helper may change only pi.extensions in package.json");

  const readyRoot = clonePackage(percentageRoot, root).target;
  const readyBefore = snapshot(readyRoot);
  assert.match(reapplyNullableProviderHeadersPatch(readyRoot), /^patched:/);
  const readyAfter = snapshot(readyRoot);
  assert.deepEqual(
    changedEntries(readyBefore, readyAfter),
    nullableFiles.map((rel) => `/${rel}`).sort(),
  );

  // Run all three accepted helpers in order on the same explicit temp root.
  const patchedRoot = clonePackage(stockRoot, root).target;
  const patchedStockBefore = snapshot(patchedRoot);
  assert.match(reapplyCompactAfterPercentPatch(patchedRoot), /^patched:/);
  const patchedAfterPercent = snapshot(patchedRoot);
  assert.deepEqual(
    changedEntries(patchedStockBefore, patchedAfterPercent),
    percentFiles.map((rel) => `/${rel}`).sort(),
  );
  assert.deepEqual(JSON.parse(read(patchedRoot, "package.json")), expectedPackage);
  const patchedBeforeNullable = snapshot(patchedRoot);
  assert.match(reapplyNullableProviderHeadersPatch(patchedRoot), /^patched:/);
  const patchedAfterNullable = snapshot(patchedRoot);
  assert.deepEqual(
    changedEntries(patchedBeforeNullable, patchedAfterNullable),
    nullableFiles.map((rel) => `/${rel}`).sort(),
  );
  const patchedBeforeContext = snapshot(patchedRoot);
  assert.match(reapplyContextEditCompactionPatch(patchedRoot), /^patched:/);
  const patchedAfter = snapshot(patchedRoot);
  assert.deepEqual(changedEntries(patchedBeforeContext, patchedAfter), ["/src/hooks/before-compact.ts"]);
  assert.deepEqual(
    changedEntries(stockBefore, patchedAfter),
    intendedFiles.map((rel) => `/${rel}`),
    "the full package snapshot must differ only at the accepted source files and package manifest",
  );
  assert.deepEqual(JSON.parse(read(patchedRoot, "package.json")), expectedPackage);

  const repeatBefore = snapshot(patchedRoot, true);
  assert.match(reapplyCompactAfterPercentPatch(patchedRoot), /^already patched:/);
  assert.match(reapplyNullableProviderHeadersPatch(patchedRoot), /^already patched:/);
  assert.match(reapplyContextEditCompactionPatch(patchedRoot), /^already patched:/);
  assert.deepEqual(snapshot(patchedRoot, true), repeatBefore, "a repeated three-helper pass must change no byte or mtime");

  const freshRoot = join(root, "fresh-reinstall", "package");
  extractArchive(files, freshRoot);
  assert.deepEqual(snapshot(freshRoot), stockBefore, "fresh extraction must reproduce stock package bytes");
  assert.deepEqual(applyAll(freshRoot).map((result) => /^patched:/.test(result)), [true, true, true]);
  assert.deepEqual(snapshot(freshRoot), snapshot(patchedRoot), "fresh stock reinstall must produce the same patched snapshot");

  function rejectsWithoutWrites(from, mutate, apply, expected = /Mixed|Drifted|drifted|Expected|ENOENT/) {
    const { parent, target } = clonePackage(from, root);
    try {
      mutate(target);
      const before = snapshot(target, true);
      assert.throws(() => apply(target), expected);
      assert.deepEqual(snapshot(target, true), before, "rejection must happen before every package write");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }

  for (const [from, apply] of [
    [stockRoot, reapplyCompactAfterPercentPatch],
    [percentageRoot, reapplyNullableProviderHeadersPatch],
    [readyRoot, reapplyContextEditCompactionPatch],
  ]) {
    for (const change of [
      { name: "other" },
      { version: "0.5.8" },
      { version: "0.5.10" },
      { version: "0.5.9-beta" },
    ]) {
      rejectsWithoutWrites(from, (target) => {
        const packageJson = JSON.parse(read(target, "package.json"));
        writeFileSync(join(target, "package.json"), JSON.stringify({ ...packageJson, ...change }));
      }, apply, /Expected exactly pi-blackhole@0\.5\.9/);
    }
  }

  rejectsWithoutWrites(
    stockRoot,
    (target) => replaceUnique(target, "src/core/unified-config.ts", "    \"compactAfterTokens\",\n", "    \"compactAfterTokens\",\n    \"compactAfterPercent\",\n"),
    reapplyCompactAfterPercentPatch,
  );
  rejectsWithoutWrites(
    percentageRoot,
    (target) => replaceUnique(target, "src/om/runtime.ts", "  headers?: Record<string, string>;", "  headers?: ProviderHeaders;"),
    reapplyNullableProviderHeadersPatch,
  );
  rejectsWithoutWrites(
    readyRoot,
    (target) => replaceUnique(
      target,
      "src/hooks/before-compact.ts",
      'import { convertToLlm } from "@earendil-works/pi-coding-agent";',
      'import { buildSessionProjection, convertToLlm } from "@earendil-works/pi-coding-agent";',
    ),
    reapplyContextEditCompactionPatch,
  );

  rejectsWithoutWrites(
    stockRoot,
    (target) => writeFileSync(join(target, "src/core/unified-config.ts"), read(percentageRoot, "src/core/unified-config.ts")),
    reapplyCompactAfterPercentPatch,
  );
  rejectsWithoutWrites(
    percentageRoot,
    (target) => writeFileSync(join(target, "src/om/runtime.ts"), read(readyRoot, "src/om/runtime.ts")),
    reapplyNullableProviderHeadersPatch,
  );
  rejectsWithoutWrites(
    readyRoot,
    (target) => writeFileSync(join(target, "src/om/runtime.ts"), read(stockRoot, "src/om/runtime.ts")),
    reapplyContextEditCompactionPatch,
  );

  rejectsWithoutWrites(
    stockRoot,
    (target) => writeFileSync(join(target, "src/om/compaction-trigger.ts"), `${read(target, "src/om/compaction-trigger.ts")}\n`),
    reapplyCompactAfterPercentPatch,
  );
  rejectsWithoutWrites(
    percentageRoot,
    (target) => writeFileSync(join(target, "src/om/runtime.ts"), `${read(target, "src/om/runtime.ts")}\n`),
    reapplyNullableProviderHeadersPatch,
  );
  rejectsWithoutWrites(
    readyRoot,
    (target) => writeFileSync(join(target, "src/hooks/before-compact.ts"), `${read(target, "src/hooks/before-compact.ts")}\n`),
    reapplyContextEditCompactionPatch,
  );

  for (const name of piDependencyNames) {
    const manifest = JSON.parse(readFileSync(join(installedDependencies, ...name.split("/"), "package.json")));
    assert.equal(manifest.version, "0.87.1", `${name} must be the installed Pi 0.87.1 dependency`);
  }
  const dependencyLink = join(root, "node_modules");
  symlinkSync(realpathSync(installedDependencies), dependencyLink, "dir");
  const typescript = loadModule([
    process.env.PI_BLACKHOLE_TYPESCRIPT,
    join(installedDependencies, "typescript/lib/typescript.js"),
    "/home/gc/.bun/install/global/node_modules/typescript/lib/typescript.js",
  ], "TypeScript");
  const stockDiagnostics = typeDiagnostics(stockRoot, dependencyLink, typescript, files);
  const patchedDiagnostics = typeDiagnostics(patchedRoot, dependencyLink, typescript, files);
  t.diagnostic(`TypeScript ${typescript.version}, strict production-source check (123 roots) with Pi 0.87.1: stock ${stockDiagnostics.length}, patched ${patchedDiagnostics.length} diagnostics (dependency declarations use skipLibCheck)`);
  if (stockDiagnostics.length > 0) {
    t.diagnostic(`stock 0.5.9 baseline diagnostics (not used to mask patched errors):\n${formatDiagnostics(stockDiagnostics)}`);
  }
  assert.deepEqual(
    patchedDiagnostics,
    [],
    `strict TypeScript diagnostics remained on patched production source; stock baseline was:\n${formatDiagnostics(stockDiagnostics)}`,
  );

  const esbuild = loadModule([
    process.env.PI_BLACKHOLE_ESBUILD,
    join(installedDependencies, "esbuild/lib/main.js"),
    "/home/gc/.bun/install/global/node_modules/esbuild/lib/main.js",
  ], "esbuild");
  const bundle = await esbuild.build({
    absWorkingDir: patchedRoot,
    entryPoints: ["index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    packages: "external",
    external: ["@earendil-works/*"],
    write: false,
    logLevel: "silent",
  });
  assert.equal(bundle.errors.length, 0);
  assert.ok(bundle.outputFiles?.[0]?.text.length > 0, "patched source bundle must be non-empty");
  assert.match(bundle.outputFiles[0].text, /@earendil-works\/pi-coding-agent/);
  t.diagnostic(`esbuild ${esbuild.version}: source bundle passed with Pi externals; bundle was not executed`);
  assert.deepEqual(snapshot(patchedRoot, true), repeatBefore, "typecheck and bundle must change no patched byte or mtime");
  assert.deepEqual(snapshot(stockRoot), stockBefore, "stock reference bytes must remain unchanged");
  assert.deepEqual(snapshot(percentageRoot), percentageAfter, "percentage reference bytes must remain unchanged");
  assert.deepEqual(snapshot(readyRoot), readyAfter, "nullable reference bytes must remain unchanged");
  t.diagnostic("132 package files; exactly nine source files and pi.extensions changed; 21 rejection cases; repeat and reinstall snapshots passed");
});
