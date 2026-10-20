import assert from "node:assert/strict";
import childProcess, { spawn as esmSpawn } from "node:child_process";
import { after, test } from "node:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RunOptions } from "./types.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "delegate-startup-lifecycle-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousArtifactParent = process.env.PI_DELEGATE_ARTIFACT_PARENT;
process.env.PI_CODING_AGENT_DIR = path.join(root, "diagnostics");
process.env.PI_DELEGATE_ARTIFACT_PARENT = root;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousArtifactParent === undefined) delete process.env.PI_DELEGATE_ARTIFACT_PARENT;
  else process.env.PI_DELEGATE_ARTIFACT_PARENT = previousArtifactParent;
  await rm(root, { recursive: true, force: true });
});

const { withFixtureStartupClock } = await import("./startup-clock.fixture.ts");
const { PiRpcMonitor } = await import("./monitor.ts");
const { terminationProbes } = await import("./supervisor.ts");
const { validateRoutingConfig } = await import("./routing.ts");
const execFile = promisify(childProcess.execFile);
const routingConfig = validateRoutingConfig({
  version: 2, thinkingLevels: ["high"], disabledProviders: [],
  models: { model: { providers: { provider: { thinking: ["high"], default: "high" } } } },
  profiles: { chain: { tiers: [{ model: "model", thinking: "high" }] } },
  assignments: { solution: ["chain"], review: ["chain"], implementation: "chain", remediation: "chain", verification: "chain", oracle: "chain" },
});

for (const mode of ["complete", "reject-before", "reject-after", "finalization-rejects", "guard"] as const) {
  test(`startup finalization has one owner: ${mode}`, async (t) => {
    const cwd = await mkdtemp(path.join(root, "fixture-"));
    const script = path.join(cwd, "fake-pi.mjs");
    await writeFile(script, `
import { spawn } from "node:child_process";
if (process.argv.includes("--list-models")) { console.log("provider model 100 100 yes yes"); process.exit(0); }
if (${mode === "guard"}) await new Promise((resolve) => setTimeout(resolve, 2000));
const { createFixtureSession } = await import(${JSON.stringify(new URL("./persisted-session.fixture.ts", import.meta.url).href)});
const persist = createFixtureSession(process.argv.slice(2));
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.on("SIGTERM", () => { descendant.once("close", () => process.exit(0)); descendant.kill(); });
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  const emit = (event) => console.log(JSON.stringify(event));
  emit({ id: command.id, type: "response", command: "prompt", success: true });
  persist(command.message);
  emit({ type: "agent_start" });
  emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Finished.\\n\\nDELEGATE_RESULT: COMPLETED" }] } });
  emit({ type: "agent_end", willRetry: false });
  emit({ type: "agent_settled" });
});
setInterval(() => {}, 1000);
`);
    const diagnostics = path.join(root, mode, "logs", "delegated-pi-loop");
    process.env.PI_CODING_AGENT_DIR = path.join(root, mode);
    const originals = {
      now: performance.now, spawn: childProcess.spawn, esmSpawn,
      build: terminationProbes.build, accept: PiRpcMonitor.prototype.acceptPrompt,
      setTimeout, clearTimeout,
    };
    const children: { child: childProcess.ChildProcess; probes: ReturnType<typeof terminationProbes.build> }[] = [];
    const captureBuild: typeof terminationProbes.build = (child) => {
      const probes = originals.build(child);
      children.push({ child, probes });
      return probes;
    };
    terminationProbes.build = captureBuild;
    let attempts = 0;
    let reachedBody = false;
    let observedFinalizationFailure = false;
    let artifactDir: string | undefined;
    const callbackFailure = new Error("callback assertion sentinel");
    const finalizationFailure = new Error("partially finalized sentinel");
    const options: RunOptions = {
      role: "solution-a", prompt: "Finish the fixture.", cwd, routingConfig,
      piInvocation: { command: process.execPath, prefixArgs: [script] },
      resourceSelection: { catalogArgs: ["--no-extensions"], runtimeArgs: ["--no-extensions"], verifyCatalogSpawn() {}, verifyRuntimeSpawn() {} },
      catalogTimeoutMs: 5000, activityWarningMs: 200, activityIdleMs: 2500, progressWarningMs: 5000, progressStallMs: 10000,
      graceMs: 100, cleanupTimeoutMs: 1000,
    };
    try {
      const pending = withFixtureStartupClock(t, options, async (result, runtime, finalize) => {
        reachedBody = true;
        assert.equal(result.state, "completed");
        assert.equal(runtime.length, 1);
        artifactDir = result.artifactDir;
        // Only the production finalizer reads this field after the callback starts.
        Object.defineProperty(result, "artifactDir", { get() {
          attempts += 1;
          if (mode === "finalization-rejects") throw finalizationFailure;
          return artifactDir;
        } });
        if (mode === "reject-before") throw callbackFailure;
        const first = finalize();
        assert.equal(finalize(), first, "concurrent requests share the exact Promise");
        if (mode === "finalization-rejects") {
          await assert.rejects(first, (error) => error === finalizationFailure);
          observedFinalizationFailure = true;
          assert.equal(finalize(), first, "a rejected attempt stays memoized");
          return;
        }
        await first;
        assert.equal(finalize(), first, "settled requests share the exact Promise");
        await assert.rejects(lstat(path.join(artifactDir, "session.jsonl")), { code: "ENOENT" });
        await assert.rejects(lstat(artifactDir), { code: "ENOENT" });
        if (mode === "reject-after") throw callbackFailure;
      }, { guardMs: mode === "guard" ? 1000 : 10000 });
      if (mode === "complete") await pending;
      else if (mode === "guard") await assert.rejects(pending, /Fixture startup guard expired before readiness or settlement/);
      else if (mode === "finalization-rejects") await assert.rejects(pending, (error) => error === finalizationFailure);
      else await assert.rejects(pending, (error) => error === callbackFailure);
      assert.equal(reachedBody, mode !== "guard");
      assert.equal(observedFinalizationFailure, mode === "finalization-rejects");
      if (mode !== "guard") assert.equal(attempts, 1, "fallback must not retry finalization");
      const records = await readdir(diagnostics);
      assert.equal(records.length, 1, "one finalization writes exactly one record after helper settlement");
      assert.equal(records[0]!.startsWith("success-v9-"), mode !== "guard");
      if (mode !== "finalization-rejects") {
        assert.deepEqual((await readdir(root)).filter((name) => name.startsWith("delegated-pi-")), []);
      }
      assert.ok(children.some(({ child }) => child.spawnargs.includes("--mode")), "an exact runtime child was owned");
      for (const { probes } of children) {
        assert.ok(await probes.waitForClose(100));
        assert.equal(probes.groupExists(), false);
        assert.equal(probes.processIsRunning(), false);
      }
      assert.equal(performance.now, originals.now);
      assert.equal(childProcess.spawn, originals.spawn);
      assert.equal(esmSpawn, originals.esmSpawn, "the named ESM spawn export is restored too");
      assert.equal(terminationProbes.build, captureBuild);
      assert.equal(PiRpcMonitor.prototype.acceptPrompt, originals.accept);
      assert.equal(setTimeout, originals.setTimeout);
      assert.equal(clearTimeout, originals.clearTimeout);
    } finally {
      terminationProbes.build = originals.build;
      if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
    }
  });
}

for (const inherited of [true, false]) {
  for (const fail of [false, true]) {
    test(`live fallback isolates diagnostics and restores ${inherited ? "inherited" : "unset"} agent dir after ${fail ? "assertion failure" : "success"}`, async () => {
      const cwd = await mkdtemp(path.join(root, "isolation-"));
      const home = path.join(cwd, "home");
      const inheritedAgent = path.join(cwd, "inherited-agent");
      const sentinelDirectories = [inheritedAgent, path.join(home, ".pi", "agent")].map((dir) => path.join(dir, "logs", "delegated-pi-loop"));
      for (const dir of sentinelDirectories) {
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "success-v9-sentinel.json"), "owned inherited sentinel\n", { mode: 0o600 });
      }
      const probe = path.join(cwd, "isolation.test.mjs");
      await writeFile(probe, `
import assert from "node:assert/strict";
import { after } from "node:test";
import { lstat } from "node:fs/promises";
import path from "node:path";
const hadAgentDir = Object.hasOwn(process.env, "PI_CODING_AGENT_DIR");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalEqual = assert.equal;
let injected = false;
assert.equal = (...args) => {
  if (${fail} && !injected && args[0] === "completed" && args[1] === "completed") {
    injected = true;
    throw new Error("isolated callback assertion sentinel");
  }
  return originalEqual(...args);
};
await import(${JSON.stringify(new URL("./live-fallback.test.ts", import.meta.url).href)});
const suiteRoot = process.env.PI_DELEGATE_ARTIFACT_PARENT;
const suiteAgentDir = process.env.PI_CODING_AGENT_DIR;
after(async () => {
  assert.equal = originalEqual;
  assert.equal(injected, ${fail});
  assert.equal(suiteAgentDir, path.join(suiteRoot, "diagnostics"));
  assert.equal(Object.hasOwn(process.env, "PI_CODING_AGENT_DIR"), hadAgentDir);
  assert.equal(process.env.PI_CODING_AGENT_DIR, previousAgentDir);
  await assert.rejects(lstat(suiteRoot), { code: "ENOENT" });
  console.log("fixture isolation teardown verified");
});
`);
      const env = {
        ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(cwd, "config"), XDG_CACHE_HOME: path.join(cwd, "cache"),
        XDG_STATE_HOME: path.join(cwd, "state"), TMPDIR: cwd, PI_CODING_AGENT_DIR: inheritedAgent,
      };
      if (!inherited) delete (env as NodeJS.ProcessEnv).PI_CODING_AGENT_DIR;
      delete (env as NodeJS.ProcessEnv).NODE_OPTIONS;
      delete (env as NodeJS.ProcessEnv).NODE_TEST_CONTEXT;
      let exitCode = 0;
      let output = "";
      try {
        const result = await execFile(process.execPath, ["--test", "--test-name-pattern=^stalled never retains a child$", probe], { env, timeout: 20000, maxBuffer: 128 * 1024 });
        output = result.stdout + result.stderr;
      } catch (error) {
        const failure = error as Error & { code: number; stdout: string; stderr: string };
        exitCode = failure.code;
        output = failure.stdout + failure.stderr;
      }
      assert.equal(exitCode, fail ? 1 : 0, output);
      assert.match(output, /fixture isolation teardown verified/, output);
      if (fail) assert.match(output, /isolated callback assertion sentinel/);
      for (const dir of sentinelDirectories) {
        assert.deepEqual(await readdir(dir), ["success-v9-sentinel.json"], "inherited diagnostics must not gain or lose records");
        const sentinel = path.join(dir, "success-v9-sentinel.json");
        assert.equal(await readFile(sentinel, "utf8"), "owned inherited sentinel\n");
        assert.equal((await lstat(sentinel)).mode & 0o777, 0o600);
      }
    });
  }
}
