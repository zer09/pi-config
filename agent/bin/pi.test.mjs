import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const wrapper = join(dirname(fileURLToPath(import.meta.url)), "pi");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-theme-wrapper-"));
  const home = join(root, "home");
  const agentDir = join(root, "agent root");
  const realPi = join(home, ".bun", "bin", "pi");
  mkdirSync(dirname(realPi), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    realPi,
    `console.log(JSON.stringify({ args: process.argv.slice(2), injected: process.env.PI_THEME_WRAPPER_INJECTED }));\n`,
  );
  chmodSync(realPi, 0o755);
  const env = {
    ...process.env,
    HOME: home,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_THEME_WRAPPER_INJECTED: "stale-parent-value",
  };
  return { root, home, agentDir, env };
}

function run(env, args) {
  const result = spawnSync("bash", [wrapper, ...args], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

function assertUnchanged(actual, args) {
  assert.deepEqual(actual.args, args);
  assert.equal(actual.injected, undefined);
}

function assertAutomatic(actual, args) {
  if (actual.injected === undefined) {
    assert.deepEqual(actual.args, args, "a host without Windows appearance evidence should keep argv unchanged");
    return;
  }
  assert.equal(actual.injected, "1");
  assert.deepEqual(actual.args.slice(0, 2), ["--use-theme", actual.args[1]]);
  assert.ok(actual.args[1] === "light" || actual.args[1] === "dark");
  assert.deepEqual(actual.args.slice(2), args);
}

test("normal startup injects a write-free initial theme and preserves argv", () => {
  const f = fixture();
  try {
    const settings = join(f.agentDir, "settings.json");
    writeFileSync(settings, '{"theme":"dark","sentinel":"unchanged"}\n');
    chmodSync(settings, 0o640);
    const before = { bytes: readFileSync(settings), stat: statSync(settings) };
    const args = ["--name", "session with spaces", "@file with spaces.md", "explain auth list update"];

    assertAutomatic(run(f.env, args), args);

    const after = statSync(settings);
    assert.deepEqual(readFileSync(settings), before.bytes);
    assert.equal(after.mode & 0o777, before.stat.mode & 0o777);
    assert.equal(after.mtimeMs, before.stat.mtimeMs);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("an explicit use-theme wins and every original argument stays in order", () => {
  const f = fixture();
  try {
    const args = [
      "--theme", "/tmp/custom theme.json",
      "--use-theme", "dark",
      "--use-theme", "light",
      "@file with spaces.md",
      "--",
      "--print",
      "auth list update",
    ];
    assertUnchanged(run(f.env, args), args);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("management and non-interactive invocations bypass theme selection exactly", () => {
  const f = fixture();
  try {
    const cases = [
      ["auth", "check", "--provider", "fixture"],
      ["update"],
      ["install", "npm:fixture@1.0.0"],
      ["remove", "npm:fixture@1.0.0"],
      ["uninstall", "npm:fixture@1.0.0"],
      ["config"],
      ["list"],
      ["--version"],
      ["--help"],
      ["--list-models", "fixture"],
      ["--export", "input.jsonl", "output.html"],
      ["--print", "hello"],
      ["--mode", "json"],
      ["--mode=rpc"],
      ["--mode", "--print", "hello"],
    ];
    for (const args of cases) assertUnchanged(run(f.env, args), args);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("option values and prompt text that resemble commands do not cause bypass", () => {
  const f = fixture();
  try {
    for (const args of [
      ["--name", "--print", "hello"],
      ["--name", "auth", "tell me to list update"],
      ["--", "--print", "auth", "list", "update"],
    ]) {
      assertAutomatic(run(f.env, args), args);
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("disabled startup and missing or invalid settings never create or rewrite settings", () => {
  const f = fixture();
  try {
    const settings = join(f.agentDir, "settings.json");
    const args = ["hello"];
    assertAutomatic(run(f.env, args), args);
    assert.equal(existsSync(settings), false);

    writeFileSync(settings, "{ invalid json\n");
    const before = readFileSync(settings);
    assertAutomatic(run(f.env, args), args);
    assert.deepEqual(readFileSync(settings), before);

    assertUnchanged(run({ ...f.env, PI_THEME_WRAPPER_DISABLE: "1" }, args), args);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("concurrent automatic startups do not race on config state", async () => {
  const f = fixture();
  try {
    const settings = join(f.agentDir, "settings.json");
    writeFileSync(settings, '{"theme":"dark","sentinel":1}\n');
    const before = readFileSync(settings);
    const launch = (index) => new Promise((resolve, reject) => {
      const child = spawn("bash", [wrapper, `prompt ${index}`], { env: f.env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(stderr)));
    });

    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => launch(index)));
    results.forEach((result, index) => assertAutomatic(result, [`prompt ${index}`]));
    assert.deepEqual(readFileSync(settings), before);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
