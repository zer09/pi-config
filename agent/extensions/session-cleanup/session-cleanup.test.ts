import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import sessionCleanupExtension, {
	DAY_MS,
	getCleanupPaths,
	isDelegateChild,
	isStampFresh,
	runSessionCleanup,
	shouldHandleReason,
	type CleanupPaths,
} from "./index.ts";

type TestFn = () => void | Promise<void>;
type ExecCall = { command: string; args: string[]; options?: { timeout?: number } };
type ExecResult = { stdout: string; stderr: string; code: number; killed: boolean };
type SessionStartHandler = (event: { reason: string }, ctx: unknown) => Promise<void>;

const tests: Array<{ name: string; fn: TestFn }> = [];
const OK: ExecResult = { stdout: "", stderr: "", code: 0, killed: false };

function test(name: string, fn: TestFn): void {
	tests.push({ name, fn });
}

function makeFakePi(handler: (call: ExecCall) => ExecResult | Promise<ExecResult>) {
	const calls: ExecCall[] = [];
	return {
		calls,
		pi: {
			exec: async (command: string, args: string[], options?: { timeout?: number }) => {
				const call = { command, args, options };
				calls.push(call);
				return handler(call);
			},
		},
	};
}

function makeTempPaths(): { home: string; paths: CleanupPaths; cleanup: () => void } {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "session-cleanup-test-"));
	const extensionDir = path.join(home, ".pi", "agent", "extensions", "session-cleanup");
	const paths = getCleanupPaths(home, extensionDir);
	fs.mkdirSync(path.dirname(paths.script), { recursive: true });
	fs.writeFileSync(paths.script, "#!/bin/bash\n", "utf8");
	return {
		home,
		paths,
		cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
	};
}

function execResult(patch: Partial<ExecResult> = {}): ExecResult {
	return { ...OK, ...patch };
}

function readLogLines(paths: CleanupPaths): string[] {
	return fs.readFileSync(paths.log, "utf8").trim().split(/\r?\n/);
}

function trackedCleanupPi(cleanupResult: ExecResult = OK) {
	return makeFakePi((call) => {
		if (call.command === "git" && call.args.includes("ls-files")) return OK;
		if (call.command === "git" && call.args.includes("status")) return OK;
		if (call.command === "bash") return cleanupResult;
		throw new Error(`Unexpected exec call: ${call.command} ${call.args.join(" ")}`);
	});
}

test("shouldHandleReason returns true only for startup", () => {
	assert.equal(shouldHandleReason("startup"), true);
	assert.equal(shouldHandleReason("reload"), false);
	assert.equal(shouldHandleReason("new"), false);
	assert.equal(shouldHandleReason("resume"), false);
	assert.equal(shouldHandleReason("fork"), false);
});

test("isDelegateChild returns true when PI_DELEGATE_CHILD is present", () => {
	assert.equal(isDelegateChild({}), false);
	assert.equal(isDelegateChild({ PI_DELEGATE_CHILD: "1" }), true);
	assert.equal(isDelegateChild({ PI_DELEGATE_CHILD: "true" }), true);
});

test("isStampFresh returns true for a timestamp less than 24 hours old", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-cleanup-stamp-"));
	try {
		const stamp = path.join(dir, "stamp");
		const now = Date.parse("2026-05-29T08:00:00.000Z");
		fs.writeFileSync(stamp, new Date(now - 60_000).toISOString(), "utf8");
		assert.equal(await isStampFresh(stamp, now), true);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("isStampFresh returns false for missing, invalid, or old stamps", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-cleanup-stamp-"));
	try {
		const stamp = path.join(dir, "stamp");
		const now = Date.parse("2026-05-29T08:00:00.000Z");
		assert.equal(await isStampFresh(stamp, now), false);

		fs.writeFileSync(stamp, "not a timestamp", "utf8");
		assert.equal(await isStampFresh(stamp, now), false);

		fs.writeFileSync(stamp, new Date(now - DAY_MS - 1).toISOString(), "utf8");
		assert.equal(await isStampFresh(stamp, now), false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("runSessionCleanup skips fresh stamps before acquiring a lock", async () => {
	const { paths, cleanup } = makeTempPaths();
	try {
		const now = Date.parse("2026-05-29T08:00:00.000Z");
		fs.mkdirSync(path.dirname(paths.stamp), { recursive: true });
		fs.writeFileSync(paths.stamp, new Date(now - 60_000).toISOString(), "utf8");
		const { pi, calls } = makeFakePi(() => {
			throw new Error("cleanup should not execute with a fresh stamp");
		});

		const outcome = await runSessionCleanup(pi, { paths, now: () => now });
		assert.equal(outcome.status, "skipped-fresh");
		assert.equal(calls.length, 0);
		assert.equal(fs.existsSync(paths.lockDir), false);
		assert.match(readLogLines(paths).at(-1) ?? "", /ts=2026-05-29T08:00:00\.000Z status=skipped-fresh duration_ms=0/);
	} finally {
		cleanup();
	}
});

test("runSessionCleanup skips when an active lock exists", async () => {
	const { paths, cleanup } = makeTempPaths();
	try {
		const now = Date.parse("2026-05-29T08:00:00.000Z");
		fs.mkdirSync(paths.lockDir, { recursive: true });
		fs.utimesSync(paths.lockDir, new Date(now), new Date(now));
		const { pi, calls } = makeFakePi(() => {
			throw new Error("cleanup should not execute when locked");
		});

		const outcome = await runSessionCleanup(pi, { paths, now: () => now });
		assert.equal(outcome.status, "skipped-lock");
		assert.equal(calls.length, 0);
	} finally {
		cleanup();
	}
});

test("runSessionCleanup removes stale locks and proceeds", async () => {
	const { paths, cleanup } = makeTempPaths();
	try {
		const now = Date.parse("2026-05-29T08:00:00.000Z");
		fs.mkdirSync(paths.lockDir, { recursive: true });
		fs.utimesSync(paths.lockDir, new Date(now - 2 * 60 * 60 * 1000), new Date(now - 2 * 60 * 60 * 1000));
		const { pi, calls } = trackedCleanupPi();

		const outcome = await runSessionCleanup(pi, { paths, now: () => now });
		assert.equal(outcome.status, "success");
		assert.equal(calls.at(-1)?.command, "bash");
		assert.equal(fs.existsSync(paths.lockDir), false);
		assert.equal(fs.existsSync(paths.stamp), true);
	} finally {
		cleanup();
	}
});

test("runSessionCleanup writes a new stamp after successful cleanup", async () => {
	const { paths, cleanup } = makeTempPaths();
	try {
		const now = Date.parse("2026-05-29T08:00:00.000Z");
		const { pi, calls } = trackedCleanupPi(execResult({
			stdout: [
				"Cleaning ignored session artifacts older than 30 days...",
				"Session files deleted: 2",
				"Session empty dirs removed: 1",
				"Session cleanup complete.",
				"",
			].join("\n"),
		}));

		const outcome = await runSessionCleanup(pi, { paths, now: () => now });
		assert.equal(outcome.status, "success");
		assert.equal(fs.readFileSync(paths.stamp, "utf8"), `${new Date(now).toISOString()}\n`);
		assert.deepEqual(calls.map((call) => call.command), ["git", "git", "bash"]);
		assert.deepEqual(calls[1].args, ["-C", paths.piDir, "status", "--porcelain", "--", "agent/extensions/session-cleanup/cleanup-sessions.sh"]);
		assert.deepEqual(calls[2].args, [paths.script, "--safe"]);
		assert.equal(fs.existsSync(paths.lockDir), false);
		const logLine = readLogLines(paths).at(-1) ?? "";
		assert.match(logLine, /ts=2026-05-29T08:00:00\.000Z status=success duration_ms=0 exit_code=0 killed=false session_files_deleted=2 session_empty_dirs_removed=1/);
		assert.doesNotMatch(logLine, /detail=/);
	} finally {
		cleanup();
	}
});

test("runSessionCleanup does not update the stamp after failed cleanup", async () => {
	const { paths, cleanup } = makeTempPaths();
	try {
		const { pi, calls } = trackedCleanupPi(execResult({ code: 1, stderr: "boom\n" }));

		const outcome = await runSessionCleanup(pi, { paths, now: () => Date.parse("2026-05-29T08:00:00.000Z") });
		assert.equal(outcome.status, "failed");
		assert.equal(outcome.result?.stderr, "boom\n");
		assert.equal(fs.existsSync(paths.stamp), false);
		assert.equal(calls.at(-1)?.command, "bash");
		assert.equal(fs.existsSync(paths.lockDir), false);
		assert.match(readLogLines(paths).at(-1) ?? "", /status=failed duration_ms=0 exit_code=1 killed=false detail="boom"/);
	} finally {
		cleanup();
	}
});

test("runSessionCleanup skips unsafe cleanup scripts", async () => {
	const { paths, cleanup } = makeTempPaths();
	try {
		const { pi, calls } = makeFakePi((call) => {
			if (call.command === "git" && call.args.includes("ls-files")) return execResult({ code: 1, stderr: "not tracked\n" });
			throw new Error(`Unexpected exec call: ${call.command} ${call.args.join(" ")}`);
		});

		const outcome = await runSessionCleanup(pi, { paths, now: () => Date.parse("2026-05-29T08:00:00.000Z") });
		assert.equal(outcome.status, "skipped-unsafe-script");
		assert.deepEqual(calls.map((call) => call.command), ["git"]);
		assert.equal(fs.existsSync(paths.stamp), false);
	} finally {
		cleanup();
	}
});

test("extension ignores non-startup session_start reasons", async () => {
	let handler: SessionStartHandler | undefined;
	const { pi, calls } = makeFakePi(() => {
		throw new Error("cleanup should not execute for reload");
	});

	sessionCleanupExtension({
		...pi,
		on: (name: string, callback: SessionStartHandler) => {
			if (name === "session_start") handler = callback;
		},
	} as never);

	assert.ok(handler);
	await handler({ reason: "reload" }, { hasUI: true, ui: { notify: () => undefined } });
	assert.equal(calls.length, 0);
});

test("extension skips delegate child startup before touching cleanup paths", async () => {
	let handler: SessionStartHandler | undefined;
	const { pi, calls } = makeFakePi(() => {
		throw new Error("cleanup should not execute for delegate children");
	});
	const previous = process.env.PI_DELEGATE_CHILD;

	try {
		process.env.PI_DELEGATE_CHILD = "1";
		sessionCleanupExtension({
			...pi,
			on: (name: string, callback: SessionStartHandler) => {
				if (name === "session_start") handler = callback;
			},
		} as never);

		assert.ok(handler);
		await handler({ reason: "startup" }, { hasUI: true, ui: { notify: () => undefined } });
		assert.equal(calls.length, 0);
	} finally {
		if (previous === undefined) {
			delete process.env.PI_DELEGATE_CHILD;
		} else {
			process.env.PI_DELEGATE_CHILD = previous;
		}
	}
});

async function main(): Promise<void> {
	let failed = 0;
	for (const { name, fn } of tests) {
		try {
			await fn();
			console.log(`ok ${name}`);
		} catch (error) {
			failed++;
			console.error(`FAIL ${name}`);
			console.error(error);
		}
	}

	if (failed > 0) {
		console.error(`${failed}/${tests.length} tests failed`);
		process.exit(1);
	}
	console.log(`${tests.length}/${tests.length} tests passed`);
}

await main();
