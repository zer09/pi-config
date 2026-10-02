import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const [mode, pids, behavior] = process.argv.slice(2);
if (behavior === "resistant") process.on("SIGTERM", () => {});
appendFileSync(pids, `${process.pid}\n`);
if (mode !== "descendant") {
  spawn(process.execPath, [new URL(import.meta.url).pathname, "descendant", pids, behavior], { stdio: "ignore" });
}
if (mode === "leftover") {
  // Return only after the ordinary descendant has installed its signal handler.
  const ready = setInterval(() => {
    if (readFileSync(pids, "utf8").trim().split("\n").length === 2) process.exit(0);
  }, 10);
  ready.unref();
}
setTimeout(() => process.exit(0), 10000);
