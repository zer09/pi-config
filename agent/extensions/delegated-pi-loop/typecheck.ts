#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type ts from "typescript";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const HOST_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  "typebox",
  "typescript",
] as const;

export const HOST_DEPENDENCY_ERROR =
  "typecheck: host declarations or compiler unavailable; set PI_DELEGATED_TYPECHECK_NODE_MODULES to an absolute Bun global node_modules directory containing Pi, typebox, TypeScript, and @types/node.";

export function hostNodeModules(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env.PI_DELEGATED_TYPECHECK_NODE_MODULES
    ?? path.join(env.BUN_INSTALL ?? path.join(home, ".bun"), "install", "global", "node_modules");
}

function declarationPath(root: string, name: string): string {
  const directory = path.join(root, name);
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  const entry: unknown = manifest.types ?? manifest.typings;
  if (typeof entry !== "string" || entry.length === 0) throw new Error(HOST_DEPENDENCY_ERROR);
  const declaration = path.resolve(directory, entry);
  if (!statSync(declaration).isFile()) throw new Error(HOST_DEPENDENCY_ERROR);
  return declaration;
}

export function loadTypecheckHost(root: string = hostNodeModules()) {
  try {
    // Never fall back to local packages: the check must use the installed host.
    if (!path.isAbsolute(root)) throw new Error(HOST_DEPENDENCY_ERROR);
    const paths: Record<string, string[]> = {};
    for (const name of HOST_PACKAGES) paths[name] = [declarationPath(root, name)];
    declarationPath(root, "@types/node");
    const compiler: typeof ts = createRequire(import.meta.url)(path.join(root, "typescript"));
    return { compiler, paths, typeRoots: [path.join(root, "@types")] };
  } catch {
    // Do not print raw filesystem errors, environment values, or stack traces.
    throw new Error(HOST_DEPENDENCY_ERROR);
  }
}

export function createTypecheckConfig(host: Pick<ReturnType<typeof loadTypecheckHost>, "paths" | "typeRoots">) {
  return {
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
      typeRoots: host.typeRoots,
      paths: host.paths,
    },
    include: ["**/*.ts"],
    exclude: ["**/node_modules/**"],
  };
}

function main(): number {
  let host: ReturnType<typeof loadTypecheckHost>;
  try {
    host = loadTypecheckHost();
  } catch {
    console.error(HOST_DEPENDENCY_ERROR);
    return 1;
  }
  try {
    const { compiler } = host;
    // The config lives only in memory, so concurrent checks leave no files behind.
    const config = compiler.parseJsonConfigFileContent(createTypecheckConfig(host), compiler.sys, EXTENSION_DIR);
    let diagnostics = config.errors;
    if (diagnostics.length === 0) {
      const program = compiler.createProgram(config.fileNames, config.options);
      diagnostics = [...compiler.getPreEmitDiagnostics(program)];
    }
    if (diagnostics.length > 0) {
      console.error(compiler.formatDiagnostics(compiler.sortAndDeduplicateDiagnostics(diagnostics), {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => EXTENSION_DIR,
        getNewLine: () => "\n",
      }).trimEnd());
      return 1;
    }
    console.log(`typecheck: ${config.fileNames.length} TypeScript files, 0 diagnostics`);
    return 0;
  } catch {
    console.error("typecheck: compiler could not complete the check.");
    return 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
