import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const modules = process.env.PI_TEST_NODE_MODULES, target = process.env.PI_TEST_HARNESS_ROOT;
for (const path of [modules, target]) assert.ok(path && isAbsolute(path), "Explicit isolated targets required");
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(JSON.parse(readFileSync(join(target, "package.json"))).version, "0.13.0");
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
const { createToolRegistry, ALL_TOOLS } = await jiti.import(join(target, "src/registry.ts"));
const { defineBrowserTool } = await jiti.import(join(target, "src/util/tool.ts"));
const a = { id: "fake-client-a" }, b = { id: "fake-client-b" };
const sink = () => { const tools = []; return { tools, registerTool: definition => tools.push(definition) }; };
const names = registrar => registrar.tools.map(tool => tool.name);
const makeTool = name => defineBrowserTool({ name, label: name, description: name, promptSnippet: name, promptGuidelines: [], parameters: { type: "object", properties: {} }, concurrency: "parallel", ensureAlive: false, handler: async (_args, ctx) => ({ success: true, data: { text: ctx.client.id } }) });
const execute = async tool => (await tool.execute("synthetic-call", {}, undefined, undefined, {})).content[0].text;

test("A, replacement B and repeated notifications each retain all 42 ordered built-ins", () => {
  const registry = createToolRegistry(), first = sink(), replacement = sink();
  assert.equal(ALL_TOOLS.length, 42);
  const expected = ALL_TOOLS.map(tool => tool.name);
  assert.ok(expected.includes("browser_set_headers") && expected.includes("browser_clear_headers"));
  registry.register(first, a);
  const closures = [...first.tools];
  registry.register(first, b);
  registry.register(replacement, b);
  const replacementClosures = [...replacement.tools];
  registry.register(replacement, a);
  registry.register(first, a);
  assert.deepEqual(names(first), expected);
  assert.deepEqual(names(replacement), expected);
  assert.equal(new Set(expected).size, 42);
  closures.forEach((tool, i) => assert.equal(first.tools[i], tool));
  replacementClosures.forEach((tool, i) => { assert.equal(replacement.tools[i], tool); assert.notEqual(first.tools[i], tool); });
});

test("shared names, duplicate rejection and returned contents cannot corrupt ordered contributions", () => {
  const registry = createToolRegistry();
  const expected = ALL_TOOLS.map(tool => tool.name);
  assert.equal(registry.add(ALL_TOOLS[0]).success, false);
  assert.equal(registry.addAll([makeTool("atomic"), ALL_TOOLS[0]]).success, false);
  assert.equal(registry.addAll([makeTool("twice"), makeTool("twice")]).success, false);
  assert.deepEqual(registry.tools().map(tool => tool.name), expected);
  assert.throws(() => createToolRegistry([ALL_TOOLS[0], ALL_TOOLS[0]]), /already registered/);
  const copy = registry.tools(); copy.pop();
  assert.equal(registry.tools().length, 42);
  assert.equal(registry.addAll([makeTool("one"), makeTool("two")]).success, true);
  const first = sink(), second = sink(); registry.register(first, a); registry.register(second, b);
  assert.deepEqual(names(first), [...expected, "one", "two"]);
  assert.deepEqual(names(second), names(first));
});

for (const direction of ["A-first", "B-first"]) test(`late contributions reach every registrar, ${direction}`, async () => {
  const registry = createToolRegistry([makeTool("early")]), first = sink(), replacement = sink();
  registry.register(first, a);
  registry.register(replacement, b);
  assert.equal(registry.add(makeTool("late")).success, true);
  const order = direction === "A-first" ? [[first, a], [replacement, b]] : [[replacement, b], [first, a]];
  for (const [registrar, client] of order) registry.register(registrar, client);
  for (const [registrar, client] of [[first, a], [replacement, b]]) {
    assert.deepEqual(names(registrar), ["early", "late"]);
    for (const tool of registrar.tools) assert.equal(await execute(tool), client.id);
  }
  registry.register(first, b); registry.register(replacement, a);
  assert.equal(first.tools.length, 2); assert.equal(replacement.tools.length, 2);
});

test("a cold replacement API receives built-ins and contributions already delivered to A", async () => {
  const registry = createToolRegistry(), first = sink(), replacement = sink();
  registry.register(first, a);
  registry.add(makeTool("late"));
  registry.register(first, a);
  registry.register(replacement, b);
  assert.equal(first.tools.length, 43); assert.equal(replacement.tools.length, 43);
  assert.deepEqual(names(first), names(replacement));
  assert.equal(await execute(first.tools.at(-1)), a.id);
  assert.equal(await execute(replacement.tools.at(-1)), b.id);
});

test("real defineBrowserTool closures bind each new tool to its call's client, not a later argument", async () => {
  const registry = createToolRegistry([makeTool("binding")]), first = sink(), replacement = sink();
  registry.register(first, a); registry.register(first, b); registry.register(replacement, b);
  assert.equal(await execute(first.tools[0]), a.id);
  assert.equal(await execute(replacement.tools[0]), b.id);
  registry.add(makeTool("new_binding")); registry.register(first, b); registry.register(replacement, a);
  assert.equal(await execute(first.tools[0]), a.id);
  assert.equal(await execute(first.tools[1]), b.id);
  assert.equal(await execute(replacement.tools[0]), b.id);
  assert.equal(await execute(replacement.tools[1]), a.id);
});

test("throwing registration retries only unfinished names independently for each API", () => {
  let attempts = 0;
  const retry = { ...makeTool("retry"), register(pi) { if (++attempts === 1) throw Error("Synthetic registration failure"); pi.registerTool({ name: "retry" }); } };
  const registry = createToolRegistry([makeTool("before"), retry, makeTool("after")]);
  const first = sink(), replacement = sink();
  assert.throws(() => registry.register(first, a), /Synthetic registration failure/);
  assert.deepEqual(names(first), ["before"]);
  registry.register(replacement, b);
  assert.deepEqual(names(replacement), ["before", "retry", "after"]);
  registry.register(first, a); registry.register(first, b); registry.register(replacement, a);
  assert.deepEqual(names(first), ["before", "retry", "after"]);
  assert.equal(attempts, 3);
});
