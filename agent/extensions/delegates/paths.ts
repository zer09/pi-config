import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

import { DELEGATE_SESSION_DIR_NAME } from "./constants.ts";

export function getAgentRoot(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

const MAX_CWD_SESSION_DIR_NAME_BYTES = 200;

function hashedCwdSessionDirName(resolvedCwd: string): string {
	return `--cwd-${createHash("sha256").update(resolvedCwd).digest("hex")}--`;
}

export function cwdSessionDirName(cwd: string): string {
	const resolvedCwd = path.resolve(cwd);
	const name = `--${encodeURIComponent(resolvedCwd)}--`;
	if (Buffer.byteLength(name, "utf8") <= MAX_CWD_SESSION_DIR_NAME_BYTES) return name;
	return hashedCwdSessionDirName(resolvedCwd);
}

export function getReaderSessionDir(cwd: string, agentRoot = getAgentRoot()): string {
	return path.join(agentRoot, DELEGATE_SESSION_DIR_NAME, "reader", cwdSessionDirName(cwd));
}

export function getWriterSessionBaseDir(cwd: string, agentRoot = getAgentRoot()): string {
	return path.join(agentRoot, DELEGATE_SESSION_DIR_NAME, "writer", cwdSessionDirName(cwd));
}
