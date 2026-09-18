import { createRequire, registerHooks } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const host = join(
  process.env.BUN_INSTALL ?? join(homedir(), ".bun"),
  "install",
  "global",
  "package.json",
);
const typeboxPath = createRequire(host).resolve("typebox");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "typebox") return nextResolve(typeboxPath, context);
    return nextResolve(specifier, context);
  },
});
