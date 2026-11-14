import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use explicit Pi 1.5.2 bindings inside an OS-network-denied sandbox, never PATH.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modules = process.env.PI_TEST_NODE_MODULES;
assert.ok(modules && isAbsolute(modules), "Explicit isolated host required");
assert.equal(fs.realpathSync(modules), modules);
assert.ok(!modules.startsWith("/home/gc/.bun/") && !modules.startsWith("/home/gc/.pi/"));
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const piRoot = join(modules, "@earendil-works/pi-coding-agent");
assert.equal(json(join(piRoot, "package.json")).version, "1.5.2");
for (const name of ["pi-ai", "pi-agent-core", "pi-tui", "pi-schema"]) {
  assert.equal(json(join(modules, "@earendil-works", name, "package.json")).version, "1.5.2", name);
}
assert.equal(process.env.PI_OFFLINE, "1");
assert.equal(process.env.PI_CACHE_WARMING, "off");
assert.equal(process.env.PI_TEST_CHILD_NODE, process.execPath);
assert.equal(process.env.PI_TEST_CHILD_PI, join(piRoot, "dist/cli.js"));
const output = process.env.PI_TEST_OUTPUT_DIR;
assert.ok(output && isAbsolute(output));
for (const name of ["HOME", "TMPDIR", "PI_CODING_AGENT_DIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]) {
  assert.ok(process.env[name]?.startsWith(`${output}/`), `${name} must be synthetic`);
}
assert.equal(json(join(process.env.PI_CODING_AGENT_DIR, "settings.json")).cacheWarming, "off");
assert.ok(process.env.PI_TEST_PARENT_NET_NS);
assert.notEqual(fs.readlinkSync("/proc/self/ns/net"), process.env.PI_TEST_PARENT_NET_NS);
assert.equal(fs.existsSync("/home/gc/.pi"), false, "Real HOME must be hidden");

const forbidden = [];
const deny = name => () => {
  forbidden.push(name);
  throw new Error(`C4 transport forbidden: ${name}`);
};
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = deny(name);
childProcess.ChildProcess.prototype.spawn = deny("ChildProcess.spawn");
net.Socket.prototype.connect = deny("socket.connect");
net.Server.prototype.listen = deny("server.listen");
globalThis.fetch = deny("fetch");
globalThis.WebSocket = deny("WebSocket");

const fixture = fs.mkdtempSync(join(output, "fixtures-"));
fs.chmodSync(fixture, 0o700);
const evidence = { runtime: process.version, host: piRoot, fixture, prompts: [], reads: [], streams: [], bufferReads: [], forbidden };
const originalReadSync = fs.readFileSync;
const originalReadFile = fsp.readFile;
const originalOpen = fsp.open;
const growAfterStat = new Map();
const excludedPrompt = join(repository, "agent/prompts/codegraph-upgrade.md");
fs.readFileSync = function (file, ...args) {
  const name = file instanceof URL ? fileURLToPath(file) : String(file);
  if (name === excludedPrompt) return deny("excluded prompt read")();
  return originalReadSync.call(this, file, ...args);
};
fsp.readFile = function (file, ...args) {
  if (String(file).startsWith(`${fixture}/`)) evidence.bufferReads.push(String(file));
  return originalReadFile.call(this, file, ...args);
};
fsp.open = async function (file, ...args) {
  const handle = await originalOpen.call(this, file, ...args);
  if (!String(file).startsWith(`${fixture}/`)) return handle;
  const stat = handle.stat.bind(handle);
  const stream = handle.createReadStream.bind(handle);
  const close = handle.close.bind(handle);
  let record;
  handle.stat = async (...values) => {
    const result = await stat(...values);
    const tail = growAfterStat.get(String(file));
    if (tail !== undefined) {
      growAfterStat.delete(String(file));
      fs.appendFileSync(file, tail);
    }
    return result;
  };
  handle.createReadStream = options => {
    record = { file: String(file), end: options.end, autoClose: options.autoClose, chunks: [], closed: false };
    evidence.streams.push(record);
    const result = stream(options);
    const iterator = result[Symbol.asyncIterator].bind(result);
    // Observe real native chunks without changing their bytes or chunk sizes.
    result[Symbol.asyncIterator] = async function* () {
      for await (const chunk of { [Symbol.asyncIterator]: iterator }) {
        record.chunks.push(chunk.length);
        yield chunk;
      }
    };
    return result;
  };
  handle.close = async (...values) => {
    const result = await close(...values);
    if (record) record.closed = true;
    return result;
  };
  return handle;
};
syncBuiltinESMExports();
after(() => {
  fs.writeFileSync(join(fixture, "execution.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  fs.readFileSync = originalReadSync;
  fsp.readFile = originalReadFile;
  fsp.open = originalOpen;
  syncBuiltinESMExports();
  assert.deepEqual(forbidden, [], "Even swallowed transport or retired-prompt attempts fail");
  assert.ok(evidence.streams.every(stream => stream.closed), "Native file handles must close");
});
const target = file => import(pathToFileURL(join(piRoot, file)));
const { parseCommandArgs, substituteArgs, expandPromptTemplate } = await target("dist/core/prompt-templates.js");
const { DefaultResourceLoader } = await target("dist/core/resource-loader.js");
const { SettingsManager } = await target("dist/core/settings-manager.js");
const { createReadTool } = await target("dist/core/tools/read.js");
const aiRoot = join(modules, "@earendil-works/pi-ai");
const { validateToolArguments } = await import(pathToFileURL(join(aiRoot, json(join(aiRoot, "package.json")).exports["."].import)));
const settings = json(join(repository, "agent/settings.json"));

// Resolve real local templates through the target loader and current exclusions.
// Packages declare no prompts. Do not reconcile packages or load executable resources.
assert.equal(settings.cacheWarming, "off");
assert.deepEqual(settings.prompts, ["-prompts/codegraph-upgrade.md"]);
const cwd = join(fixture, "cwd");
fs.mkdirSync(cwd);
const loader = new DefaultResourceLoader({
  cwd, agentDir: join(repository, "agent"),
  settingsManager: SettingsManager.inMemory({ ...settings, packages: [], defaultProjectTrust: "never" }),
  noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true,
});
await loader.reload();
const discovered = loader.getPrompts();
const templates = discovered.prompts;

test("discovery: current exclusions load only three real active templates and no executable resources", () => {
  assert.deepEqual(discovered.diagnostics, []);
  assert.deepEqual(templates.map(template => template.name).sort(), ["codex-review", "ts-split-module", "ts-split-scope"]);
  assert.deepEqual(loader.getExtensions().extensions, []);
  assert.deepEqual(loader.getExtensions().errors, []);
  for (const template of templates) {
    assert.equal(template.filePath, join(repository, "agent/prompts", `${template.name}.md`));
    assert.equal(template.sourceInfo.scope, "user");
    const placeholders = [...new Set(template.content.match(/\$\{[^}]*\}|\$(?:ARGUMENTS|@|\d+)/g))].sort();
    const expected = template.name === "ts-split-module" ? ["$1", "${@:2}"] : ["$ARGUMENTS"];
    assert.deepEqual(placeholders, expected, "Configured placeholders are not synthetic defaults");
  }
  assert.equal(expandPromptTemplate("/unknown x", templates), "/unknown x");
  assert.equal(expandPromptTemplate("not a command", templates), "not a command");
});

const argumentCases = [
  ["apostrophes", "src/doesn't.ts -- don't change API", ["src/doesn't.ts", "--", "don't", "change", "API"]],
  ["double quoted empty", '"" next.ts', ["", "next.ts"]],
  ["single quoted empty", "'' next.ts", ["", "next.ts"]],
  ["only empty", '""', [""]],
  ["two empties", '"" \'\'', ["", ""]],
  ["unmatched double quote", '"src/a.ts tail', ['"src/a.ts', "tail"]],
  ["unmatched single quote", "'src/a.ts tail", ["'src/a.ts", "tail"]],
  ["escaped matching quotes", String.raw`"say \"hi\"" 'it\'s fine'`, ['say "hi"', "it's fine"]],
  ["midword quotes stay literal", 'src/ab"cd.ts pre"two words"', ['src/ab"cd.ts', 'pre"two', 'words"']],
  ["whitespace and quoted path", ' \t"src/a b.ts"\t --\n"keep  API"  ', ["src/a b.ts", "--", "keep  API"]],
  ["other backslashes stay literal", String.raw`"C:\src\a.ts" one\ two`, [String.raw`C:\src\a.ts`, "one\\", "two"]],
  ["placeholder values stay literal", '"$1 $@ $ARGUMENTS ${@:2}" tail', ["$1 $@ $ARGUMENTS ${@:2}", "tail"]],
  ["missing arguments", "", []],
  ["whitespace only", " \t\n ", []],
];
for (const [label, raw, expectedArgs] of argumentCases) {
  test(`prompts: target parser, substitution and all active expansions preserve ${label}`, () => {
    assert.deepEqual(parseCommandArgs(raw), expectedArgs);
    const all = expectedArgs.join(" ");
    assert.equal(substituteArgs("$1|$2|$@|$ARGUMENTS|${@:2}", parseCommandArgs(raw)),
      [expectedArgs[0] ?? "", expectedArgs[1] ?? "", all, all, expectedArgs.slice(1).join(" ")].join("|"));
    for (const template of templates) {
      const values = { $ARGUMENTS: all, $1: expectedArgs[0] ?? "", "${@:2}": expectedArgs.slice(1).join(" ") };
      const expected = template.content.replace(/\$ARGUMENTS|\$\{@:2\}|\$1/g, placeholder => values[placeholder]);
      const expanded = expandPromptTemplate(`/${template.name} ${raw}`, templates);
      assert.equal(expanded, expected, template.name);
      evidence.prompts.push({ label, name: template.name, raw, parsed: expectedArgs, insertedAll: all });
    }
  });
}

test("substitution: synthetic positional, all-args, slices and defaults are single-pass, not template adoption", () => {
  const args = ["", "two words", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  assert.equal(substituteArgs("$1|$2|$10|$11|$0", args), "|two words|ten||");
  assert.equal(substituteArgs("${@:2}|${@:2:2}|${@:0:2}|${@:3:0}|${@:20}", args),
    "two words three four five six seven eight nine ten|two words three| two words||");
  assert.equal(substituteArgs("${1:-first}|${2:-second}|${11:-last}", args), "first|two words|last");
  const defaults = "${1:-one}|${@:-all}|${ARGUMENTS:-everything}";
  assert.equal(substituteArgs(defaults, []), "one|all|everything");
  assert.equal(substituteArgs(defaults, [""]), "one|all|everything");
  assert.equal(substituteArgs(defaults, ["", ""]), "one| | ", "Joined empty arguments still contain a space");
  assert.equal(substituteArgs("${1:-$2}|${@:-$ARGUMENTS}|${ARGUMENTS:-$@}", []), "$2|$ARGUMENTS|$@");
  assert.equal(substituteArgs("$1|$@|$ARGUMENTS|${@:1}", ["$2 $@ $ARGUMENTS"]),
    Array(4).fill("$2 $@ $ARGUMENTS").join("|"));
});

test("scope wording: expanded text loses quoting boundaries but preserves separator and ambiguity gates", () => {
  const template = templates.find(template => template.name === "ts-split-scope");
  const raw = '"src/a b.ts"   src/c.ts -- "don\'t change  API"';
  const expanded = expandPromptTemplate(`/ts-split-scope ${raw}`, templates);
  assert.ok(expanded.includes("EXPANDED ARGUMENTS\nsrc/a b.ts src/c.ts -- don't change  API\n"));
  assert.ok(!expanded.includes("RAW ARGUMENTS"));
  assert.match(template.content, /Pi has already parsed the arguments and joined them with spaces, so original quoting boundaries are lost\./);
  assert.match(template.content, /if the expanded text leaves the scope ambiguous, ask for clarification rather than guessing\./);
  assert.ok(template.content.includes("If `--` is present, treat everything before `--` as the scope and everything after it as task-specific instructions/constraints."));
  assert.match(template.content, /If no scope was provided, ask me whether to target the whole project or a specific scope/);
  assert.match(template.content, /If the scope resolves to zero TypeScript files, or looks like ordinary instruction text rather than a path\/glob\/dir\/package, stop and ask for the scope\./);
});

const read = createReadTool(fixture);
const validate = args => validateToolArguments(read, { type: "toolCall", id: "c4", name: "read", arguments: args });
const put = (name, text) => {
  const file = join(fixture, name);
  fs.writeFileSync(file, text, { mode: 0o600 });
  return file;
};
const textFile = put("utf8.txt", "\uFEFFalpha\ncafé 🧪\n\ncrlf\r\n尾\nlast");
async function expectRead(args, expected, signal) {
  const input = structuredClone(args);
  const decoded = validate(args);
  assert.deepEqual(args, input, "Schema coercion must not mutate transcript arguments");
  const result = await read.execute("c4", decoded, signal);
  assert.deepEqual(result.content, [{ type: "text", text: expected }]);
  assert.equal(result.structuredContent, expected);
  evidence.reads.push({ args, decoded, result });
  return result;
}

test("native read: streaming UTF-8 ranges, coercion, empty/trailing lines and continuation offsets", async () => {
  assert.equal(read.parameters.properties.offset.type, "number");
  assert.equal(read.parameters.properties.limit.type, "number");
  assert.deepEqual(validate({ path: textFile, offset: "2", limit: "2" }), { path: textFile, offset: 2, limit: 2 });
  assert.equal((await expectRead({ path: "utf8.txt", offset: "2", limit: "2" }, "café 🧪\n\n\n[3 more lines in file. Use offset=4 to continue.]")).details, undefined);
  await expectRead({ path: textFile, offset: 4, limit: 2 }, "crlf\r\n尾\n\n[1 more lines in file. Use offset=6 to continue.]");
  await expectRead({ path: textFile, offset: 6, limit: 8 }, "last");
  await expectRead({ path: textFile }, "\uFEFFalpha\ncafé 🧪\n\ncrlf\r\n尾\nlast");
  await expectRead({ path: textFile, offset: "0", limit: "1" }, "\uFEFFalpha\n\n[5 more lines in file. Use offset=2 to continue.]");
  await expectRead({ path: textFile, offset: 2, limit: "0" }, "\n\n[5 more lines in file. Use offset=2 to continue.]");
  await expectRead({ path: put("trailing.txt", "one\n二\n"), offset: 3 }, "");
  await expectRead({ path: put("empty.txt", "") }, "");
  assert.deepEqual(evidence.bufferReads, [], "Normal ranges must never load the whole file");
});

test("native read: a real UTF-8 chunk boundary and opened-size boundary exclude appended text", async t => {
  // Put the first byte of a four-byte character at the end of Node's 64 KiB chunk.
  const prefix = `${"x".repeat(65533)}\n`;
  const file = put("boundary.txt", `${prefix}A🧪Z\n尾\nlast`);
  const initialSize = fs.statSync(file).size;
  growAfterStat.set(file, "\nappended-after-stat");
  await expectRead({ path: file, offset: "2", limit: "1" }, "A🧪Z\n\n[2 more lines in file. Use offset=3 to continue.]");
  const stream = evidence.streams.find(record => record.file === file);
  assert.deepEqual(stream.chunks, [65536, initialSize - 65536]);
  assert.equal(stream.end, initialSize - 1);
  assert.equal(stream.autoClose, false);
  assert.equal(stream.closed, true);
  assert.ok(fs.statSync(file).size > initialSize, "The appended bytes exist on disk but are outside this read");
  assert.deepEqual(evidence.bufferReads, []);
  t.diagnostic(JSON.stringify({ initialSize, afterAppendSize: fs.statSync(file).size, stream }));
  await expectRead({ path: file, offset: 5 }, "appended-after-stat");
});

test("native read: line and byte caps report exact shown ranges, details and continuation", async () => {
  const lines = Array.from({ length: 2002 }, (_, index) => `L${index + 1}`);
  const file = put("line-cap.txt", lines.join("\n"));
  const result = await expectRead({ path: file }, `${lines.slice(0, 2000).join("\n")}\n\n[Showing lines 1-2000 of 2002. Use offset=2001 to continue.]`);
  assert.equal(result.details.truncation.truncatedBy, "lines");
  assert.equal(result.details.truncation.outputLines, 2000);
  assert.equal(result.details.truncation.totalLines, 2002);
  assert.equal(result.details.truncation.totalBytes, Buffer.byteLength(lines.join("\n")));
  await expectRead({ path: file, offset: "2001" }, "L2001\nL2002");
  const wide = "é".repeat(12800);
  const byteCap = await expectRead({ path: put("byte-cap.txt", `${wide}\n${wide}\nend`) },
    `${wide}\n\n[Showing lines 1-1 of 3 (50.0KB limit). Use offset=2 to continue.]`);
  assert.equal(byteCap.details.truncation.truncatedBy, "bytes");
  assert.equal(byteCap.details.truncation.outputBytes, 25600);
  assert.equal(byteCap.details.truncation.totalBytes, 51205);
  const oversized = await expectRead({ path: put("oversized-line.txt", "é".repeat(25601)) },
    `[Line 1 is 50.0KB, exceeds 50.0KB limit. Use bash: sed -n '1p' ${join(fixture, "oversized-line.txt")} | head -c 51200]`);
  assert.equal(oversized.details.truncation.firstLineExceedsLimit, true);
  assert.equal(oversized.details.truncation.outputLines, 0);
  assert.deepEqual(evidence.bufferReads, []);
});

test("native read: invalid numeric inputs, beyond-EOF, missing files and cancellation reject", async () => {
  for (const property of ["offset", "limit"]) {
    assert.throws(() => validate({ path: textFile, [property]: "not-a-number" }), new RegExp(`${property}: expected number, got string`));
  }
  await assert.rejects(read.execute("c4", validate({ path: textFile, offset: "7" })), { message: "Offset 7 is beyond end of file (6 lines total)" });
  await assert.rejects(read.execute("c4", validate({ path: join(fixture, "missing.txt") })), { code: "ENOENT" });
  await assert.rejects(read.execute("c4", validate({ path: textFile }), AbortSignal.abort()), { message: "Operation aborted" });
});

test("native read: schema-accepted unusual ranges retain the documented buffer fallback", async () => {
  assert.deepEqual(validate({ path: textFile, offset: "2.5", limit: "1" }), { path: textFile, offset: 2.5, limit: 1 });
  const before = evidence.streams.length;
  await expectRead({ path: textFile, offset: "2.5", limit: "1" }, "café 🧪\n\n[3.5 more lines in file. Use offset=3.5 to continue.]");
  await expectRead({ path: textFile, limit: "-1" }, "\uFEFFalpha\ncafé 🧪\n\ncrlf\r\n尾\n\n[7 more lines in file. Use offset=0 to continue.]");
  assert.equal(evidence.streams.length, before, "These number-schema values do not claim streaming");
  assert.deepEqual(evidence.bufferReads.map(file => relative(fixture, file)), ["utf8.txt", "utf8.txt"]);
});
