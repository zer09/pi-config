import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

import { DELEGATE_SESSION_DIR_NAME } from "./constants.ts";

export function getAgentRoot(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

const MAX_SESSION_DIR_NAME_BYTES = 200;

function hashedCwdSessionDirName(resolvedCwd: string): string {
	return `--cwd-${createHash("sha256").update(resolvedCwd).digest("hex")}--`;
}

function hashedDelegateSegment(kind: "agent" | "session", value: string): string {
	return `--${kind}-${createHash("sha256").update(value).digest("hex")}--`;
}

export function cwdSessionDirName(cwd: string): string {
	const resolvedCwd = path.resolve(cwd);
	const name = `--${encodeURIComponent(resolvedCwd)}--`;
	if (Buffer.byteLength(name, "utf8") <= MAX_SESSION_DIR_NAME_BYTES) return name;
	return hashedCwdSessionDirName(resolvedCwd);
}

function safeDelegateSegment(kind: "agent" | "session", value: string): string {
	const trimmed = value.trim();
	if (trimmed === "") throw new Error(`${kind} session segment must be a non-empty string`);
	const name = `--${encodeURIComponent(trimmed)}--`;
	if (Buffer.byteLength(name, "utf8") <= MAX_SESSION_DIR_NAME_BYTES) return name;
	return hashedDelegateSegment(kind, trimmed);
}

export function agentSessionDirName(value: string): string {
	return safeDelegateSegment("agent", value);
}

export function sessionKeyDirName(value: string): string {
	return safeDelegateSegment("session", value);
}

export function getReaderSessionBaseDir(cwd: string, agentRoot = getAgentRoot()): string {
	return path.join(agentRoot, DELEGATE_SESSION_DIR_NAME, "reader", cwdSessionDirName(cwd));
}

export function getFreshReaderSessionBaseDir(cwd: string, agentRoot = getAgentRoot()): string {
	return getReaderSessionBaseDir(cwd, agentRoot);
}

export function getContinuedReaderSessionDir(cwd: string, agent: string, sessionKey: string, agentRoot = getAgentRoot()): string {
	return path.join(getReaderSessionBaseDir(cwd, agentRoot), "continued", agentSessionDirName(agent), sessionKeyDirName(sessionKey));
}

export function getReaderSessionDir(cwd: string, agentRoot = getAgentRoot()): string {
	return getReaderSessionBaseDir(cwd, agentRoot);
}

export function getWriterSessionBaseDir(cwd: string, agentRoot = getAgentRoot()): string {
	return path.join(agentRoot, DELEGATE_SESSION_DIR_NAME, "writer", cwdSessionDirName(cwd));
}
