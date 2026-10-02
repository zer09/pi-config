import { fork } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const [bundle, projectDir, mode, marker, pids, terminalAction, workerEntry] = process.argv.slice(2);
const worker = fork(workerEntry || fileURLToPath(new URL("../../src/worker.mjs", import.meta.url)), [], {
  env: { ...process.env, CONTEXT_MODE_PROJECT_DIR: projectDir, CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS: "1" },
  execArgv: [], detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore", "ipc"],
});
process.send({ workerPid: worker.pid });
process.on("message", (message) => { if (message === "disconnect") worker.disconnect(); });
worker.on("message", (message) => {
  if (workerEntry && ["launch-held", "progress", "owned"].includes(message?.type)) process.send(message);
  if (!terminalAction || !["result", "error"].includes(message?.type)) return;
  writeFileSync(marker, message.type);
  // Act inside the receipt callback, without waiting for the test host.
  if (terminalAction === "death") process.kill(process.pid, "SIGKILL");
  else worker.disconnect();
});
worker.send({ type: "invoke", bundle: pathToFileURL(bundle).href, projectDir, name: "ctx_batch_execute", args: { mode, marker, pids, duration: 10000, leftover: Boolean(terminalAction) } });
setInterval(() => {}, 1000);
