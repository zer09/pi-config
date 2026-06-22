import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeLeanTool } from "../src/tools.js";

function text(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((item) => item.text).join("\n");
}

async function main() {
  const projectDir = await mkdtemp(join(tmpdir(), "pi-context-mode-lean-fuzz-"));
  const oldContextDir = process.env.CONTEXT_MODE_DIR;
  process.env.CONTEXT_MODE_DIR = join(projectDir, ".ctx-store");

  try {
    const buriedToken = "CTX_LEAN_BURIED_VALUE_7f41c9";
    const rows = Array.from({ length: 6_000 }, (_, i) => ({ i, value: i === 5_777 ? buriedToken : `noise-${i}` }));
    const jsonPath = join(projectDir, "large.json");
    await writeFile(jsonPath, JSON.stringify(rows), "utf8");

    const fileResult = await executeLeanTool(
      "ctx_execute_file",
      {
        path: jsonPath,
        language: "javascript",
        code: "const rows = JSON.parse(FILE_CONTENT); const hit = rows.find(r => String(r.value).startsWith('CTX_LEAN_BURIED_VALUE')); console.log(hit.value);",
        timeout: 30_000,
      },
      { cwd: projectDir },
    );
    if (!text(fileResult).includes(buriedToken)) throw new Error("ctx_execute_file did not find buried token");

    const batchToken = "CTX_LEAN_BATCH_FLAG_2c70aa";
    const batchResult = await executeLeanTool(
      "ctx_batch_execute",
      {
        commands: [
          {
            label: "noisy-node-output",
            command: `node -e "for (let i=0;i<5000;i++) console.log(i === 4333 ? '${batchToken}' : 'noise-'+i)"`,
          },
        ],
        queries: [batchToken],
        timeout: 30_000,
      },
      { cwd: projectDir },
    );
    if (!text(batchResult).includes(batchToken)) throw new Error("ctx_batch_execute did not return buried batch token");

    const searchResult = await executeLeanTool(
      "ctx_search",
      { queries: [batchToken], limit: 3 },
      { cwd: projectDir },
    );
    if (!text(searchResult).includes(batchToken)) throw new Error("ctx_search did not retrieve indexed batch token");

    console.log("fuzz ok");
  } finally {
    if (oldContextDir === undefined) delete process.env.CONTEXT_MODE_DIR;
    else process.env.CONTEXT_MODE_DIR = oldContextDir;
    await rm(projectDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
