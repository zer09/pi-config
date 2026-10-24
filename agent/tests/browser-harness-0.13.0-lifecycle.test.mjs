import assert from "node:assert/strict";
import fs from "node:fs";
import { join, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const run = process.env.PI_A_RUN, modules = process.env.PI_TEST_NODE_MODULES;
const evidenceRoot = process.env.PI_TEST_VERIFICATION_DIR;
const integration = process.env.PI_TEST_INTEGRATION_ROOT;
for (const path of [run, modules, evidenceRoot, integration]) assert.ok(path && isAbsolute(path));
assert.equal(process.env.PI_OFFLINE, "1");

test("selected Pi CLI/RPC same-process resume replaces API, retains 57/53/42 and repeats idempotently", { timeout: 90000 }, async () => {
  const evidence = fs.mkdtempSync(join(evidenceRoot, "resume-attempt-"));
  const fixture = join(evidence, "fixture"), agent = join(fixture, "agent");
  for (const dir of ["agent/npm", "sessions", "cwd/.git"]) fs.mkdirSync(join(fixture, dir), { recursive: true });
  for (const path of [join(fixture, "node_modules"), join(agent, "npm/node_modules")]) fs.symlinkSync(modules, path);
  for (const rel of ["themes", "pi-blackhole/pi-blackhole-config.json", "claude-bridge.json"]) fs.cpSync(join(integration, "agent", rel), join(agent, rel), { recursive: true });
  const settingsText = fs.readFileSync(join(integration, "agent/settings.json"), "utf8");
  const configuredHarness = JSON.parse(settingsText).packages.find(entry => typeof entry === "object" && entry.source.endsWith("/pi-browser-harness"));
  const settings = JSON.parse(settingsText.replaceAll(configuredHarness.source.slice(0, -"/pi-browser-harness".length), modules));
  settings.packages = settings.packages.filter(entry => !(typeof entry === "object" && entry.source === join(modules, "pi-browser-harness")));
  const harnessFixture = join(fixture, "harness-fixture.ts");
  const template = fs.readFileSync(join(evidenceRoot, "harness-fixture.ts"), "utf8").replace("'./target/agent/npm/node_modules/pi-browser-harness/src/index.ts'", JSON.stringify(join(modules, "pi-browser-harness/src/index.ts")));
  fs.writeFileSync(harnessFixture, template, { flag: "wx" });
  settings.extensions = settings.extensions.filter(path => !path.endsWith("/harness-fixture.ts"));
  settings.extensions.push(...["claude-bridge-provider", "delegated-pi-loop", "fastlane", "footer", "github-ci", "openai-codex-aliases", "theme-overrides", "web-search"].map(name => join(integration, "agent/extensions", name)), harnessFixture);
  settings.sessionDir = join(fixture, "sessions");
  fs.writeFileSync(join(agent, "settings.json"), JSON.stringify(settings, null, 2), { flag: "wx" });
  fs.copyFileSync(join(run, "e/probe.ts"), join(fixture, "probe.ts"), fs.constants.COPYFILE_EXCL);
  const cli = join(modules, "@earendil-works/pi-coding-agent/dist/cli.js");
  const hash = path => createHash("sha256").update(fs.readFileSync(path)).digest("hex");
  const expected = JSON.parse(fs.readFileSync(join(run, "reports/increment-c/stock-identity.json")))["pi-browser-harness"];
  const fingerprints = Object.fromEntries(Object.keys(expected).map(rel => [rel, hash(join(modules, "pi-browser-harness", rel))]));
  const changes = Object.keys(expected).filter(rel => expected[rel] !== fingerprints[rel]);
  const stock = process.env.PI_TEST_EXPECT_STOCK === "1";
  assert.deepEqual(changes, stock ? [] : ["src/registry.ts"]);
  const requireHarness = createRequire(join(modules, "pi-browser-harness/package.json"));
  const identity = {
    pi: JSON.parse(fs.readFileSync(join(modules, "@earendil-works/pi-coding-agent/package.json"))).version,
    harness: JSON.parse(fs.readFileSync(join(modules, "pi-browser-harness/package.json"))).version,
    cli, cliRealpath: fs.realpathSync(cli), cliSha256: hash(cli),
    canonicalApi: fs.realpathSync(requireHarness.resolve("@earendil-works/pi-coding-agent")),
    legacyApi: fs.realpathSync(requireHarness.resolve("@mariozechner/pi-coding-agent")),
    legacyApiVersion: JSON.parse(fs.readFileSync(join(modules, "@mariozechner/pi-coding-agent/package.json"))).version,
    harnessEntrypoint: JSON.parse(fs.readFileSync(join(modules, "pi-browser-harness/package.json"))).pi.extensions,
    fingerprints, changes,
  };
  assert.equal(identity.pi, "1.4.0"); assert.equal(identity.harness, "0.13.0"); assert.equal(identity.legacyApiVersion, "1.4.0");
  assert.deepEqual(identity.harnessEntrypoint, ["./src/index.ts"]);
  fs.writeFileSync(join(evidence, "runtime-identity.json"), JSON.stringify(identity, null, 2), { flag: "wx" });
  const inventoryPath = join(evidence, "inventory.jsonl"), apiPath = join(evidence, "api-identity.jsonl");
  const args = ["--import", join(run, "guard.mjs"), cli, "--mode", "rpc", "--model", "e-offline/fixture", "--thinking", "off", "-e", join(fixture, "probe.ts")];
  const child = spawn(process.execPath, args, { cwd: join(fixture, "cwd"), env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: join(fixture, "sessions"), PI_TEST_PROBE_REPORT: inventoryPath, PI_TEST_HARNESS_IDENTITY_REPORT: apiPath }, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", stderr = "", id = 0;
  const responses = [], waiters = new Map();
  const exit = new Promise((resolve, reject) => { child.on("exit", (code, signal) => resolve({ code, signal })); child.on("error", reject); });
  child.stderr.on("data", value => { stderr += value; });
  child.stdout.on("data", value => {
    buffer += value; let split;
    while ((split = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, split); buffer = buffer.slice(split + 1); if (!line) continue;
      const record = JSON.parse(line);
      if (record.type === "response") { responses.push(record); waiters.get(record.id)?.(record); }
    }
  });
  async function command(type, fields = {}) {
    const key = String(++id);
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(key); reject(Error(`RPC timeout: ${type}; ${stderr.slice(-1000)}`)); }, 30000);
      waiters.set(key, value => { clearTimeout(timer); waiters.delete(key); resolve(value); });
    });
    child.stdin.write(JSON.stringify({ id: key, type, ...fields }) + "\n");
    const response = await result; assert.equal(response.success, true, JSON.stringify(response)); return response.data;
  }
  let failure;
  try {
    await command("get_state");
    assert.equal((await command("prompt", { message: "/e-probe" })).disposition, "handled");
    await command("set_session_name", { name: "Disposable C1 registration acceptance" });
    const before = await command("get_state");
    assert.ok(before.sessionFile.startsWith(join(fixture, "sessions/")));
    // Command-only sessions do not flush. Seed only the documented disposable v3 header.
    assert.equal(fs.existsSync(before.sessionFile), false);
    fs.writeFileSync(before.sessionFile, JSON.stringify({ type: "session", version: 3, id: before.sessionId, timestamp: new Date().toISOString(), cwd: join(fixture, "cwd") }) + "\n", { flag: "wx" });
    const switched = await command("switch_session", { sessionPath: before.sessionFile }); assert.equal(switched.cancelled, false);
    assert.equal((await command("prompt", { message: "/e-probe" })).disposition, "handled");
    const rows = fs.readFileSync(inventoryPath, "utf8").trim().split("\n").map(JSON.parse).filter(row => row.phase === "probe");
    const counts = rows.map(row => [row.tools.length, row.active.length, row.tools.filter(name => name.startsWith("browser_")).length]);
    const api = fs.readFileSync(apiPath, "utf8").trim().split("\n").map(JSON.parse);
    const factories = api.filter(row => row.phase === "factory"), starts = api.filter(row => row.phase === "session-start-complete");
    const commands = rows.map(row => row.commands.filter(value => value.source === "extension" && !["e-probe", "e-reload", "e-tree"].includes(value.name)).map(value => value.name).sort());
    fs.writeFileSync(join(evidence, "resume-repro.json"), JSON.stringify({ cli, args, counts, switched, factories, starts, commands }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ evidence, counts, registrations: starts.map(row => row.registrations.length), commands: commands.map(row => row.length) }));
    assert.equal(rows.length, 2); assert.ok(rows.every(row => row.calls === 0));
    assert.equal(commands[0].length, 24); assert.deepEqual(commands[1], commands[0]);
    assert.equal(factories.length, 2); assert.equal(factories[0].pid, factories[1].pid);
    assert.equal(factories[1].sameApiAsPrevious, false); assert.equal(factories[1].sameRegisterAsPrevious, false); assert.equal(factories[1].previousApiStale, true);
    assert.ok(factories.every(row => row.canonicalEqualsLegacyRuntimeFactory && row.piVersion === "1.4.0"));
    assert.equal(starts[0].reason, "startup"); assert.equal(starts[0].registrations.length, 42);
    assert.ok(starts.length >= 3, "Pi emits repeated resume notifications on one replacement API");
    assert.ok(starts.slice(1).every(row => row.reason === "resume" && row.invocation === 2));
    assert.equal(starts[1].registrations.length, stock ? 0 : 42);
    assert.ok(starts.slice(2).every(row => row.registrations.length === 0));
    assert.ok(starts.every(row => row.registryContents.length === 42));
    if (stock) assert.deepEqual(counts, [[57,53,42],[15,11,0]], "stock validity before intentionally red healthy assertion");
    else {
      assert.deepEqual(rows[1].tools, rows[0].tools); assert.deepEqual(rows[1].active, rows[0].active);
      for (const row of rows) for (const name of ["browser_set_headers", "browser_clear_headers"]) assert.ok(row.active.includes(name));
    }
    // Stock must fail only here. The same healthy assertion must pass with the guarded repair.
    assert.deepEqual(counts, [[57,53,42],[57,53,42]]);
  } catch (error) { failure = error; }
  finally {
    child.stdin.end(); const childExit = await exit;
    for (const [name, value] of [["rpc-responses.json", JSON.stringify(responses,null,2)], ["child-stderr.log", stderr], ["child-exit.json", JSON.stringify(childExit,null,2)]]) fs.writeFileSync(join(evidence,name),value,{flag:"wx"});
    assert.deepEqual(childExit,{code:0,signal:null});
  }
  if (failure) throw failure;
});
