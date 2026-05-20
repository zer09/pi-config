import * as os from "node:os";
import * as path from "node:path";

import { DELEGATE_SESSION_DIR_NAME } from "./constants.ts";

export function getAgentRoot(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

export function cwdSessionSegments(cwd: string): string[] {
	const resolved = path.resolve(cwd);
	const root = path.parse(resolved).root;
	const relative = path.relative(root, resolved);
	const segments = relative.split(path.sep).filter(Boolean);
	return segments.length > 0 ? segments : ["_root"];
}

export function getReaderSessionDir(cwd: string, agentRoot = getAgentRoot()): string {
	return path.join(agentRoot, DELEGATE_SESSION_DIR_NAME, "reader", ...cwdSessionSegments(cwd));
}
