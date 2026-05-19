export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type RunStatus = "completed" | "failed" | "timeout" | "aborted";

export interface AgentConfig {
	name: string;
	description?: string;
	model?: string;
	thinking?: ThinkingLevel;
	systemPromptMode: "append" | "replace";
	systemPrompt: string;
	filePath: string;
}

export interface DiscoveredAgents {
	agents: AgentConfig[];
	agentsDir: string;
}

export interface SubagentParams {
	agent: string;
	task: string;
	model?: string;
	thinking?: ThinkingLevel;
	cwd?: string;
	timeoutMs?: number;
	maxResultBytes?: number;
	includeDiagnostics?: boolean;
}

export interface NormalizedSubagentParams {
	agent: string;
	task: string;
	model?: string;
	thinking?: ThinkingLevel;
	cwd: string;
	timeoutMs: number;
	maxResultBytes: number;
	includeDiagnostics: boolean;
}

export interface ResolvedInvocation {
	agent: AgentConfig;
	params: NormalizedSubagentParams;
	model: string;
	thinking: ThinkingLevel;
	tools: string[];
}

export interface SubagentToolDetails {
	agent: string;
	model: string;
	thinking: ThinkingLevel;
	cwd: string;
	status: RunStatus;
	exitCode: number | null;
	durationMs: number;
	toolCallCount: number;
	truncated: boolean;
	stderrTail?: string;
	error?: string;
}

export interface SubagentToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: SubagentToolDetails;
}

export interface FrontmatterParseResult {
	frontmatter: Record<string, string>;
	body: string;
}

export interface TempRunFiles {
	dir: string;
	promptPath: string;
	taskPath: string;
}

export interface JsonEventState {
	finalText: string;
	streamingText: string;
	lastError: string;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	toolCallCount: number;
}

export interface ChildProcessResult {
	status: RunStatus;
	exitCode: number | null;
	stderrTail: string;
	error?: string;
	state: JsonEventState;
}
