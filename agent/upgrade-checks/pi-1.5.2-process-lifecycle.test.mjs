import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use the C1/C2 explicit-host and cleared-environment bwrap pattern. No PATH
// lookup, installed resources, real sessions, providers or account CLIs run here.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = resolve(repository, "..");
const modules = process.env.PI_TEST_NODE_MODULES;
assert.ok(modules && isAbsolute(modules), "Explicit isolated host required");
assert.equal(fs.realpathSync(modules), modules);
assert.ok(!relative(run, modules).startsWith(".."), "Host must live under RUN");
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const piRoot = join(modules, "@earendil-works/pi-coding-agent");
// Check the host version before the executable paths, including in refusal tests.
assert.equal(json(join(piRoot, "package.json")).version, "1.5.2", "Exact Pi 1.5.2 required");
for (const scope of ["@earendil-works", "@mariozechner"]) {
  for (const name of ["pi-ai", "pi-coding-agent", "pi-agent-core", "pi-tui"]) {
    assert.equal(json(join(modules, scope, name, "package.json")).version, "1.5.2");
  }
}
const node = process.env.PI_TEST_CHILD_NODE;
assert.equal(node, process.execPath, "Explicit child Node must match the test runtime");
assert.equal(process.env.PI_TEST_CHILD_PI, join(piRoot, "dist/cli.js"));
assert.equal(process.env.PI_TEST_CHILD_PI_BUNDLED, join(piRoot, "dist/bundle/cli.js"));
for (const file of [node, process.env.PI_TEST_CHILD_PI, process.env.PI_TEST_CHILD_PI_BUNDLED]) assert.equal(fs.realpathSync(file), file);
const output = process.env.PI_TEST_OUTPUT_DIR;
assert.ok(output && isAbsolute(output) && !relative(join(run, "reports"), output).startsWith(".."));
assert.equal(fs.realpathSync(output), output);
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
assert.equal(process.env.PI_DELEGATED_CHILD, undefined);
assert.equal(process.platform, "linux", "These real bwrap/signal proofs require Linux, not a skipped approximation");
assert.notEqual(fs.readlinkSync("/proc/self/ns/net"), process.env.PI_TEST_PARENT_NET_NS);
assert.ok(process.env.PI_TEST_PARENT_NET_NS);
assert.deepEqual(Object.keys(os.networkInterfaces()), ["lo"]);
for (const hidden of [".pi", ".bun", ".config", ".ssh", ".npmrc", ".gitconfig"]) assert.equal(fs.existsSync(`/home/gc/${hidden}`), false);
assert.ok(!Object.keys(process.env).some(key => /KEY|TOKEN|SECRET|COOKIE|AUTH|PASSWORD/i.test(key)));
const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8").split("\n").map(line => line.split(" "));
assert.ok(mounts.some(fields => fields[4] === run && fields[5].split(",").includes("ro")));
assert.ok(mounts.some(fields => fields[4] === output && fields[5].split(",").includes("rw")));
assert.equal(json(join(process.env.PI_CODING_AGENT_DIR, "settings.json")).cacheWarming, "off");
const scratch = fs.mkdtempSync(join(output, "fixtures-"));
const missing = join(scratch, "missing-executable");
const forbidden = [];
const deny = name => () => { forbidden.push(name); throw Error(`C3 forbidden: ${name}`); };
net.Socket.prototype.connect = deny("socket.connect");
net.Server.prototype.listen = deny("server.listen");
globalThis.fetch = deny("fetch");
globalThis.WebSocket = deny("WebSocket");
const nativeSpawn = childProcess.spawn;
const records = [];
const owned = new Set();
const fallbackKills = [];
childProcess.spawn = (command, args, options) => {
  assert.ok(command === node || command === missing, "Only explicit Node or a synthetic missing executable may spawn");
  assert.notEqual(options?.shell, true);
  const child = nativeSpawn(command, args, options);
  const record = { child, command, args, cwd: options?.cwd ?? scratch, stdout: [], stderr: [], signals: [], signalEvents: [] };
  records.push(record);
  owned.add(record);
  const kill = child.kill.bind(child);
  child.kill = signal => {
    record.signalEvents.push({ signal, atMs: performance.now() });
    record.signals.push(signal);
    return kill(signal);
  };
  child.stdout?.on("data", chunk => record.stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", chunk => record.stderr.push(Buffer.from(chunk)));
  record.closed = new Promise(resolve => child.once("close", (code, signal) => { record.exit = { code, signal }; owned.delete(record); resolve(record.exit); }));
  child.on("error", error => { record.error = error; });
  record.spawnReturnedAtMs = performance.now();
  return child;
};
for (const name of ["spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = deny(name);
syncBuiltinESMExports();
const within = async (promise, ms = 12000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`C3 deadline: ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
};
const waitFor = async predicate => {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Synthetic readiness marker missing");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const alive = record => record.child.exitCode === null && record.child.signalCode === null;
async function reap(record) {
  if (alive(record) && !record.signals.includes("SIGKILL")) {
    fallbackKills.push(record.child.pid);
    record.child.kill("SIGKILL");
  }
  await within(record.closed);
}
after(async () => {
  for (const record of owned) await reap(record);
  assert.equal(owned.size, 0, "Every owned child must close");
  assert.deepEqual(fallbackKills, [], "Successful proofs must never need a competing fixture kill");
  assert.deepEqual(forbidden, [], "Swallowed forbidden attempts also fail the suite");
  fs.writeFileSync(join(scratch, "execution.json"), JSON.stringify({ runtime: process.version, networkDenied: true, ownedRemaining: owned.size, fallbackKills, forbidden,
    signalClock: "performance.now() monotonic milliseconds",
    children: records.map(({ command, args, cwd, spawnReturnedAtMs, signals, signalEvents, timing, exit }) => ({ command, args, cwd, spawnReturnedAtMs, signals, signalEvents, timing, exit })),
  }, null, 2) + "\n");
});

const { loadExtensionFromFactory, createExtensionRuntime } = await import(pathToFileURL(join(piRoot, "dist/core/extensions/loader.js")));
const { createEventBus } = await import(pathToFileURL(join(piRoot, "dist/core/event-bus.js")));
let pi;
await loadExtensionFromFactory(api => { pi = api; }, scratch, createEventBus(), createExtensionRuntime());
// This is the actual loader-created API, not a local reimplementation of exec.
assert.equal(typeof pi.exec, "function");
const results = [];
async function execute(source, options = {}, interact, command = node) {
  const failureAbort = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, failureAbort.signal]) : failureAbort.signal;
  const pending = pi.exec(command, ["--input-type=module", "-e", source], { ...options, signal });
  const record = records.at(-1);
  try {
    if (interact) await within(interact(record));
    const result = await within(pending);
    await within(record.closed);
    results.push(result);
    return { result, record };
  } finally {
    if (owned.has(record)) {
      // Let the target own TERM and its five-second escalation before a last
      // resort fixture cleanup takes ownership. Never race a second kill timer.
      failureAbort.abort();
      try { await within(pending); await within(record.closed); }
      catch { await reap(record); }
    }
  }
}
const splitSource = gate => `
  import fs from 'node:fs';
  const gate = ${JSON.stringify(gate)};
  const watchdog = setTimeout(() => process.exit(91), 20000);
  for (const [i, byte] of [...Buffer.from('€😀')].entries()) {
    fs.writeSync(1, Buffer.from([byte])); fs.writeSync(2, Buffer.from([byte]));
    while (!fs.existsSync(gate + i)) await new Promise(r => setTimeout(r, 5));
  }
  clearTimeout(watchdog);
`;

// libuv's timer clock uses milliseconds (https://docs.libuv.org/en/v1.x/timer.html).
// Allow one clock tick, not any child startup, timeout or completion overhead.
const timerResolutionMs = 1;
function assertEscalationInterval(signalEvents) {
  assert.deepEqual(signalEvents.map(event => event.signal), ["SIGTERM", "SIGKILL"]);
  const termToKillMs = signalEvents[1].atMs - signalEvents[0].atMs;
  assert.ok(termToKillMs >= 5000 - timerResolutionMs, `TERM-to-KILL interval ${termToKillMs}ms must preserve the target's 5000ms escalation (1ms timer resolution)`);
}

for (const { mode, beforeTermMs, escalationMs } of [
  { mode: "timeout", beforeTermMs: 1500, escalationMs: 3500 },
  { mode: "abort readiness", beforeTermMs: 100, escalationMs: 4900 },
]) {
  test(`exec: escalation interval rejects ${mode} overhead hiding ${escalationMs}ms`, t => {
    const completionMs = 1;
    const wholeCallMs = beforeTermMs + escalationMs + completionMs;
    assert.equal(wholeCallMs, 5001);
    assert.ok(wholeCallMs >= 5000, "The old whole-call gate accepts this counterexample");
    const signalEvents = [
      { signal: "SIGTERM", atMs: beforeTermMs },
      { signal: "SIGKILL", atMs: beforeTermMs + escalationMs },
    ];
    assert.throws(() => assertEscalationInterval(signalEvents), /TERM-to-KILL interval/);
    assert.doesNotThrow(() => assertEscalationInterval([signalEvents[0], { signal: "SIGKILL", atMs: beforeTermMs + 5000 }]));
    assert.doesNotThrow(() => assertEscalationInterval([signalEvents[0], { signal: "SIGKILL", atMs: beforeTermMs + 4999 }]));
    assert.throws(() => assertEscalationInterval([signalEvents[0], { signal: "SIGKILL", atMs: beforeTermMs + 4998 }]), /TERM-to-KILL interval/);
    t.diagnostic(JSON.stringify({ negativeControl: mode, beforeTermMs, escalationMs, completionMs, wholeCallMs, rejectedByIntervalAssertion: true, timerResolutionMs }));
  });
}

test("exec: real loader API captures separate streams and nonzero exits without claiming a kill", async t => {
  const { result, record } = await execute("process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 23;");
  assert.deepEqual(result, { stdout: "out", stderr: "err", code: 23, killed: false, truncated: false });
  assert.deepEqual(record.signals, []);
  t.diagnostic(JSON.stringify(result));
});

test("exec: combined cap truncation is signal-terminated; exact and zero caps retain their results", async t => {
  const gate = join(scratch, "combined-release");
  const { result, record } = await execute(`
    import fs from 'node:fs';
    fs.writeSync(1, '12345678');
    const timer = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(gate)})) { clearInterval(timer); fs.writeSync(2, 'abcdefgh'); }
    }, 5);
  `, { maxBuffer: 10 }, async record => {
    await waitFor(() => Buffer.concat(record.stdout).toString() === "12345678");
    fs.writeFileSync(gate, "release");
  });
  assert.deepEqual(result, { stdout: "12345678", stderr: "ab", code: 1, killed: true, truncated: true });
  assert.deepEqual(record.signals, ["SIGTERM"]);
  assert.deepEqual(record.exit, { code: null, signal: "SIGTERM" });
  const exact = (await execute("process.stdout.write('12345678'); process.stderr.write('ab');", { maxBuffer: 10 })).result;
  assert.deepEqual(exact, { stdout: "12345678", stderr: "ab", code: 0, killed: false, truncated: false });
  const zero = (await execute("process.stdout.write('x');", { maxBuffer: 0 })).result;
  assert.deepEqual(zero, { stdout: "", stderr: "", code: 1, killed: true, truncated: true });
  t.diagnostic(JSON.stringify({ combined: result, combinedExit: record.exit, requestedSignals: record.signals, exact, zero }));
});

test("exec: a synthetic missing executable returns useful spawn stderr rather than rejecting the host", async t => {
  const { result, record } = await execute("", {}, undefined, missing);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.killed, false);
  assert.equal(result.truncated, false);
  assert.match(result.stderr, /ENOENT/);
  assert.ok(result.stderr.includes(missing));
  assert.equal(record.error.code, "ENOENT");
  t.diagnostic(JSON.stringify({ ...result, stderr: "spawn <synthetic missing executable> ENOENT" }));
});

test("exec: UTF-8 decodes across proven one-byte chunks on both pipes", async t => {
  const gate = join(scratch, "utf8-release-");
  const { result, record } = await execute(splitSource(gate), {}, async record => {
    for (let i = 0; i < 7; i++) {
      await waitFor(() => record.stdout.length === i + 1 && record.stderr.length === i + 1);
      assert.equal(record.stdout[i].length, 1);
      assert.equal(record.stderr[i].length, 1);
      fs.writeFileSync(gate + i, "release");
    }
  });
  assert.deepEqual(result, { stdout: "€😀", stderr: "€😀", code: 0, killed: false, truncated: false });
  t.diagnostic(JSON.stringify({ result, stdoutChunkBytes: record.stdout.map(b => b.length), stderrChunkBytes: record.stderr.map(b => b.length) }));
});

test("exec: truncation drops incomplete UTF-8 suffixes at every multibyte boundary", async t => {
  const text = "A€😀Z";
  const expected = ["", "A", "A", "A", "A€", "A€", "A€", "A€", "A€😀", text];
  for (let cap = 0; cap <= 9; cap++) {
    const { result } = await execute(`process.stdout.write(${JSON.stringify(text)});`, { maxBuffer: cap });
    assert.equal(result.stdout, expected[cap]);
    assert.equal(result.stderr, "");
    assert.equal(result.truncated, cap < 9);
    assert.equal(result.killed, cap < 9);
    assert.equal(result.code, cap < 9 ? 1 : 0);
    assert.doesNotMatch(result.stdout, /\uFFFD/);
    assert.ok(Buffer.byteLength(result.stdout) <= cap);
  }
  const gate = join(scratch, "two-decoders-release");
  const { result } = await execute(`
    import fs from 'node:fs';
    fs.writeSync(1, Buffer.from([65, 240, 159]));
    const timer = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(gate)})) { clearInterval(timer); fs.writeSync(2, Buffer.from([66, 226, 130, 172, 90])); }
    }, 5);
  `, { maxBuffer: 6 }, async record => {
    await waitFor(() => Buffer.concat(record.stdout).length === 3);
    fs.writeFileSync(gate, "release");
  });
  assert.deepEqual(result, { stdout: "A", stderr: "B", code: 1, killed: true, truncated: true });
  t.diagnostic(JSON.stringify({ boundaries: expected, bothIncompleteDecoders: result }));
});

for (const mode of ["timeout", "abort"]) {
  for (const ignoresTerm of [false, true]) {
    test(`exec: ${mode} ${ignoresTerm ? "escalates to SIGKILL after ignored SIGTERM" : "terminates cooperatively"}`, { timeout: 20000 }, async t => {
      const controller = new AbortController();
      const term = join(scratch, `${mode}-${ignoresTerm}-term`);
      const source = `
        import fs from 'node:fs';
        process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(term)}, 'TERM'); ${ignoresTerm ? "" : "process.exit(0);"} });
        process.stdout.write('READY');
        setInterval(() => {}, 1000);
        setTimeout(() => process.exit(91), 20000).unref();
      `;
      const start = performance.now();
      const options = mode === "timeout" ? { timeout: 1500 } : { signal: controller.signal };
      let readyAtMs, abortRequestedAtMs;
      const { result, record } = await execute(source, options, async record => {
        await waitFor(() => Buffer.concat(record.stdout).toString() === "READY");
        readyAtMs = performance.now();
        if (mode === "abort") {
          abortRequestedAtMs = performance.now();
          controller.abort(); controller.abort();
        }
      });
      const termAtMs = record.signalEvents[0].atMs;
      record.timing = { mode, ignoresTerm, configuredTimeoutMs: options.timeout, spawnReturnedAtMs: record.spawnReturnedAtMs, readyAtMs, abortRequestedAtMs,
        timeoutElapsedMs: mode === "timeout" ? termAtMs - record.spawnReturnedAtMs : undefined,
        abortToTermMs: mode === "abort" ? termAtMs - abortRequestedAtMs : undefined,
        termToKillMs: ignoresTerm ? record.signalEvents[1].atMs - termAtMs : undefined,
        wholeCallMs: performance.now() - start, timerResolutionMs };
      t.diagnostic(JSON.stringify({ result, signals: record.signals, signalEvents: record.signalEvents, timing: record.timing }));
      assert.equal(fs.readFileSync(term, "utf8"), "TERM");
      assert.deepEqual(result, { stdout: "READY", stderr: "", code: 0, killed: true, truncated: false });
      assert.deepEqual(record.signals, ignoresTerm ? ["SIGTERM", "SIGKILL"] : ["SIGTERM"]);
      assert.equal(record.child.signalCode, ignoresTerm ? "SIGKILL" : null);
      if (mode === "timeout") assert.ok(record.timing.timeoutElapsedMs >= options.timeout - timerResolutionMs, "The configured timeout must elapse before TERM, separately from escalation");
      if (ignoresTerm) assertEscalationInterval(record.signalEvents);
    });
  }
}

test("consumers: actual GitHub CI and theme helpers safely reject real target failure results without new budgets", async t => {
  const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")));
  const jiti = createJiti(import.meta.url, { alias: { typebox: join(modules, "typebox/build/index.mjs") }, fsCache: false, moduleCache: false });
  const { createQueries } = await jiti.import(join(repository, "agent/extensions/github-ci/github.ts"));
  const { execOutput } = await jiti.import(join(repository, "agent/extensions/theme-overrides/system-commands.ts"));
  const payload = JSON.stringify({ status: "completed", conclusion: "success", attempt: 1, jobs: [] });
  const success = (await execute(`process.stdout.write(${JSON.stringify(payload)});`)).result;
  const control = createQueries({ exec: async () => success });
  assert.equal((await control.queryRun("owner/repo", 42, new AbortController().signal)).status, "completed");
  assert.deepEqual(await control.queryFailureSummary("owner/repo", 42, new AbortController().signal), { jobs: [], omittedJobs: 0 });
  assert.deepEqual(await execOutput({ exec: async () => success }, "synthetic-theme-probe", []), { stdout: payload, stderr: "", code: 0 });
  const nonzero = (await execute(`process.stdout.write(${JSON.stringify(payload)}); process.exitCode = 23;`)).result;
  const controller = new AbortController();
  const killed = (await execute(`process.on('SIGTERM', () => process.exit(0)); process.stdout.write(${JSON.stringify(payload)}); setInterval(() => {}, 1000);`, { signal: controller.signal }, async record => {
    await waitFor(() => Buffer.concat(record.stdout).toString() === payload);
    controller.abort();
  })).result;
  const gate = join(scratch, "valid-json-overflow-release");
  const truncated = (await execute(`
    import fs from 'node:fs';
    process.on('SIGTERM', () => process.exit(0));
    fs.writeSync(1, ${JSON.stringify(payload)});
    const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(gate)})) { clearInterval(timer); fs.writeSync(2, 'overflow'); } }, 5);
  `, { maxBuffer: Buffer.byteLength(payload) }, async record => {
    await waitFor(() => Buffer.concat(record.stdout).toString() === payload);
    fs.writeFileSync(gate, "release");
  })).result;
  for (const result of [nonzero, killed, truncated]) assert.equal(result.stdout, success.stdout, "Valid identical JSON must fail because of execution flags, not JSON parsing");
  assert.deepEqual([nonzero.code, killed.code, killed.killed, truncated.truncated], [23, 0, true, true]);
  assert.deepEqual(await execOutput({ exec: async () => nonzero }, "synthetic-theme-probe", [], { allowNonZero: true }), { stdout: payload, stderr: "", code: 23 });
  const failures = results.filter(result => result.code !== 0 || result.killed);
  assert.ok(failures.some(result => result.killed && result.code === 0));
  assert.ok(failures.some(result => result.truncated));
  assert.ok(failures.some(result => result.stderr.includes("ENOENT")));
  for (const result of failures) {
    const exec = async (command, _args, options) => {
      assert.ok(["gh", "synthetic-theme-probe"].includes(command));
      assert.equal(options.maxBuffer, undefined, "Do not add production output budgets");
      return result;
    };
    const queries = createQueries({ exec });
    for (const query of [queries.queryRun, queries.queryFailureSummary]) {
      await assert.rejects(query("owner/repo", 42, new AbortController().signal), error => error.message === "github_ci_wait: gh query failed.");
    }
    assert.equal(await execOutput({ exec }, "synthetic-theme-probe", []), undefined);
    // The existing opt-in is intentional: even it must reject killed results.
    if (result.killed) assert.equal(await execOutput({ exec }, "synthetic-theme-probe", [], { allowNonZero: true }), undefined);
  }
  t.diagnostic(`${failures.length} real failure results replayed through both production consumers; no gh or OS appearance probe executed`);
});

// Keep the CLI fixture inline. Generated extensions, guard, HOME and sessions
// live only under the writable report root, never in source or the target graph.
const guard = join(scratch, "rpc-guard.mjs");
fs.writeFileSync(guard, `
  import fs from 'node:fs';
  import cp from 'node:child_process';
  import net from 'node:net';
  import http from 'node:http';
  import https from 'node:https';
  import dns from 'node:dns';
  import { syncBuiltinESMExports } from 'node:module';
  const forbidden = [];
  const report = process.env.C3_CASE_DIR + '/guard.json';
  const save = () => fs.writeFileSync(report, JSON.stringify({ forbidden }));
  const deny = name => () => { forbidden.push(name); save(); throw Error('C3 child forbidden: ' + name); };
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = deny(name);
  cp.ChildProcess.prototype.spawn = deny('ChildProcess.spawn');
  net.Socket.prototype.connect = deny('socket.connect');
  net.Server.prototype.listen = deny('server.listen');
  for (const module of [http, https]) for (const name of ['request', 'get']) module[name] = deny(name);
  for (const module of [dns, dns.promises]) for (const name of Object.keys(module)) if (/^(lookup|resolve|reverse)/.test(name)) module[name] = deny('dns.' + name);
  globalThis.fetch = deny('fetch'); globalThis.WebSocket = deny('WebSocket');
  syncBuiltinESMExports();
  // Do not install signal listeners: an extra listener would mask the default
  // OS termination if a broken target removed its real shutdown handler.
  const emit = process.emit;
  process.emit = function(name, ...args) {
    const result = Reflect.apply(emit, this, [name, ...args]);
    if (['SIGTERM', 'SIGHUP'].includes(name)) fs.writeFileSync(process.env.C3_CASE_DIR + '/handled-' + name, 'handled');
    return result;
  };
  save(); process.on('exit', save);
`);
const extension = join(scratch, "rpc-extension.ts");
fs.writeFileSync(extension, `
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  const dir = process.env.C3_CASE_DIR;
  const waitGate = async name => {
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(dir + '/' + name)) {
      assert.ok(Date.now() < deadline, 'C3 fixture gate expired: ' + name);
      await new Promise(r => setTimeout(r, 5));
    }
  };
  export default function(pi) {
    let ctx, watchdog, stopped = false;
    const mark = message => {
      fs.appendFileSync(dir + '/markers.jsonl', JSON.stringify(message) + '\\n');
      ctx.ui.notify(message, 'info');
    };
    pi.registerProvider('c3-synthetic', {
      baseUrl: 'https://c3.invalid', apiKey: 'c3-synthetic-not-a-credential', api: 'openai-completions',
      models: [{ id: 'synthetic', name: 'C3 synthetic', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 32 }],
      streamSimple() { mark('forbidden-inference'); throw Error('C3 must not infer'); },
    });
    pi.on('before_agent_start', () => { mark('forbidden-agent-start'); throw Error('C3 commands must be handled without inference'); });
    pi.on('session_start', (_event, context) => {
      ctx = context;
      assert.equal(ctx.mode, 'rpc');
      assert.equal(pi.getSettings().cacheWarming, 'off');
      assert.equal(ctx.sessionManager.getSessionFile(), undefined);
      process.stdin.on('end', () => mark('stdin-end'));
      watchdog = setTimeout(() => { mark('fixture-deadline'); process.exit(92); }, 25000);
      mark('session-ready');
      if (process.env.C3_SCENARIO === 'idle') void (async () => {
        await waitGate('idle-trigger');
        if (stopped) return;
        assert.equal(ctx.isIdle(), true);
        mark('idle-shutdown-request'); ctx.shutdown();
      })();
    });
    pi.registerCommand('c3-shutdown', { handler: async (_args, context) => {
      context.shutdown(); mark('command-shutdown-request');
      assert.equal(await context.ui.confirm('c3-release-command', 'Synthetic command gate'), true);
      mark('command-return');
    } });
    pi.on('session_shutdown', async event => {
      assert.equal(event.reason, 'quit');
      stopped = true;
      mark('cleanup-start');
      if (!['idle', 'command'].includes(process.env.C3_SCENARIO)) await waitGate('cleanup-release');
      mark('cleanup-complete'); clearTimeout(watchdog);
    });
  }
`);

async function rpcCase(t, cli, scenario, drive) {
  const dir = fs.mkdtempSync(join(scratch, `${scenario}-`));
  for (const name of ["home", "agent", "sessions", "cache", "config", "data", "tmp", "cwd"]) fs.mkdirSync(join(dir, name), { mode: 0o700 });
  fs.writeFileSync(join(dir, "agent/settings.json"), JSON.stringify({ cacheWarming: "off", packages: [], extensions: [], defaultProjectTrust: "never", enableInstallTelemetry: false }));
  const env = { ...process.env, HOME: join(dir, "home"), PI_CODING_AGENT_DIR: join(dir, "agent"),
    XDG_CACHE_HOME: join(dir, "cache"), XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data"), TMPDIR: join(dir, "tmp"),
    PI_OFFLINE: "1", PI_CACHE_WARMING: "off", PI_SKIP_VERSION_CHECK: "1", C3_CASE_DIR: dir, C3_SCENARIO: scenario };
  const child = childProcess.spawn(node, ["--import", guard, cli, "--mode", "rpc", "--no-session", "--session-dir", join(dir, "sessions"),
    "--offline", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools", "--no-approve",
    "--provider", "c3-synthetic", "--model", "synthetic", "-e", extension], { env, cwd: join(dir, "cwd"), stdio: ["pipe", "pipe", "pipe"] });
  const record = records.at(-1);
  const events = [];
  let buffer = "", protocolError;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    if (buffer.length > 256 * 1024) protocolError = Error("Synthetic RPC output exceeded fixture bound");
    for (let newline; (newline = buffer.indexOf("\n")) !== -1;) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      try { events.push(JSON.parse(line)); }
      catch (error) { protocolError = error; }
    }
  });
  child.stdin.on("error", error => { protocolError = error; });
  const send = command => child.stdin.write(JSON.stringify(command) + "\n");
  const waitEvent = async predicate => {
    await waitFor(() => {
      if (protocolError) throw protocolError;
      if (events.some(predicate)) return true;
      assert.ok(alive(record), `RPC exited before marker; stderr: ${Buffer.concat(record.stderr).toString()}`);
      return false;
    });
    return events.find(predicate);
  };
  const marker = name => waitEvent(event => event.type === "extension_ui_request" && event.method === "notify" && event.message === name);
  const response = id => waitEvent(event => event.type === "response" && event.id === id);
  const release = name => fs.writeFileSync(join(dir, name), "release");
  const handled = signal => waitFor(() => {
    if (fs.existsSync(join(dir, `handled-${signal}`))) return true;
    assert.ok(alive(record), "RPC must retain its real signal handler throughout cleanup");
    return false;
  });
  const messages = () => events.filter(event => event.type === "extension_ui_request" && event.method === "notify").map(event => event.message);
  try {
    await marker("session-ready");
    send({ id: "ready", type: "get_state" });
    const ready = await response("ready");
    assert.equal(ready.success, true);
    assert.equal(ready.data.isStreaming, false);
    assert.equal(ready.data.sessionFile, undefined);
    assert.equal(ready.data.model.provider, "c3-synthetic");
    const expectedCode = await drive({ child, record, events, send, marker, response, release, messages, waitEvent, handled });
    const exit = await within(record.closed);
    assert.deepEqual(exit, { code: expectedCode, signal: null });
    assert.equal(protocolError, undefined);
    assert.equal(buffer, "", "Drain complete JSONL records before accepting exit");
    assert.deepEqual(json(join(dir, "guard.json")), { forbidden: [] });
    assert.deepEqual(fs.readdirSync(join(dir, "sessions")), [], "No persistent sessions are needed");
    assert.ok(!events.some(event => ["extension_error", "agent_start", "message_start"].includes(event.type)));
    assert.ok(!messages().some(message => /forbidden|deadline/.test(message)));
    assert.equal(messages().filter(message => message === "cleanup-start").length, 1);
    const summary = { cli: relative(piRoot, cli), scenario, exit, markers: messages(), responses: events.filter(event => event.type === "response").map(({ id, command, success, data }) => ({ id, command, success, disposition: data?.disposition })), signals: record.signals };
    fs.writeFileSync(join(dir, "result.json"), JSON.stringify(summary, null, 2) + "\n");
    t.diagnostic(JSON.stringify(summary));
  } finally {
    if (owned.has(record)) {
      // This fixture owns only its direct synthetic CLI child. First unblock
      // cleanup and EOF; use a single last-resort kill only after that fails.
      release("cleanup-release"); release("idle-trigger"); child.stdin.end();
      try { await within(record.closed); } catch { await reap(record); }
    }
  }
}

for (const [variant, cli] of [["unbundled", process.env.PI_TEST_CHILD_PI], ["bundled", process.env.PI_TEST_CHILD_PI_BUNDLED]]) {
  test(`RPC ${variant}: idle ctx.shutdown exits without another command or stdin EOF`, { timeout: 20000 }, async t => {
    await rpcCase(t, cli, "idle", async ({ child, marker, release, messages }) => {
      release("idle-trigger");
      await marker("cleanup-complete");
      assert.equal(child.stdin.writableEnded, false);
      assert.deepEqual(messages(), ["session-ready", "idle-shutdown-request", "cleanup-start", "cleanup-complete"]);
      return 0;
    });
  });

  test(`RPC ${variant}: shutdown command writes its pending prompt response before cleanup and exit`, { timeout: 20000 }, async t => {
    await rpcCase(t, cli, "command", async ({ record, events, send, waitEvent, response, marker, messages }) => {
      send({ id: "shutdown-prompt", type: "prompt", message: "/c3-shutdown" });
      const dialog = await waitEvent(event => event.type === "extension_ui_request" && event.method === "confirm");
      assert.equal(dialog.title, "c3-release-command");
      assert.equal(alive(record), true);
      assert.equal(messages().includes("cleanup-start"), false);
      assert.equal(events.some(event => event.type === "response" && event.id === "shutdown-prompt"), false);
      send({ type: "extension_ui_response", id: dialog.id, confirmed: true });
      const reply = await response("shutdown-prompt");
      assert.equal(reply.success, true);
      assert.deepEqual(reply.data, { disposition: "handled" });
      await marker("cleanup-complete");
      const position = predicate => events.findIndex(predicate);
      assert.ok(position(event => event.message === "command-return") < events.indexOf(reply));
      assert.ok(events.indexOf(reply) < position(event => event.message === "cleanup-start"));
      return 0;
    });
  });

  for (const signal of ["SIGTERM", "SIGHUP"]) {
    test(`RPC ${variant}: stdin EOF then one ${signal} preserves held cleanup and the EOF exit code`, { timeout: 20000 }, async t => {
      await rpcCase(t, cli, "eof-signal", async ({ child, record, marker, release, messages, handled }) => {
        child.stdin.end();
        await marker("cleanup-start");
        assert.equal(child.kill(signal), true);
        await handled(signal);
        assert.equal(alive(record), true);
        assert.equal(messages().includes("cleanup-complete"), false);
        release("cleanup-release");
        await marker("cleanup-complete");
        return 0;
      });
    });
  }

  test(`RPC ${variant}: signal-started shutdown also tolerates stdin EOF during held cleanup`, { timeout: 20000 }, async t => {
    await rpcCase(t, cli, "signal-eof", async ({ child, marker, release, messages, handled }) => {
      assert.equal(child.kill("SIGTERM"), true);
      await marker("cleanup-start");
      child.stdin.end();
      await marker("stdin-end");
      await handled("SIGTERM");
      assert.equal(messages().includes("cleanup-complete"), false);
      release("cleanup-release");
      await marker("cleanup-complete");
      return 143;
    });
  });

  test(`RPC ${variant}: a second signal exits immediately without releasing held cleanup`, { timeout: 20000 }, async t => {
    await rpcCase(t, cli, "second-signal", async ({ child, record, marker, messages, handled }) => {
      child.stdin.end();
      await marker("cleanup-start");
      assert.equal(child.kill("SIGTERM"), true);
      await handled("SIGTERM");
      assert.equal(alive(record), true);
      assert.equal(child.kill("SIGHUP"), true);
      await within(record.closed, 8000);
      assert.equal(messages().includes("cleanup-complete"), false, "Exit must not wait for the unreleased cleanup gate");
      return 129;
    });
  });
}
