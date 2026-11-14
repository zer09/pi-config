import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(
  process.env.BUN_INSTALL ?? join(homedir(), ".bun"),
  "install",
  "global",
  "node_modules",
);
const hostRoot = resolve(process.env.PI_GITHUB_CI_HOST_NODE_MODULES ?? root);
const compilerRoot = resolve(process.env.PI_GITHUB_CI_COMPILER_NODE_MODULES ?? root);
const require = createRequire(import.meta.url);
const ts = require(join(compilerRoot, "typescript"));
const paths = {};
for (const name of ["@earendil-works/pi-coding-agent", "typebox"]) {
  const manifest = JSON.parse(
    readFileSync(join(hostRoot, name, "package.json"), "utf8"),
  );
  paths[name] = [realpathSync(join(hostRoot, name, manifest.types ?? manifest.typings))];
}
const directory = fileURLToPath(new URL(".", import.meta.url));
const config = ts.parseJsonConfigFileContent(
  {
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
      types: ["node"],
      typeRoots: [join(compilerRoot, "@types")],
      paths,
    },
    include: ["*.ts"],
  },
  ts.sys,
  directory,
);
const program = ts.createProgram(config.fileNames, config.options);
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => directory,
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
} else {
  console.log(
    `typecheck: ${config.fileNames.length} TypeScript files, 0 diagnostics`,
  );
}
