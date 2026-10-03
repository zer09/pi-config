import { spawn, execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parentPort } from "node:worker_threads";

function runSync(api, pids, mode = "tree", behavior = "resistant") {
  const commandArgs = [fileURLToPath(new URL("./sync-command.mjs", import.meta.url)), mode, pids, behavior];
  if (api === "execFileSync") execFileSync(process.execPath, commandArgs, { stdio: "ignore" });
  else spawnSync(process.execPath, commandArgs, { stdio: "ignore" });
}

if (process.env.CTX_FIXTURE_SYNC_STARTUP) {
  runSync(process.env.CTX_FIXTURE_SYNC_STARTUP, process.env.CTX_FIXTURE_SYNC_PIDS, "tree", process.env.CTX_FIXTURE_SYNC_BEHAVIOR);
}

if (process.env.CTX_FIXTURE_STARTUP_FILE) {
  writeFileSync(process.env.CTX_FIXTURE_STARTUP_FILE, "importing");
  await delay(1000);
}

async function handler(args) {
  if (args.mode === "bridge-error") {
    return new Promise((resolve) => {
      const child = spawn("/ctx-fixture-missing-executable", [], { stdio: ["ignore", "pipe", "pipe"] });
      child.on("error", (error) => resolve(JSON.stringify({ message: error.message, code: error.code, syscall: error.syscall })));
    });
  }
  if (args.mode === "bridge-output") {
    const child = spawn(process.execPath, ["-e", "process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),env:process.env.CTX_BRIDGE_VALUE})+'\\n');process.stdout.write(Buffer.alloc(300123,171));process.stderr.write(Buffer.alloc(310123,205));process.exitCode=7", "space argument", "=literal"], {
      cwd: args.cwd, env: { ...process.env, CTX_BRIDGE_VALUE: "space=value" }, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const events = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("exit", (code, signal) => events.push({ event: "exit", code, signal }));
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => {
        events.push({ event: "close", code, signal });
        resolve(JSON.stringify({ stdout: Buffer.concat(stdout).toString("base64"), stderr: Buffer.concat(stderr).toString("base64"), events }));
      });
    });
  }
  if (args.mode.startsWith("sync-")) {
    if (args.workerPid) writeFileSync(args.workerPid, String(process.pid));
    const api = args.mode === "sync-exec" ? "execFileSync" : "spawnSync";
    runSync(api, args.pids, args.leftover ? "leftover" : "tree", args.behavior ?? "resistant");
    if (args.fail) throw new Error("fixture failure after sync");
    return "sync result";
  }
  if (args.mode === "block") {
    writeFileSync(args.marker, "blocking");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
    return "unblocked";
  }
  if (args.mode === "crash") process.exit(17);
  if (args.mode === "throw") throw new Error("fixture failure");
  if (args.mode === "schema") return { content: [{ type: "text", text: String(args.limit) }] };
  const run = async (index) => {
    appendFileSync(args.marker, `${index}\n`);
    const commandArgs = [fileURLToPath(new URL("./command.mjs", import.meta.url)), args.mode, args.pids, String(args.duration ?? 800), args.control ?? ""];
    let child;
    if (args.log) {
      const command = [process.execPath, ...commandArgs].map((value) => JSON.stringify(value)).join(" ");
      child = spawn("/bin/sh", ["-c", `${command} > ${JSON.stringify(args.log)} 2>&1`], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } else {
      child = spawn(process.execPath, commandArgs, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    }
    return new Promise((resolve) => {
      child.once("error", (error) => { throw error; });
      child.once("close", () => resolve());
    });
  };
  if (["orphan", "throw-after-spawn", "bad-progress", "bad-protocol"].includes(args.mode)) {
    void run(0);
    await delay(100);
    if (args.mode === "throw-after-spawn") throw new Error("fixture failure after spawn");
    if (args.mode === "bad-progress") parentPort.postMessage({ type: "progress", value: { phase: "executing", started: -1 } });
    if (args.mode === "bad-protocol") parentPort.postMessage({ type: "unexpected" });
    if (args.mode === "orphan") return "orphan result";
    await delay(10000);
  }
  const count = args.count ?? 1;
  let next = 0;
  const queue = async () => { while (next < count) await run(next++); };
  await Promise.all(Array.from({ length: args.concurrency ?? 1 }, queue));
  if (args.mode === "index-block") {
    writeFileSync(args.blockMarker, "indexing");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  }
  return { content: [{ type: "text", text: "fixture result" }] };
}
export const REGISTERED_CTX_TOOLS = ["ctx_execute_file", "ctx_batch_execute", "ctx_search"].map((name) => ({
  name, config: { inputSchema: { parse: (args) => {
    if ("progressFiles" in args) throw new Error("wrapper-only progressFiles reached upstream");
    return { ...args, limit: Number(args.limit ?? 2) };
  } } }, handler,
}));
export async function withProjectDirOverride({ projectDir }, fn) {
  if (process.env.CONTEXT_MODE_PROJECT_DIR !== projectDir) throw new Error("project mismatch");
  return fn();
}
