import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";

/** Control receiving chunks without relying on how the OS splits child writes. */
export function interceptRpcStdout(
  t: TestContext,
  receive: (child: ChildProcess, chunk: Buffer, deliver: (chunk: Buffer) => void) => void,
): Buffer[] {
  const received: Buffer[] = [];
  const spawn = childProcess.spawn;
  const hook = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    if (args[1]?.includes("--mode") && args[1].includes("rpc")) {
      const stdout = child.stdout!;
      const emit = stdout.emit;
      t.mock.method(stdout, "emit", function (this: typeof stdout, event: string | symbol, ...values: unknown[]) {
        if (event !== "data") return emit.call(this, event, ...values);
        receive(child, values[0] as Buffer, (chunk) => {
          assert.ok(stdout.listeners("data").some((listener) => listener.name === "onStdoutData"),
            "controlled chunks must reach the supervisor's receiving handler");
          received.push(chunk);
          emit.call(stdout, "data", chunk);
        });
        return true;
      });
    }
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    hook.mock.restore();
    syncBuiltinESMExports();
  });
  return received;
}
