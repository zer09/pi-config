import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

// No live-package fallback: the runner must supply canonical, isolated targets.
export const modules = process.env.PI_TEST_NODE_MODULES;
export const target = process.env.PI_TEST_HARNESS_ROOT;
export const out = process.env.PI_TEST_OUTPUT_DIR;
export const published = process.env.PI_TEST_PUBLISHED_HARNESS;
for (const root of [modules, target, out, published, process.env.HOME, process.env.PI_CODING_AGENT_DIR, process.env.CLAUDE_CONFIG_DIR]) {
  assert.ok(root && isAbsolute(root), "Explicit isolated paths required");
  assert.equal(fs.realpathSync(root), root);
}
assert.equal(target, join(modules, "pi-browser-harness"));
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
assert.notEqual(fs.readlinkSync("/proc/self/ns/net"), process.env.PI_TEST_PARENT_NET_NS);
assert.equal(fs.existsSync("/home/gc/.pi"), false);
for (const root of [process.env.HOME, process.env.PI_CODING_AGENT_DIR, process.env.CLAUDE_CONFIG_DIR]) assert.ok(root.startsWith(out + "/"));
assert.equal(JSON.parse(fs.readFileSync(join(target, "package.json"))).version, "0.19.1");
for (const scope of ["@earendil-works", "@mariozechner"]) for (const name of ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"]) {
  assert.equal(JSON.parse(fs.readFileSync(join(modules, scope, name, "package.json"))).version, "1.5.2");
}
export const packageIdentity = process.env.PI_TEST_HARNESS_IDENTITY ?? "stock";
assert.ok(["stock", "repaired"].includes(packageIdentity));
const stockIdentity = "78b72214d79ae3880f36a5a220c94e445154ab7d9ead11d5c3089c7f30dbaa7e";
const repairedIdentity = "bdbd68882202b36e31459d3eef0de5431300e505f8904f48dfebc675ba6e0748";
function artifactIdentity(root) {
  const rows = [];
  function visit(rel = "") {
    const path = join(root, rel), stat = fs.lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) {
      const names = fs.readdirSync(path).sort(); assert.ok(names.length);
      for (const name of names) visit(rel ? `${rel}/${name}` : name);
    } else {
      assert.ok(stat.isFile());
      rows.push([rel, createHash("sha256").update(fs.readFileSync(path)).digest("hex")]);
    }
  }
  visit(); rows.sort(([a], [b]) => { if (a < b) return -1; if (a > b) return 1; return 0; });
  assert.equal(rows.length, 127);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
assert.equal(artifactIdentity(published), stockIdentity, "Verified complete stock control required");
assert.equal(artifactIdentity(target), packageIdentity === "stock" ? stockIdentity : repairedIdentity, "Only exact stock or exact guarded repair is accepted");
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
export function isolatedJiti(alias = {}) {
  return createJiti(import.meta.url, { fsCache: false, moduleCache: false, alias: {
    "@mariozechner/pi-coding-agent": join(modules, "@earendil-works/pi-coding-agent/dist/index.js"),
    "@mariozechner/pi-tui": join(modules, "@earendil-works/pi-tui/dist/index.js"),
    typebox: join(modules, "typebox/build/index.mjs"),
    "typebox/compile": join(modules, "typebox/build/compile/index.mjs"),
    ...alias,
  } });
}
export const jiti = isolatedJiti();
export const load = relative => jiti.import(join(target, "src", relative));
export const fixture = prefix => fs.mkdtempSync(join(out, prefix + "-"));
export const ok = data => ({ success: true, data });
export function registered(tool, client) {
  let definition;
  tool.register({ registerTool: value => { definition = value; } }, client);
  return definition;
}
export const execute = (tool, client, args = {}, ctx = {}) => registered(tool, client).execute("synthetic", args, undefined, undefined, ctx);
