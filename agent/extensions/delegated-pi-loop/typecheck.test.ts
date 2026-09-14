import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  HOST_DEPENDENCY_ERROR,
  createTypecheckConfig,
  hostNodeModules,
  loadTypecheckHost,
} from "./typecheck.ts";

const CLI = fileURLToPath(new URL("./typecheck.ts", import.meta.url));
const PACKAGES = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox", "typescript", "@types/node"];

function fixtureHost(root: string): void {
  for (const name of PACKAGES) {
    const directory = path.join(root, name);
    mkdirSync(directory, { recursive: true });
    const types = name === "typebox" ? "index.d.mts" : "index.d.ts";
    const manifest = name === "typescript" ? { typings: types, main: "index.cjs" } : { types };
    writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
    writeFileSync(path.join(directory, types), "export {};\n");
  }
  // The fixture compiler is never used to check source and loads no Pi runtime.
  writeFileSync(path.join(root, "typescript/index.cjs"), "module.exports = {};\n");
}

test("host discovery uses the explicit override, BUN_INSTALL, then the home default", () => {
  assert.equal(hostNodeModules({}, "/home/fixture"), "/home/fixture/.bun/install/global/node_modules");
  assert.equal(hostNodeModules({ BUN_INSTALL: "/custom/bun" }, "/home/fixture"), "/custom/bun/install/global/node_modules");
  assert.equal(hostNodeModules({ PI_DELEGATED_TYPECHECK_NODE_MODULES: "/host with spaces/node_modules", BUN_INSTALL: "/ignored" }), "/host with spaces/node_modules");
  for (const root of ["", "relative/node_modules"]) {
    assert.throws(() => loadTypecheckHost(root), { message: HOST_DEPENDENCY_ERROR });
  }
});

test("host declarations follow package metadata including typings and d.mts without writes", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "delegate-typecheck-host-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  fixtureHost(root);
  const before = readdirSync(root, { recursive: true });
  const host = loadTypecheckHost(root);
  assert.deepEqual(host.typeRoots, [path.join(root, "@types")]);
  for (const name of PACKAGES.filter((name) => name !== "@types/node")) {
    assert.deepEqual(host.paths[name], [path.join(root, name, name === "typebox" ? "index.d.mts" : "index.d.ts")]);
  }
  assert.deepEqual(readdirSync(root, { recursive: true }), before);
});

test("one fixed setup error covers each missing declaration and an unavailable compiler", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "delegate-typecheck-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  fixtureHost(root);
  for (const name of PACKAGES) {
    const declaration = path.join(root, name, name === "typebox" ? "index.d.mts" : "index.d.ts");
    rmSync(declaration);
    assert.throws(() => loadTypecheckHost(root), { message: HOST_DEPENDENCY_ERROR }, name);
    writeFileSync(declaration, "export {};\n");
  }
  rmSync(path.join(root, "typescript/index.cjs"));
  assert.throws(() => loadTypecheckHost(root), { message: HOST_DEPENDENCY_ERROR });
});

test("CLI setup failure is one bounded line with no fallback, paths, stack, or artifacts", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "delegate-typecheck-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env };
  // Assert only the driver's stderr, not output from ambient preload hooks.
  delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [CLI], {
    cwd: root,
    env: { ...env, PI_DELEGATED_TYPECHECK_NODE_MODULES: root },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trimEnd(), HOST_DEPENDENCY_ERROR);
  assert.ok(result.stderr.length <= HOST_DEPENDENCY_ERROR.length + 2);
  assert.deepEqual(readdirSync(root), []);
});

test("the in-memory config pins all governed options and includes every extension TypeScript file", () => {
  const paths = { fixture: ["/host/fixture/index.d.ts"] };
  const typeRoots = ["/host/@types"];
  assert.deepEqual(createTypecheckConfig({ paths, typeRoots }), {
    compilerOptions: {
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noEmit: true,
      skipLibCheck: true,
      target: "ES2023",
      module: "ESNext",
      moduleResolution: "Bundler",
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      erasableSyntaxOnly: true,
      noUncheckedSideEffectImports: true,
      types: ["node"],
      typeRoots,
      paths,
    },
    include: ["**/*.ts"],
    exclude: ["**/node_modules/**"],
  });
});

test("package scripts use the maintained driver without adding local dependencies or lock drift", () => {
  const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("./package-lock.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts.typecheck, "node typecheck.ts");
  assert.match(manifest.scripts.test, /\btypecheck\.test\.ts\b/);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(manifest.engines.node, ">=22.19.0");
  assert.deepEqual(lock.packages, { "": { name: manifest.name, version: manifest.version, engines: manifest.engines } });
});
