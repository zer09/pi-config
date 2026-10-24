import assert from "node:assert/strict";
import fs from "node:fs";
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const run = process.env.PI_A_RUN, modules = process.env.PI_TEST_NODE_MODULES;
const integration = process.env.PI_TEST_INTEGRATION_ROOT, evidence = process.env.PI_TEST_VERIFICATION_DIR;
for (const path of [run, modules, integration, evidence]) assert.ok(path && isAbsolute(path));
assert.equal(process.env.PI_OFFLINE, "1");
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { fsCache: false });
const policyDir = join(integration, "agent/extensions/delegated-pi-loop");
const resources = await jiti.import(join(policyDir, "resources.ts"));
const policy = resources.readResourcesFile(join(policyDir, "resources.json"));
const runtimeArgs = resources.buildRuntimeResourceArgs(policy, []), catalogArgs = resources.buildCatalogResourceArgs(policy);
const entries = args => args.filter((_value, i) => args[i - 1] === "-e");
assert.deepEqual(entries(runtimeArgs).map(path => path.slice(join(integration, "agent/extensions/").length)), ["delegated-pi-loop/index.ts", "openai-codex-aliases/index.ts", "web-search/index.ts", "fastlane/index.ts", "claude-bridge-provider/delegate-entry.ts"]);
assert.deepEqual(entries(catalogArgs), [entries(runtimeArgs)[1], entries(runtimeArgs)[4]]);
for (const args of [runtimeArgs, catalogArgs]) for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"]) assert.ok(args.includes(flag));
const cli = join(modules, "@earendil-works/pi-coding-agent/dist/cli.js");
function execute(name, args) {
  const root = fs.mkdtempSync(join(evidence, name + "-"));
  const report = join(root, "inventory.jsonl");
  const result = spawnSync(process.execPath, ["--import", join(run, "guard.mjs"), cli, ...args], {
    cwd: join(integration, "cwd"), env: { ...process.env, PI_CODING_AGENT_DIR: join(integration, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_DELEGATED_CHILD: "1", PI_DELEGATE_PARENT_PID: String(process.pid), PI_TEST_PROBE_REPORT: report },
    encoding: "utf8", timeout: 45000, maxBuffer: 4 * 1024 * 1024,
  });
  fs.writeFileSync(join(root, "command.json"), JSON.stringify({ command: process.execPath, args, exit: result.status, signal: result.signal }, null, 2), { flag: "wx" });
  fs.writeFileSync(join(root, "stdout.log"), result.stdout ?? "", { flag: "wx" });
  fs.writeFileSync(join(root, "stderr.log"), result.stderr ?? "", { flag: "wx" });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
  return { root, report, stdout: result.stdout };
}
test("actual runtime child has exactly five ordered entries, seven tools, no browser and zero inference", { timeout: 60000 }, () => {
  const result = execute("runtime-child", [...runtimeArgs, "--mode", "json", "--model", "e-offline/fixture", "--thinking", "off", "-e", join(run, "e/probe.ts"), "/e-probe"]);
  const rows = fs.readFileSync(result.report, "utf8").trim().split("\n").map(JSON.parse);
  const row = rows.find(value => value.phase === "probe"); assert.ok(row);
  const expected = ["read", "bash", "edit", "write", "web_search", "web_code_search", "fetch_contents"].sort();
  // Pi registers all eight built-ins, but only its four coding tools are active by default.
  assert.deepEqual(row.tools, [...expected, "find", "grep", "ls", "powershell"].sort());
  assert.deepEqual(row.active, expected); assert.equal(row.calls, 0);
  assert.ok(!row.tools.some(name => /^(?:browser_|ctx_|codegraph_)/.test(name)));
  const commands = row.commands.filter(value => value.source === "extension" && !["e-probe", "e-reload", "e-tree"].includes(value.name)).map(value => value.name).sort();
  assert.deepEqual(commands, ["codex-usage", "fastlane"]);
});
test("actual catalog child loads only two provider entries and has no model tools or inference", { timeout: 60000 }, () => {
  const result = execute("catalog-child", [...catalogArgs, "--list-models"]);
  assert.ok(result.stdout.includes("claude-bridge"));
  assert.equal(fs.existsSync(result.report), false);
});
fs.writeFileSync(join(fs.mkdtempSync(join(evidence, "child-profiles-")), "profiles.json"), JSON.stringify({ runtimeArgs, catalogArgs }, null, 2), { flag: "wx" });
