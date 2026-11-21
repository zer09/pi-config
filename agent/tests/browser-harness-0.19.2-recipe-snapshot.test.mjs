import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { isolatedJiti, target, fixture, execute, ok, out } from "./browser-harness-0.19.2-fixture.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originalRead = fsp.readFile, originalRename = fsp.rename;
let interleave;
// Read the real bytes first, then deterministically let the other writer restore A.
fsp.readFile = async function(path, ...args) {
  const bytes = await originalRead.call(this, path, ...args);
  if (interleave?.kind === "read" && path === interleave.path && !interleave.fired) {
    interleave.fired = true;
    interleave.loadedHash = hash(bytes);
    fs.writeFileSync(path, interleave.replacement);
  }
  return bytes;
};
fsp.rename = async function(from, to) {
  if (interleave?.kind === "failed-write" && to === interleave.path) throw Error("Synthetic failed write");
  await originalRename.call(this, from, to);
  if (interleave?.kind === "write" && to.endsWith(".yaml") && !interleave.fired) {
    interleave.path = to;
    interleave.fired = true;
    interleave.written = fs.readFileSync(to);
    fs.writeFileSync(to, interleave.replacement);
  }
};
syncBuiltinESMExports();
const deps = fixture("snapshot-deps"), spawnStub = join(deps, "spawn.ts");
fs.writeFileSync(spawnStub, "export async function daemonSocketMayExist() { return true; }\n");
const journalStub = join(deps, "journal.ts");
fs.writeFileSync(journalStub, "export const activeJournal = () => globalThis.__h019SnapshotJournal;\n");
const jiti = isolatedJiti({ "../daemon/spawn": spawnStub, "./journal": journalStub });
const load = rel => jiti.import(join(target, "src", rel));
const { saveRecipe, findRecipe, recipeRoots, recordRun } = await load("recipes/store.ts");
const { approveProjectRecipe, isTrusted, trustWritten } = await load("recipes/trust.ts");
const { confirmAndSave, saveRecipeTool } = await load("recipes/save-tool.ts");
const { runRecipeTool } = await load("recipes/run-tool.ts");
const { registerRecipeCommand } = await load("recipes/command.ts");
const { stringifyRecipe, parseRecipe } = await load("recipes/recipe.ts");
const name = "snapshot-recipe", approvedURL = "https://fixture.invalid/approved-a", unapprovedURL = "https://unapproved.invalid/replacement-b";
const recipe = (url = approvedURL) => ({ name, site: "fixture.invalid", version: 1, params: {}, steps: [{ action: "navigate", args: { url } }], recorded: { at: "2026-01-01T00:00:00.000Z", session: "synthetic-b1" } });
const context = (cwd, confirm) => ({ cwd, hasUI: confirm !== undefined, ui: { confirm: confirm ?? (() => { throw Error("Unexpected approval"); }), notify() {} } });
function recorder(fail = false) {
  const calls = [], navigations = [];
  let url = approvedURL;
  const client = new Proxy({
    async ensureAlive() { calls.push("ensureAlive"); return ok(undefined); },
    async pageInfo() { calls.push("pageInfo"); return ok({ kind: "page", url, title: "Synthetic", width: 800, height: 600 }); },
    session() { calls.push("session"); return { downloadCount() { return 0; }, async call(method, args) { calls.push(method); if (method === "Accessibility.getFullAXTree") return { success: false, error: { kind: "protocol", message: "Synthetic snapshot unavailable" } }; assert.equal(method, "Page.navigate"); navigations.push(args.url); url = args.url; return fail ? { success: false, error: { kind: "protocol", message: "Synthetic failure" } } : ok({ frameId: "synthetic" }); } }; },
    mutationMutex() { calls.push("mutex"); return { async acquire() { return () => {}; } }; },
    async listTabs() { return ok([{ targetId: "synthetic" }]); }, current() { return { targetId: "synthetic" }; },
    async evaluateJs() { return ok(false); },
  }, { get(object, key) { assert.ok(Object.hasOwn(object, key), `Unexpected client property ${String(key)}`); return object[key]; } });
  return { client, calls, navigations };
}
async function invoke(route, cwd, client, confirm) {
  const ctx = context(cwd, confirm), messages = [];
  ctx.ui.notify = text => messages.push(text);
  if (route === "handler") {
    const result = await runRecipeTool.handler({ name, params: {} }, { client, extensionCtx: ctx });
    return { success: result.success, text: result.success ? result.data.text : result.error.message };
  }
  if (route === "tool") {
    try { const result = await execute(runRecipeTool, client, { name, params: {} }, ctx); return { success: true, text: result.content[0].text }; }
    catch (error) { return { success: false, text: error.message }; }
  }
  let command;
  registerRecipeCommand({ registerCommand(n, c) { assert.equal(n, "browser-recipe"); command = c; }, sendMessage() { throw Error("Unexpected output"); }, sendUserMessage() { messages.push("failure handoff"); } }, client);
  await command.handler(name, { ...ctx, isIdle: () => true });
  return { success: messages.some(text => text.includes(" done:")), text: messages.join("\n") };
}
async function setup() {
  const cwd = fixture("snapshot-recipe"), stored = (await saveRecipe(recipeRoots(cwd).project, recipe())).data;
  const a = fs.readFileSync(stored.path), b = Buffer.from(stringifyRecipe(recipe(unapprovedURL)));
  assert.equal((await approveProjectRecipe(context(cwd, async (_title, body) => { assert.ok(body.includes(approvedURL)); return true; }), stored, {})).success, true);
  assert.equal(await isTrusted(stored.path, a), true); assert.equal(await isTrusted(stored.path, b), false);
  return { cwd, stored, a, b };
}
for (const route of ["handler", "tool", "command"]) test(`snapshot race: ${route} cannot borrow A approval for parsed B`, async () => {
  const f = await setup(), client = recorder();
  fs.writeFileSync(f.stored.path, f.b);
  interleave = { kind: "read", path: f.stored.path, replacement: f.a, fired: false };
  let result, race;
  try { result = await invoke(route, f.cwd, client.client); race = interleave; } finally { interleave = undefined; }
  assert.equal(race.fired, true); assert.equal(race.loadedHash, hash(f.b));
  fs.writeFileSync(join(out, `${process.env.PI_TEST_RUN_NAME}-${route}-race.json`), JSON.stringify({ result, calls: client.calls, navigations: client.navigations, loadedHash: race.loadedHash, approvedHash: hash(f.a) }, null, 2));
  if (process.env.PI_TEST_EXPECT_STOCK_B1 === "1") {
    assert.equal(result.success, true); assert.deepEqual(client.navigations, [unapprovedURL]);
  } else {
    assert.equal(result.success, false); assert.match(result.text, /changed since it was loaded|not been approved/);
    assert.deepEqual(client.calls, []); assert.deepEqual(client.navigations, []);
    assert.deepEqual(fs.readFileSync(f.stored.path), f.a);
  }
});

for (const route of ["tool", "command"]) test(`${route} preserves trusted replay, interactive acceptance and rejection`, async () => {
  const f = await setup();
  for (let i = 0; i < 2; i++) {
    const client = recorder(); assert.equal((await invoke(route, f.cwd, client.client)).success, true);
    assert.deepEqual(client.navigations, [approvedURL]);
    assert.equal(await isTrusted(f.stored.path, fs.readFileSync(f.stored.path)), true, "last_run needs no new approval");
  }
  fs.writeFileSync(f.stored.path, f.b);
  for (const confirm of [undefined, async () => false]) {
    const client = recorder(); assert.equal((await invoke(route, f.cwd, client.client, confirm)).success, false); assert.deepEqual(client.calls, []);
  }
  const client = recorder(); let confirmations = 0;
  assert.equal((await invoke(route, f.cwd, client.client, async (_title, body) => { confirmations++; assert.ok(body.includes(unapprovedURL)); assert.ok(!body.includes(approvedURL)); return true; })).success, true);
  assert.equal(confirmations, 1); assert.deepEqual(client.navigations, [unapprovedURL]);
});
test("raw-byte snapshot distinguishes comments, newline forms and invalid UTF-8 in comments", async () => {
  const f = await setup();
  for (const bytes of [Buffer.concat([f.a, Buffer.from("\n# comment\n")]), Buffer.from(f.a.toString().replaceAll("\n", "\r\n")), Buffer.concat([f.a, Buffer.from([35,32,255,10])])]) {
    fs.writeFileSync(f.stored.path, bytes);
    const loaded = (await findRecipe(f.cwd, name)).data;
    assert.equal(loaded.sourceHash, hash(bytes));
    assert.equal((await approveProjectRecipe(context(f.cwd), loaded, {})).success, false);
    assert.equal((await approveProjectRecipe(context(f.cwd, async () => true), loaded, {})).success, true);
    assert.equal(await isTrusted(loaded.path, bytes), true); assert.equal(await isTrusted(loaded.path, f.a), false);
  }
});
test("missing or changed file refuses a stale snapshot before approval", async () => {
  const f = await setup();
  for (const mutate of [() => fs.unlinkSync(f.stored.path), () => fs.writeFileSync(f.stored.path, f.b)]) {
    mutate(); let dialogs = 0;
    const result = await approveProjectRecipe(context(f.cwd, async () => { dialogs++; return true; }), f.stored, {});
    assert.equal(result.success, false); assert.equal(dialogs, 0);
  }
});
test("a writer during the dialog cannot change the approved snapshot or borrow its trust", async () => {
  const f = await setup(); fs.writeFileSync(f.stored.path, f.b);
  const loaded = (await findRecipe(f.cwd, name)).data;
  assert.equal((await approveProjectRecipe(context(f.cwd, async (_title, body) => { assert.ok(body.includes(unapprovedURL)); fs.writeFileSync(loaded.path, f.a); return true; }), loaded, {})).success, true);
  assert.equal(await isTrusted(loaded.path, f.b), true); assert.equal(await isTrusted(loaded.path, f.a), false);
});
for (const operation of ["save", "repair", "last_run"]) test(`automatic ${operation} trust covers only bytes actually written`, async () => {
  const f = await setup();
  interleave = { kind: "write", replacement: f.b, fired: false };
  let written, race;
  try {
    if (operation === "last_run") { written = await recordRun(f.stored, { at: "2026-01-02", result: "ok" }); await trustWritten(written, f.cwd); }
    else written = (await confirmAndSave(context(f.cwd), f.stored.root, recipe(), "Synthetic save")).data;
    race = interleave;
  } finally { interleave = undefined; }
  assert.equal(race.fired, true); assert.equal(written.sourceHash, hash(race.written));
  assert.equal(await isTrusted(written.path, race.written), true); assert.equal(await isTrusted(written.path, f.b), false);
  const client = recorder(); assert.equal((await invoke("tool", f.cwd, client.client)).success, false); assert.deepEqual(client.calls, []);
  assert.equal(parseRecipe(race.written.toString()).data.version, operation === "last_run" ? 1 : 2);
});
test("failed last_run write returns no trustable snapshot and preserves prior trust", async () => {
  const f = await setup(); fs.writeFileSync(f.stored.path, f.b);
  interleave = { kind: "failed-write", path: f.stored.path };
  try { assert.equal(await recordRun(f.stored, { at: "2026-01-02", result: "ok" }), undefined); } finally { interleave = undefined; }
  assert.equal(await isTrusted(f.stored.path, f.a), true); assert.equal(await isTrusted(f.stored.path, f.b), false);
});
for (const route of ["tool", "command"]) for (const failed of [false, true]) test(`${route} binds automatic last_run trust after ${failed ? "failed" : "successful"} replay`, async () => {
  const f = await setup(), client = recorder(failed);
  interleave = { kind: "write", replacement: f.b, fired: false };
  let race;
  try { assert.equal((await invoke(route, f.cwd, client.client)).success, !failed); race = interleave; } finally { interleave = undefined; }
  assert.equal(race.fired, true);
  assert.equal(parseRecipe(race.written.toString()).data.lastRun.result, failed ? "failed" : "ok");
  assert.equal(await isTrusted(f.stored.path, race.written), true); assert.equal(await isTrusted(f.stored.path, f.b), false);
  const refused = recorder(); assert.equal((await invoke(route, f.cwd, refused.client)).success, false); assert.deepEqual(refused.calls, []);
});
for (const repair of [false, true]) test(`actual browser_save_recipe ${repair ? "repair" : "save"} cannot trust a concurrent replacement`, async () => {
  const f = await setup(), client = recorder();
  const entry = { v: 1, at: "2026-01-01", run: 1, source: "agent", tool: "browser_navigate", replayable: true, args: { url: approvedURL }, password: false, url: approvedURL, ok: true };
  const marker = { ...entry, source: "replay", tool: "browser_run_recipe", replayable: false, ok: false, args: {}, recipe: { name, step: 1 } };
  globalThis.__h019SnapshotJournal = { entries: async () => repair ? [marker, entry] : [entry] };
  interleave = { kind: "write", replacement: f.b, fired: false };
  let race;
  try {
    const result = await saveRecipeTool.handler({ name, project: true, ...(repair ? { repair_step: 1 } : {}) }, { client: client.client, extensionCtx: { ...context(f.cwd), sessionManager: { getSessionId: () => "synthetic-b1" } } });
    assert.equal(result.success, true, JSON.stringify(result)); race = interleave;
  } finally { interleave = undefined; delete globalThis.__h019SnapshotJournal; }
  assert.equal(race.fired, true); assert.equal(await isTrusted(f.stored.path, race.written), true); assert.equal(await isTrusted(f.stored.path, f.b), false);
  const refused = recorder(); assert.equal((await invoke("tool", f.cwd, refused.client)).success, false); assert.deepEqual(refused.calls, []);
});
test.after(() => { fsp.readFile = originalRead; fsp.rename = originalRename; syncBuiltinESMExports(); });
