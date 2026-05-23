import * as os from "node:os";
import * as path from "node:path";

import { DELEGATE_SESSION_DIR_NAME } from "./constants.ts";

export function getAgentRoot(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

export function cwdSessionDirName(cwd: string): string {
	return `--${path.resolve(cwd).replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`;
}

export function getReaderSessionDir(cwd: string, agentRoot = getAgentRoot()): string {
	return path.join(agentRoot, DELEGATE_SESSION_DIR_NAME, "reader", cwdSessionDirName(cwd));
}

export function getWriterSessionBaseDir(cwd: string, agentRoot = getAgentRoot()): string {
	return path.join(agentRoot, DELEGATE_SESSION_DIR_NAME, "writer", cwdSessionDirName(cwd));
}
