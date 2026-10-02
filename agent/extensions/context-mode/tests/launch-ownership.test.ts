import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fork, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { invokeWorker } from "../src/worker-client.js";
import { cleanupOwned, ownedIsAlive } from "../src/process-cleanup.mjs";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
const bundle = pathToFileURL(resolve(fixtures, "server.bundle.mjs")).href;
let dir: string;
let env: NodeJS.ProcessEnv;
let groups: Set<number>;
let processes: ReturnType<typeof spawn>[];
const pids = () => existsSync(resolve(dir, "pids")) ? readFileSync(resolve(dir, "pids"), "utf8").trim().split("\n").map(Number) : [];
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("launch test deadline expired");
    await delay(10);
  }
}
beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "ctx-launch-test-"));
  env = { ...process.env, CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS: "1", CONTEXT_MODE_PROJECT_DIR: dir, CONTEXT_MODE_DIR: resolve(dir, "store"), PI_CONFIG_DIR: dir, HOME: dir };
  groups = new Set();
  processes = [];
});
afterEach(async () => {
  await cleanupOwned(new Set([...groups, ...pids()]));
  await Promise.all(processes.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exit = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGKILL");
    await exit;
  }));
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "linux")("launch ownership boundary", () => {
  it.each(["cancel", "disconnect", "death"])("cleans the real command group before launch acknowledgment on %s", async (action) => {
    const sentinel = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: "ignore" });
    processes.push(sentinel);
    groups.add(sentinel.pid!);
    let workerPid = 0;
    let heldPid = 0;
    const published: number[] = [];
    const started: number[] = [];
    const entry = resolve(fixtures, "launch-owner.mjs");
    const parent = action === "cancel"
      ? fork(entry, [], { env, execArgv: [], detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] })
      : fork(resolve(fixtures, "parent.mjs"), [resolve(fixtures, "server.bundle.mjs"), dir, "tree", resolve(dir, "started"), resolve(dir, "pids"), "", entry], { env, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] });
    processes.push(parent);
    if (action === "cancel") { workerPid = parent.pid!; groups.add(workerPid); }
    parent.on("message", (packet: any) => {
      if (packet.workerPid) { workerPid = packet.workerPid; groups.add(workerPid); }
      if (packet.type === "owned") { published.push(packet.pid); groups.add(packet.pid); }
      if (packet.type === "launch-held") heldPid = packet.pid;
      if (packet.type === "progress") started.push(packet.value.started);
    });
    if (action === "cancel") parent.send({ type: "invoke", bundle, projectDir: dir, name: "ctx_batch_execute", args: { mode: "tree", marker: resolve(dir, "started"), pids: resolve(dir, "pids"), duration: 10000 } });
    await waitFor(() => heldPid > 0 && pids().length === 2);
    expect(published).toEqual([heldPid]);
    expect(pids()[0]).toBe(heldPid);
    expect(ownedIsAlive(heldPid)).toBe(true);
    expect(started.length).toBeGreaterThan(0);
    expect(started.every((count) => count === 0)).toBe(true);
    if (action === "cancel") parent.send({ type: "cancel" });
    else if (action === "disconnect") parent.send("disconnect");
    else parent.kill("SIGKILL");
    await waitFor(() => !ownedIsAlive(workerPid) && !ownedIsAlive(heldPid));
    // ownedIsAlive checks every non-zombie member, including the TERM-resistant grandchild.
    expect(ownedIsAlive(heldPid)).toBe(false);
    expect(ownedIsAlive(sentinel.pid!)).toBe(true);
    if (action === "disconnect") expect(parent.exitCode).toBeNull();
    expect(started.every((count) => count === 0)).toBe(true);
  }, 10000);

  it("leaves zero live survivors in 200 immediate executing-phase cancellations", async () => {
    const command = resolve(fixtures, "command.mjs");
    const survivors = new Set<number>();
    for (let index = 0; index < 200; index++) {
      const controller = new AbortController();
      const pending = invokeWorker(bundle, dir, "ctx_batch_execute", { mode: "silent", duration: 9235, marker: "/dev/null", pids: "/dev/null" }, env, {
        signal: controller.signal,
        onUpdate: (update) => {
          const progress = update.details!.progress as { phase: string; started: number };
          if (progress.phase === "executing" && progress.started === 0) controller.abort();
        },
      });
      await expect(pending).rejects.toThrow("cancelled");
      await delay(300);
      const live = new Set<number>();
      for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const argv = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
          if (argv[1] !== command || argv[2] !== "silent" || argv[3] !== "/dev/null" || argv[4] !== "9235") continue;
          const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
          const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          if (!["Z", "X"].includes(fields[0])) live.add(Number(fields[2]));
        } catch (error) {
          if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code!)) throw error;
        }
      }
      for (const pid of live) { survivors.add(pid); groups.add(pid); }
      // Clean a regression survivor immediately, not only after the assertion.
      await cleanupOwned(live);
    }
    expect(survivors.size).toBe(0);
  }, 150000);
});
