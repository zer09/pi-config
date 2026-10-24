import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Adapt only target identity and dependency bindings. The historical fixtures
// retain their package inventory, persistence, canary, ordering and race checks.
const here = dirname(fileURLToPath(import.meta.url));
const runtime = process.env.PI_BLACKHOLE_TEST_RUNTIME;
const installed = process.env.PI_BLACKHOLE_PACKAGE_ROOT;
const tarball = process.env.PI_BLACKHOLE_0_5_15_TARBALL;
assert.equal(process.env.PI_OFFLINE, "1");
for (const path of [runtime, installed, tarball]) {
  assert.ok(path && isAbsolute(path));
  assert.equal(realpathSync(path), path);
}
const root = mkdtempSync(join(tmpdir(), "lifecycle-0.5.15-"));
const archive = join(root, "pi-blackhole-0.5.15.tgz");
cpSync(tarball, archive);
assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), "b3c25b2e4d4b7970313a09ac4fa9c2a6c907dddaf88848c774cd2513f2d1d397");
const deps = join(runtime, "node_modules");
for (const kind of ["lifecycle", "queued-continuation", "session-replacement", "shutdown"]) {
  test(`Pi 1.4.0 / Blackhole 0.5.15: preserved ${kind} fixture`, { timeout: 180000 }, () => {
    let source = readFileSync(join(here, `port-0.5.9-${kind}.test.mjs`), "utf8");
    const replace = (before, after) => {
      assert.ok(source.includes(before), `missing fixture anchor: ${before}`);
      source = source.replaceAll(before, after);
    };
    replace("0.5.9", "0.5.15");
    replace("0_5_9", "0_5_15");
    replace("0.87.1", "1.4.0");
    replace("VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==", "XN4YnWrDZv9uq7BiX3PgvvsmMUp/k6/fwfSFunwZ4Z+K5BYw/OOwWi7Sl6u426x2XsAyrMkdpYh0kgzf+y0uyQ==");
    replace("files.size, 132", "files.size, 145");
    replace('const here = dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(here)};`);
    replace('const installed = join(repository, "agent/npm/node_modules/pi-blackhole");', `const installed = ${JSON.stringify(installed)};`);
    replace("/home/gc/.bun/install/global/node_modules", deps);
    replace('from "./reapply-', `from "${here}/reapply-`);
    replace("live patched 0.5.15", "isolated patched 0.5.15");
    const fixture = join(root, `${kind}.test.mjs`);
    writeFileSync(fixture, source);
    const env = { ...process.env, PI_BLACKHOLE_0_5_15_TARBALL: archive };
    // Each historical file owns its runner. Do not inherit the outer test worker marker.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", fixture], { cwd: root, env, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 165000 });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    writeFileSync(join(root, `${kind}.log`), output);
    console.log(output);
    assert.equal(result.status, 0, `${kind}: ${result.error?.message ?? output}`);
    assert.match(output, /pass 1/);
    assert.match(output, /fail 0/);
  });
}
