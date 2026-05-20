export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type DelegateToolName = "reader" | "writer";
export type DelegateCapability = "read" | "write";
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

export interface BaseDelegateParams {
	agent: string;
	task: string;
	model?: string;
	thinking?: ThinkingLevel;
	cwd?: string;
	timeoutMs?: number;
	maxResultBytes?: number;
	includeDiagnostics?: boolean;
}

export type ReaderParams = BaseDelegateParams;

export interface WriterParams extends BaseDelegateParams {
	allowedPaths: string[];
}

export interface NormalizedBaseDelegateParams {
	agent: string;
	task: string;
	model?: string;
	thinking?: ThinkingLevel;
	cwd: string;
	timeoutMs: number;
	maxResultBytes: number;
	includeDiagnostics: boolean;
}

export type NormalizedReaderParams = NormalizedBaseDelegateParams;

export interface NormalizedWriterParams extends NormalizedBaseDelegateParams {
	allowedPaths: string[];
}

export interface DelegateProfile<
	TParams extends BaseDelegateParams = BaseDelegateParams,
	TNormalized extends NormalizedBaseDelegateParams = NormalizedBaseDelegateParams,
> {
	name: DelegateToolName;
	capability: DelegateCapability;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	parameters: unknown;
	tools: readonly string[];
	sessionDirSegment: string;
	sessionMode: "persistent" | "fresh";
	defaultModel: string;
	defaultThinking: ThinkingLevel;
	normalizeParams(params: TParams, defaultCwd: string): TNormalized;
}

export interface ResolvedReaderInvocation {
	agent: AgentConfig;
	params: NormalizedReaderParams;
	model: string;
	thinking: ThinkingLevel;
	tools: string[];
	sessionDir: string;
}

export interface ResolvedWriterInvocation {
	agent: AgentConfig;
	params: NormalizedWriterParams;
	model: string;
	thinking: ThinkingLevel;
	tools: string[];
	sessionDir: string;
}

export type ResolvedInvocation = ResolvedReaderInvocation | ResolvedWriterInvocation;

export interface DiscoveredAgents {
	agents: AgentConfig[];
	agentsDir: string;
}

export interface FrontmatterParseResult {
	frontmatter: Record<string, string>;
	body: string;
}

export interface JsonEventState {
	finalText: string;
	streamingText: string;
	lastError: string;
	toolCallCount: number;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

export interface ChildProcessResult {
	status: RunStatus;
	exitCode: number | null;
	stderrTail: string;
	state: JsonEventState;
	error?: string;
}

export interface TempRunFiles {
	dir: string;
	promptPath: string;
	taskPath: string;
}

export interface ReaderToolDetails {
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

export interface ReaderToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: ReaderToolDetails;
}

export type WriterFileChangeStatus = "created" | "modified" | "unchanged" | "deleted" | "skipped";

export interface WriterFileChange {
	path: string;
	status: WriterFileChangeStatus;
	oldSize: number | null;
	newSize: number | null;
	additions: number;
	deletions: number;
	reason?: string;
}

export interface WriterDiffPreview {
	changedFiles: WriterFileChange[];
	diffPreview: string;
	diffTruncated: boolean;
}

export interface WriterToolDetails extends ReaderToolDetails {
	changedFiles?: WriterFileChange[];
	changedFileCount?: number;
	skippedDiffCount?: number;
	changedFilesTruncated?: boolean;
	diffPreview?: string;
	diffTruncated?: boolean;
}

export interface WriterToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: WriterToolDetails;
}
