import assert from "node:assert/strict";
import { after } from "node:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactDir } from "./artifacts.ts";

/**
 * One owned artifact-parent sandbox per test process. Every directory this
 * process creates through createArtifactDir lands inside it, so assertions
 * and cleanup touch only paths this process owns; another test process or a
 * real delegate's `delegated-pi-*` artifacts are never visible to them.
 */
const ownedParent = await mkdtemp(path.join(os.tmpdir(), "delegate-artifact-parent-"));
process.env.PI_DELEGATE_ARTIFACT_PARENT = ownedParent;

after(async () => {
  delete process.env.PI_DELEGATE_ARTIFACT_PARENT;
  // Exact owned path only: never a sweep of the shared tmpdir.
  await rm(ownedParent, { recursive: true, force: true });
});

async function ownedArtifactDirs(): Promise<string[]> {
  const entries = await readdir(ownedParent);
  return entries
    .filter((entry) => entry.startsWith("delegated-pi-"))
    .map((entry) => path.join(ownedParent, entry));
}

async function removeOwnedArtifactDirs(): Promise<void> {
  for (const entry of await ownedArtifactDirs()) {
    await rm(entry, { recursive: true, force: true });
  }
}

test("a permission failure after mkdtemp rethrows the original error without a residual directory", async () => {
  const failure = new Error("chmod fault injection PRIVATE");
  try {
    await assert.rejects(
      () => createArtifactDir("solution-a", async () => {
        throw failure;
      }),
      (error: unknown) => {
        // The original permission error must surface unchanged, not a
        // replacement error from the best-effort cleanup.
        assert.equal(error, failure, "createArtifactDir must reject with the original chmod error");
        return true;
      },
    );
    // mkdtemp already created the directory inside the owned sandbox; the
    // failed permission step must not leave that half-initialized directory
    // behind.
    assert.deepEqual(await ownedArtifactDirs(), [], "a permission failure must not leave a residual artifact directory");
  } finally {
    // Only entries inside the owned sandbox, never the shared tmpdir.
    await removeOwnedArtifactDirs();
  }
});

test("the default permission step creates a private 0700 artifact directory", async () => {
  const directory = await createArtifactDir("review-a");
  try {
    assert.match(path.basename(directory), /^delegated-pi-review-a-/);
    assert.equal(path.dirname(directory), ownedParent, "the artifact must be created inside the injected parent");
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.deepEqual(await ownedArtifactDirs(), [], "the owned sandbox must be clean after exact-path removal");
});

test("a concurrently present foreign delegated-pi directory is never touched", async () => {
  // Simulates another test process or a real delegate whose artifacts live in
  // the shared tmpdir while this process runs and cleans its own artifacts.
  // The foreign directory is created and removed by exact path only.
  const foreign = path.join(os.tmpdir(), `delegated-pi-foreign-${process.pid}-${Date.now()}`);
  await mkdir(foreign, { mode: 0o700 });
  await writeFile(path.join(foreign, "sentinel.txt"), "foreign-owned");
  try {
    await assert.rejects(
      () => createArtifactDir("review-b", async () => {
        throw new Error("fault");
      }),
      /fault/,
    );
    await removeOwnedArtifactDirs();
    const completed = await createArtifactDir("review-c");
    await rm(completed, { recursive: true, force: true });
    // The foreign directory survived every owned-sandbox cleanup untouched.
    assert.equal(await readFile(path.join(foreign, "sentinel.txt"), "utf8"), "foreign-owned");
    await stat(foreign);
  } finally {
    await rm(foreign, { recursive: true, force: true });
  }
});

test("no test sweeps the shared tmpdir for delegated-pi artifacts", async () => {
  // A snapshot-and-delete sweep of os.tmpdir() races every concurrent test
  // process and every real delegate: it must never come back. Tests assert
  // and clean inside sandboxes they own or by exact path.
  const testFiles = [
    "artifacts.test.ts", "diagnostics.test.ts", "index.test.ts", "manager.test.ts",
    "monitor.test.ts", "protocol.test.ts", "result.test.ts", "routes.test.ts",
    "routing.test.ts", "runner.test.ts", "supervisor.test.ts",
  ];
  for (const file of testFiles) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    // Assembled from parts so this test's own source does not contain the
    // forbidden literal it scans for.
    const forbidden = ["readdir(os." + "tmpdir())", "readdirSync(os." + "tmpdir())"];
    for (const pattern of forbidden) {
      assert.ok(!source.includes(pattern), `${file} must not enumerate the shared tmpdir (${pattern})`);
    }
  }
});
