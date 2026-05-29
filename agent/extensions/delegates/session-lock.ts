import * as fs from "node:fs";
import * as path from "node:path";

import { redactSensitiveText } from "./redaction.ts";

export interface SessionLock {
	path: string;
	release(): Promise<void>;
}

function lockAgeMessage(lockPath: string): string {
	try {
		const stats = fs.statSync(lockPath);
		const ageSeconds = Math.max(0, Math.round((Date.now() - stats.mtimeMs) / 1000));
		return ` Lock age: ${ageSeconds}s.`;
	} catch {
		return "";
	}
}

async function readLockSummary(lockPath: string): Promise<string> {
	try {
		const raw = await fs.promises.readFile(lockPath, "utf8");
		const parsed = JSON.parse(raw) as { pid?: unknown; timestamp?: unknown; agent?: unknown };
		const parts = [
			typeof parsed.pid === "number" ? `pid ${parsed.pid}` : undefined,
			typeof parsed.timestamp === "string" ? `timestamp ${parsed.timestamp}` : undefined,
			typeof parsed.agent === "string" ? `agent ${redactSensitiveText(parsed.agent)}` : undefined,
		].filter(Boolean);
		return parts.length > 0 ? ` Existing lock metadata: ${parts.join(", ")}.` : "";
	} catch {
		return " Existing lock metadata could not be read.";
	}
}

export async function acquireContinuedReaderSessionLock(sessionDir: string, metadata: Record<string, unknown>): Promise<SessionLock> {
	await fs.promises.mkdir(sessionDir, { recursive: true });
	const lockPath = path.join(sessionDir, ".delegate-lock");
	let handle: fs.promises.FileHandle | undefined;
	try {
		handle = await fs.promises.open(lockPath, "wx");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(
				`reader continued session is already running for this sessionKey.${lockAgeMessage(lockPath)}${await readLockSummary(lockPath)} Delete the .delegate-lock file only if the session is known stale.`,
			);
		}
		throw error;
	}

	try {
		await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
		await handle.close();
		handle = undefined;
	} catch (error) {
		try {
			await handle?.close();
		} catch {
			/* ignore */
		}
		await fs.promises.rm(lockPath, { force: true });
		throw error;
	}

	return {
		path: lockPath,
		async release() {
			try {
				await fs.promises.unlink(lockPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		},
	};
}
