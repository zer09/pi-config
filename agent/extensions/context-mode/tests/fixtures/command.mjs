import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const [mode, pids, duration] = process.argv.slice(2);
appendFileSync(pids, `${process.pid}\n`);
if (mode === "tree") {
  process.on("SIGTERM", () => {});
  spawn(process.execPath, [new URL(import.meta.url).pathname, "descendant", pids, duration], { stdio: "ignore" });
}
if (mode === "descendant") process.on("SIGTERM", () => {});
let output;
if (mode === "productive") output = setInterval(() => process.stdout.write("fixture output\n"), 70);
setTimeout(() => { clearInterval(output); process.exit(0); }, Number(duration));
