import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodeGraph } from "./codegraph-package.ts";
import { GraphManager } from "./graph-manager.ts";
import type { ExtensionAPI, ExtensionContext } from "./types.ts";
import { executeUpstreamExplore } from "./upstream-explore.ts";

const FIXTURE_SOURCE = `
export type AfterCommit = (events: readonly string[]) => void;

export class SessionClient {
  constructor(private readonly afterCommit: AfterCommit) {}

  appendTransaction(events: readonly string[]): void {
    this.afterCommit(events);
  }

  close(): void {}
}

export class SessionWorkerPool {
  registerSession(afterCommit: AfterCommit): SessionClient {
    return new SessionClient(afterCommit);
  }

  close(): void {}
}

export class SessionStoreManager {
  private readonly pool = new SessionWorkerPool();

  openSession(): SessionClient {
    return this.pool.registerSession((events) => this.observeCommit(events));
  }

  private observeCommit(_events: readonly string[]): void {}

  close(): void {
    this.pool.close();
  }
}
`;

test("runs full upstream Explore on the graph selected by GraphManager", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "pi-codegraph-explore-"));
  const sourcePath = path.join(projectRoot, "session-store-manager.ts");
  let manager: GraphManager | undefined;

  try {
    await writeFile(sourcePath, FIXTURE_SOURCE, "utf8");
    const initialized = await CodeGraph.init(projectRoot, { index: false });
    const indexed = await initialized.indexAll();
    assert.equal(indexed.success, true, indexed.errors.map((error) => error.message).join("; "));
    initialized.close();

    const pi = {
      exec: async () => ({ stdout: "", stderr: "", code: 1, killed: false }),
    } as ExtensionAPI;
    const ctx = {
      cwd: "/home/gc/.pi",
      hasUI: false,
      ui: {
        confirm: async () => {
          throw new Error("Initialized explicit project must not prompt");
        },
      },
    } as ExtensionContext;

    manager = new GraphManager({ pi });
    const ready = await manager.ensureReady(projectRoot, ctx);
    assert.equal(ready.ok, true);
    if (ready.ok === false) return;
    assert.equal(ready.root, projectRoot);

    const output = await executeUpstreamExplore(ready.cg, {
      query: "SessionStoreManager SessionWorkerPool.registerSession SessionClient afterCommit observeCommit close",
      maxFiles: 4,
    });

    assert.match(output, /\*\*Blast radius/);
    assert.match(output, /SessionStoreManager/);
    assert.match(output, /SessionClient/);
    assert.match(output, /registerSession/);
    assert.match(output, /afterCommit/);
    assert.match(output, /^\d+\t/m);
  } finally {
    await manager?.closeAll();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
