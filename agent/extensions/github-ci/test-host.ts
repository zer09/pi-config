import { realpathSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const root = process.env.PI_GITHUB_CI_HOST_NODE_MODULES ?? join(
  process.env.BUN_INSTALL ?? join(homedir(), ".bun"),
  "install",
  "global",
  "node_modules",
);
// Require the selected package to exist before Node can search parent directories.
const host = realpathSync(join(root, "typebox", "package.json"));
const typeboxPath = createRequire(host).resolve("typebox");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "typebox") return nextResolve(typeboxPath, context);
    return nextResolve(specifier, context);
  },
});
