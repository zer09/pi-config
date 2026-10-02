import { readdirSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

export function signalOwned(pid, signal) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export function ownedIsAlive(pid) {
  if (process.platform === "linux") {
    // A dead grandchild can remain a zombie under the system's init process.
    // It cannot execute; do not confuse that with a surviving command.
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (Number(fields[2]) === pid && fields[0] !== "Z" && fields[0] !== "X") return true;
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
      }
    }
    return false;
  }
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export async function cleanupOwned(pids) {
  const live = () => [...pids].filter(ownedIsAlive);
  for (const pid of live()) signalOwned(pid, "SIGTERM");
  const grace = Date.now() + 200;
  while (live().length && Date.now() < grace) await delay(20);
  for (const pid of live()) signalOwned(pid, "SIGKILL");
  const deadline = Date.now() + 1500;
  while (live().length && Date.now() < deadline) await delay(20);
  if (live().length) throw new Error("Context Mode cleanup failed: owned processes remain alive");
}
