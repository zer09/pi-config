import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";

const modules = process.env.PI_TEST_NODE_MODULES;
const target = process.env.PI_TEST_HARNESS_ROOT;
for (const path of [modules, target]) assert.ok(path && isAbsolute(path), "Explicit isolated targets required");
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(JSON.parse(readFileSync(join(target, "package.json"))).version, "0.13.0");
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
const fixture = mkdtempSync(join(tmpdir(), "harness-header-fake-"));
const spawnStub = join(fixture, "spawn.ts");
// Replace only the readiness dependency so registered execute() never probes a socket.
writeFileSync(spawnStub, "export async function daemonSocketMayExist() { globalThis.__headerFakeReadiness++; return true; }\n");
globalThis.__headerFakeReadiness = 0;
const jiti = createJiti(import.meta.url, { fsCache: false, alias: { "../daemon/spawn": spawnStub, typebox: join(modules, "typebox/build/index.mjs"), "typebox/compile": join(modules, "typebox/build/compile/index.mjs") } });
const { setHeadersTool, clearHeadersTool } = await jiti.import(join(target, "src/domains/headers.ts"));
function client(current = { targetId: "owned" }, owns = true, failure) {
  const calls = [];
  return {
    calls, current: () => current, owns: () => owns,
    ensureAlive: async () => ({ success: true, data: undefined }),
    mutationMutex: () => ({ acquire: async () => () => {} }),
    session: () => ({ call: async (...args) => { calls.push(args); return failure ?? { success: true, data: {} }; } }),
  };
}
function registered(tool, fake) {
  let definition;
  tool.register({ registerTool: value => { definition = value; } }, fake);
  return definition;
}
const execute = (tool, fake, args = {}) => registered(tool, fake).execute("synthetic", args, undefined, undefined, {});
test("stock header tools enforce owned-tab and no-tab boundaries with model-visible errors", async () => {
  for (const tool of [setHeadersTool, clearHeadersTool]) {
    for (const [current, owns, error] of [[null, true, /No tab attached/], [{ targetId: "foreign" }, false, /not owned/]]) {
      const fake = client(current, owns);
      await assert.rejects(execute(tool, fake, { headers: { "X-Test": "synthetic-value" } }), error);
      assert.deepEqual(fake.calls, []);
    }
  }
  assert.equal(globalThis.__headerFakeReadiness, 4, "Only fake readiness ran");
});
test("stock successful set/clear hides values in all returned content and details", async () => {
  const fake = client(), headers = { "X-Route": "SYNTHETIC_HIDDEN_VALUE", "X-Environment": "SYNTHETIC_OTHER_VALUE" };
  const result = await execute(setHeadersTool, fake, { headers });
  assert.deepEqual(fake.calls, [["Network.setExtraHTTPHeaders", { headers }]]);
  assert.deepEqual(result.details, { targetId: "owned", headerNames: ["X-Environment", "X-Route"], count: 2 });
  for (const value of Object.values(headers)) assert.ok(!JSON.stringify(result).includes(value));
  const cleared = await execute(clearHeadersTool, fake);
  assert.deepEqual(fake.calls[1], ["Network.setExtraHTTPHeaders", { headers: {} }]);
  for (const value of Object.values(headers)) assert.ok(!JSON.stringify(cleared).includes(value));
});
test("invalid names and fake transport failures reject instead of returning apparent success", async () => {
  const fake = client();
  await assert.rejects(execute(setHeadersTool, fake, { headers: { "invalid name": "SYNTHETIC_HIDDEN_VALUE" } }), /failed \(invalid_args\)/);
  assert.deepEqual(fake.calls, []);
  for (const tool of [setHeadersTool, clearHeadersTool]) {
    for (const kind of ["timeout", "protocol"]) {
      const failed = client(undefined, true, { success: false, error: { kind, message: "Synthetic transport refusal" } });
      await assert.rejects(execute(tool, failed, { headers: { "X-Test": "SYNTHETIC_HIDDEN_VALUE" } }), new RegExp(`failed \\(${kind === "timeout" ? "timeout" : "cdp_error"}\\): Synthetic transport refusal`));
    }
  }
});
test("stock model guidance explains persistence, hidden values and cross-origin clearing", () => {
  assert.match(setHeadersTool.description, /persist.*until cleared or the tab closes/);
  assert.match(setHeadersTool.promptGuidelines.join("\n"), /browser_new_tab without a URL/);
  assert.match(setHeadersTool.promptGuidelines.join("\n"), /browser_clear_headers before switching tabs or navigating this tab to another origin/);
  assert.match(setHeadersTool.promptGuidelines.join("\n"), /values are never echoed/);
  assert.match(clearHeadersTool.promptGuidelines.join("\n"), /before switching tabs.*another origin/);
});
