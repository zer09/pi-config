import { spawn } from "node:child_process";

import { DELEGATE_CHILD_MARKER, DELEGATE_KIND_ENV, STDERR_TAIL_BYTES } from "./constants.ts";
import { applyJsonEventLine, emptyEventState } from "./json-events.ts";
import type { ChildProcessResult } from "./types.ts";

function appendTail(current: string, next: string, maxBytes: number): string {
	const combined = current + next;
	const buffer = Buffer.from(combined, "utf8");
	if (buffer.byteLength <= maxBytes) return combined;
	return buffer.subarray(buffer.byteLength - maxBytes).toString("utf8");
}

function killChild(proc: ReturnType<typeof spawn>): void {
	if (proc.exitCode !== null || proc.signalCode !== null) return;
	try {
		proc.kill("SIGTERM");
	} catch {
		return;
	}
	setTimeout(() => {
		if (proc.exitCode === null && proc.signalCode === null) {
			try {
				proc.kill("SIGKILL");
			} catch {
				/* ignore */
			}
		}
	}, 5_000).unref?.();
}

export async function runChildProcess(
	invocation: { command: string; args: string[] },
	cwd: string,
	signal: AbortSignal | undefined,
	timeoutMs: number,
	onChildEvent?: () => void,
	kind: "reader" | "writer" = "reader",
	extraEnv: Record<string, string> = {},
): Promise<ChildProcessResult> {
	const state = emptyEventState();
	let stderrTail = "";
	let lineBuffer = "";
	let forcedStatus: ChildProcessResult["status"] | undefined;

	if (signal?.aborted) return { status: "aborted", exitCode: null, stderrTail: "", state };

	return await new Promise((resolve) => {
		let settled = false;
		const proc = spawn(invocation.command, invocation.args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...extraEnv, [DELEGATE_CHILD_MARKER]: "1", [DELEGATE_KIND_ENV]: kind },
		});

		const timeout = setTimeout(() => {
			forcedStatus = "timeout";
			killChild(proc);
		}, timeoutMs);
		timeout.unref?.();

		const abortHandler = () => {
			forcedStatus = "aborted";
			killChild(proc);
		};
		if (signal) signal.addEventListener("abort", abortHandler, { once: true });

		const finish = (result: ChildProcessResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (signal) signal.removeEventListener("abort", abortHandler);
			resolve(result);
		};

		proc.stdout?.on("data", (chunk) => {
			lineBuffer += chunk.toString("utf8");
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				applyJsonEventLine(line, state);
				onChildEvent?.();
			}
		});

		proc.stderr?.on("data", (chunk) => {
			stderrTail = appendTail(stderrTail, chunk.toString("utf8"), STDERR_TAIL_BYTES);
		});

		proc.on("error", (error) => {
			finish({ status: forcedStatus ?? "failed", exitCode: null, stderrTail, error: error.message, state });
		});

		proc.on("close", (code) => {
			if (lineBuffer.trim()) applyJsonEventLine(lineBuffer, state);
			const hasModelError = state.stopReason === "error" || state.stopReason === "aborted" || Boolean(state.errorMessage);
			const status = forcedStatus ?? (code === 0 && !hasModelError ? "completed" : "failed");
			finish({ status, exitCode: code, stderrTail, state });
		});
	});
}
