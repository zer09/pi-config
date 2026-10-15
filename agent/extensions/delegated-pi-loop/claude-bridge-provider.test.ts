import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activateBridge, type BridgeFactory } from "../claude-bridge-provider/delegate-entry.ts";

const loaderSource = fileURLToPath(new URL("../claude-bridge-provider/delegate-entry.ts", import.meta.url));

const fixtureRoots: string[] = [];

after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-claude-bridge-"));
  fixtureRoots.push(root);
  return root;
}

/** Records every registration; methods read `this`, so unbound calls would throw. */
function recordingPi() {
  const pi = {
    calls: [] as string[],
    registerProvider(name: string) {
      this.calls.push(`provider:${name}`);
    },
    registerTool(tool: { name: string }) {
      this.calls.push(`tool:${tool.name}`);
    },
    registerMcpServer(name: string) {
      this.calls.push(`mcp:${name}`);
    },
    registerCommand(name: string) {
      this.calls.push(`command:${name}`);
    },
    on(event: string) {
      this.calls.push(`on:${event}`);
    },
  };
  return { pi, api: pi as unknown as ExtensionAPI };
}

/** A loosely typed view so fakes can call any API name the real bridge might. */
type LooseApi = Record<string, (...args: unknown[]) => unknown>;

function silenceErrors(t: TestContext) {
  return t.mock.method(console, "error", () => {});
}

test("only provider and hook registrations reach Pi, after activation succeeds", async (t) => {
  const errors = silenceErrors(t);
  const { pi, api } = recordingPi();
  const bridge: BridgeFactory = (bridgeApi) => {
    const loose = bridgeApi as unknown as LooseApi;
    loose.on!("session_start");
    loose.registerProvider!("claude-bridge");
    loose.registerTool!({ name: "AskClaude" });
    loose.registerMcpServer!("extra");
    loose.registerCommand!("extra");
    // Nothing is committed while the bridge is still activating.
    assert.deepEqual(pi.calls, []);
  };
  await activateBridge(api, async () => bridge, await tempDir());
  assert.deepEqual(pi.calls, ["on:session_start", "provider:claude-bridge"]);
  assert.equal(errors.mock.callCount(), 0);
});

test("an asynchronous bridge factory is awaited before registrations commit", async () => {
  const { pi, api } = recordingPi();
  const bridge: BridgeFactory = async (bridgeApi) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    (bridgeApi as unknown as LooseApi).registerProvider!("claude-bridge");
  };
  await activateBridge(api, async () => bridge, await tempDir());
  assert.deepEqual(pi.calls, ["provider:claude-bridge"]);
});

test("registrations made after activation go straight to Pi", async () => {
  const { pi, api } = recordingPi();
  let kept: LooseApi | undefined;
  await activateBridge(api, async () => (bridgeApi) => {
    kept = bridgeApi as unknown as LooseApi;
  }, await tempDir());
  // The bridge registers its provider from a session_start handler when
  // another bridge instance already loaded in the same process.
  kept!.registerProvider!("claude-bridge");
  kept!.registerTool!({ name: "AskClaude" });
  assert.deepEqual(pi.calls, ["provider:claude-bridge"]);
});

for (const [label, bridge] of [
  ["synchronous", ((bridgeApi) => {
    (bridgeApi as unknown as LooseApi).on!("session_start");
    (bridgeApi as unknown as LooseApi).registerProvider!("claude-bridge");
    throw new TypeError("Cannot read properties of null (reading 'startupNoticeShown')");
  }) as BridgeFactory],
  ["asynchronous", (async (bridgeApi) => {
    (bridgeApi as unknown as LooseApi).registerProvider!("claude-bridge");
    await Promise.resolve();
    throw new Error("late failure");
  }) as BridgeFactory],
] as const) {
  test(`a ${label} activation failure after partial registration registers nothing`, async (t) => {
    const errors = silenceErrors(t);
    const { pi, api } = recordingPi();
    let kept: LooseApi | undefined;
    await activateBridge(api, async () => (bridgeApi) => {
      kept = bridgeApi as unknown as LooseApi;
      return bridge(bridgeApi);
    }, await tempDir());
    // A handler the failed bridge left behind must not register later either.
    kept!.registerProvider!("claude-bridge");
    assert.deepEqual(pi.calls, []);
    assert.equal(errors.mock.callCount(), 1);
    assert.match(String(errors.mock.calls[0]!.arguments[0]), /^claude-bridge-provider: pi-claude-bridge activation failed/);
  });
}

test("a non-Error throw produces one bounded diagnostic line", async (t) => {
  const errors = silenceErrors(t);
  const { pi, api } = recordingPi();
  await activateBridge(api, async () => () => {
    throw "x".repeat(5000);
  }, await tempDir());
  assert.deepEqual(pi.calls, []);
  assert.equal(errors.mock.callCount(), 1);
  const line = String(errors.mock.calls[0]!.arguments[0]);
  assert.match(line, /^claude-bridge-provider: pi-claude-bridge activation failed \(x+/);
  assert.ok(line.length <= 300, `diagnostic length ${line.length}`);
});

test("a registration that throws during replay undoes earlier ones and returns normally", async (t) => {
  const errors = silenceErrors(t);
  const undone: string[] = [];
  const calls: string[] = [];
  const pi = {
    on(event: string) {
      calls.push(`on:${event}`);
      return () => undone.push(`off:${event}`);
    },
    registerProvider(name: string) {
      if (name === "broken") throw new Error("provider rejected");
      calls.push(`provider:${name}`);
    },
    unregisterProvider(name: string) {
      undone.push(`unregister:${name}`);
    },
  };
  let kept: LooseApi | undefined;
  await activateBridge(pi as unknown as ExtensionAPI, async () => (bridgeApi) => {
    kept = bridgeApi as unknown as LooseApi;
    kept.on!("session_start");
    kept.registerProvider!("claude-bridge");
    kept.registerProvider!("broken");
  }, await tempDir());
  assert.deepEqual(calls, ["on:session_start", "provider:claude-bridge"]);
  assert.deepEqual(undone, ["unregister:claude-bridge", "off:session_start"]);
  // The bridge's retained API stays disabled after the failure.
  kept!.registerProvider!("claude-bridge");
  assert.equal(calls.length, 2);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0]!.arguments[0]), /^claude-bridge-provider: claude-bridge registration failed \(provider rejected\)$/);
});

test("rollback unregisters a native provider object by id, not display name", async (t) => {
  silenceErrors(t);
  const registered = new Set<string>();
  const pi = {
    registerProvider(first: string | { id: string; name: string }) {
      const id = typeof first === "string" ? first : first.id;
      if (id === "broken") throw new Error("provider rejected");
      registered.add(id);
    },
    unregisterProvider(id: string) {
      registered.delete(id);
    },
  };
  await activateBridge(pi as unknown as ExtensionAPI, async () => (bridgeApi) => {
    const loose = bridgeApi as unknown as LooseApi;
    loose.registerProvider!({ id: "native-id", name: "Display Name" });
    loose.registerProvider!("string-id", {});
    loose.registerProvider!("broken", {});
  }, await tempDir());
  assert.deepEqual([...registered], []);
});

test("held hook registrations keep the unsubscribe contract", async () => {
  const active = new Set<string>();
  const pi = {
    on(event: string) {
      active.add(event);
      return () => active.delete(event);
    },
  };
  let afterReplay: (() => void) | undefined;
  await activateBridge(pi as unknown as ExtensionAPI, async () => (bridgeApi) => {
    const loose = bridgeApi as unknown as LooseApi;
    // Unsubscribed before commit: never reaches Pi.
    (loose.on!("cancelled") as () => void)();
    afterReplay = loose.on!("kept") as () => void;
  }, await tempDir());
  assert.deepEqual([...active], ["kept"]);
  // Unsubscribed after commit: removed from Pi.
  afterReplay!();
  assert.deepEqual([...active], []);
});

test("registrations made while replaying keep their order", async () => {
  const calls: string[] = [];
  let api: LooseApi | undefined;
  const pi = {
    on(event: string) {
      calls.push(`on:${event}`);
      // A registration made from inside replay is queued behind the rest.
      if (event === "first") api!.on!("nested");
      return () => {};
    },
  };
  await activateBridge(pi as unknown as ExtensionAPI, async () => (bridgeApi) => {
    api = bridgeApi as unknown as LooseApi;
    api.on!("first");
    api.on!("second");
  }, await tempDir());
  assert.deepEqual(calls, ["on:first", "on:second", "on:nested"]);
});

class HostileMessageError extends Error {
  override get message(): string {
    throw new Error("message getter failed");
  }
}

for (const [label, makeError] of [
  ["a null-prototype object", () => Object.create(null)],
  ["an object whose toString throws", () => ({ toString() { throw new Error("toString failed"); } })],
  ["an Error whose message getter throws", () => new HostileMessageError()],
] as const) {
  test(`throwing ${label} still produces one diagnostic and returns normally`, async (t) => {
    const errors = silenceErrors(t);
    const { pi, api } = recordingPi();
    await activateBridge(api, async () => () => {
      throw makeError();
    }, await tempDir());
    assert.deepEqual(pi.calls, []);
    assert.equal(errors.mock.callCount(), 1);
    assert.equal(
      String(errors.mock.calls[0]!.arguments[0]),
      "claude-bridge-provider: pi-claude-bridge activation failed (unprintable error)",
    );
  });
}

test("a multi-line error message is reported on one line", async (t) => {
  const errors = silenceErrors(t);
  const { api } = recordingPi();
  await activateBridge(api, async () => () => {
    throw new Error("first\nsecond\rthird\u2028fourth\u0007");
  }, await tempDir());
  const line = String(errors.mock.calls[0]!.arguments[0]);
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  assert.match(line, /first second third fourth/);
});

test("a project .pi/claude-bridge.json skips the bridge entirely", async (t) => {
  const errors = silenceErrors(t);
  const cwd = await tempDir();
  await mkdir(path.join(cwd, ".pi"));
  await writeFile(path.join(cwd, ".pi", "claude-bridge.json"), '{ "provider": { "strictMcpConfig": false } }\n');
  const { pi, api } = recordingPi();
  let loaded = false;
  await activateBridge(api, async () => {
    loaded = true;
    return () => {};
  }, cwd);
  assert.equal(loaded, false);
  assert.deepEqual(pi.calls, []);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0]!.arguments[0]), /project \.pi\/claude-bridge\.json found/);
});

test("a missing pi-claude-bridge package leaves the child running without the provider", async (t) => {
  // A copy of the entry with no package beside it resolves the real relative
  // import path to nothing. Loading the real package is verified with live
  // Pi catalog checks, because Node cannot strip types under node_modules.
  const root = await tempDir();
  const loaderDir = path.join(root, "agent", "extensions", "claude-bridge-provider");
  await mkdir(loaderDir, { recursive: true });
  const loaderPath = path.join(loaderDir, "delegate-entry.ts");
  await copyFile(loaderSource, loaderPath);
  const errors = silenceErrors(t);
  const entry = (await import(pathToFileURL(loaderPath).href)) as { default: (pi: ExtensionAPI) => Promise<void> };
  const { pi, api } = recordingPi();
  await entry.default(api);
  assert.deepEqual(pi.calls, []);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0]!.arguments[0]), /^claude-bridge-provider: cannot load pi-claude-bridge/);
});
