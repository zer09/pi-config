# Reader and Writer Delegate Tools Plan

## Goal

Create two separate Pi delegation tools with shared infrastructure and separate capability profiles:

- `reader`: a read-only child agent for investigation, review, documentation research, and evidence gathering.
- `writer`: a scoped local file editing child agent for implementing exact file changes.

Delegates exist to reduce parent-agent memory/tool-call noise. They should perform bounded work and return compact results. The parent agent owns orchestration and decides whether to call another delegate or take the next action.

The design must avoid a single mode-heavy tool such as `subagent({ mode: "reader" | "writer" })`. Instead, the runner should be generic and profile-driven. Reader and writer behavior should live in separate modules so each delegate has a clear responsibility and can evolve independently.

## Non-goals

- Do not create a writer that can freely mutate the repository without path scope.
- Do not let child agents recursively call `reader`, `writer`, or future delegate tools.
- Do not put reader/writer branching throughout the shared runner.
- Do not let the writer commit, push, deploy, comment on GitHub, or mutate external hosted services.
- Do not move unrelated Pi extension logic into this feature.

## Recommended architecture

Use one extension package that registers two tools, backed by shared modules and profile modules.

```text
agent/extensions/delegates/
  index.ts
  constants.ts
  types.ts
  schemas.ts
  toolsets.ts
  agent-files.ts
  paths.ts
  params.ts
  profiles.ts
  runner.ts
  temp-files.ts
  pi-invocation.ts
  child-process.ts
  json-events.ts
  redaction.ts
  truncation.ts
  text-files.ts
  results.ts
  progress.ts
  renderers.ts
  child-guards.ts
  register-tool.ts
  profiles/
    reader.ts
    writer.ts
  delegates.test.ts
  README.md
```

A smaller first step can keep the current folder and move later:

```text
agent/extensions/simple-subagent/
  index.ts
  constants.ts
  types.ts
  ...same module split...
```

Then rename the directory to `delegates` or `reader-writer-delegates` after behavior is stable.

## Core design rule

The shared runner must not ask "am I reader or writer?". It should call profile hooks.

```ts
registerDelegateTool(pi, readerProfile);
registerDelegateTool(pi, writerProfile);
```

The only acceptable profile dispatch points are:

- `index.ts`: registers the list of profiles.
- `register-tool.ts`: turns one profile into one Pi tool.
- `runner.ts`: calls generic profile hooks without knowing specific profile names.
- `child-guards.ts`: loads child guard configuration from environment and blocks unsafe tool calls.

If future behavior differs enough, add a new profile module instead of adding another mode to reader or writer.

## Capability model

### Reader

Reader is for read-only work. Reader may use an explicit `cwd` outside the parent cwd as long as it resolves to an existing directory, matching the current subagent flexibility for cross-repo and worktree investigation.

Recommended tools:

```ts
export const READER_TOOLS = [
  "ctx_execute",
  "ctx_execute_file",
  "ctx_batch_execute",
  "ctx_search",
  "ctx_fetch_and_index",
  "ctx_index",
  "context_mode_ctx_execute",
  "context_mode_ctx_execute_file",
  "context_mode_ctx_batch_execute",
  "context_mode_ctx_search",
  "context_mode_ctx_fetch_and_index",
  "context_mode_ctx_index",
] as const;
```

Reader prompt responsibilities:

- Read-only only.
- Use Context Watcher.
- If `cwd` is provided, it must resolve to an existing directory, but it does not need to be inside the parent cwd.
- Use Context Mode for shell, logs, tests, builds, and large output.
- Tests/builds are allowed only as read-only checks. Do not run commands known to modify files, write caches/artifacts in the worktree, deploy, or mutate external services.
- Reader may identify or summarize binary files through safe read-only tooling, but must not dump raw binary bytes or large binary-derived output into the parent result.
- Reader may inspect generated files read-only. When generated status matters, identify it and avoid recommending manual generated-file edits.
- Use Code Review Graph first for supported code exploration.
- Use gh-cli for GitHub data through Context Mode/RTK.
- Return compact structured findings.
- Use parent-action-neutral headings such as `## Result`, `## Evidence`, `## Validation`, `## Risks`, and `## Parent considerations`.
- Do not use `## Next step` in delegate output contracts.
- Do not recommend or call `writer`; the parent agent decides follow-up actions.
- Report affected files and evidence when useful, but do not produce delegate orchestration instructions.
- Do not edit files.
- Do not create files.
- Do not mutate external services.

### Writer

Writer is for scoped local file changes. In v1, writer is also scoped for reads: it may read only files listed in `allowedPaths`. Broader investigation belongs to `reader`.

Recommended default tools:

```ts
export const WRITER_TOOLS = [
  "read",
  "edit",
  "write",
] as const;
```

Do not give writer direct `bash` by default. Do not give writer `ctx_execute`, `ctx_batch_execute`, `ctx_execute_file`, or `ctx_search` by default if strict read/write containment is the goal. The parent agent can run tests and validation after writer returns.

Writer parameters must include an explicit non-empty exact file scope. In v1, each `allowedPaths` entry is one exact file path, not a directory scope. The existing `task` field is the writer change brief and must be specific enough to implement without broad investigation.

```ts
export interface WriterParams extends BaseDelegateParams {
  allowedPaths: string[];
}
```

Writer prompt responsibilities:

- Read only exact files listed in `allowedPaths`.
- Modify only exact files listed in `allowedPaths`.
- Treat directory-wide read/write access as unsupported in v1.
- Use `edit` for existing files.
- Use `write` only to create an exact missing file listed in `allowedPaths`.
- Do not use `write` to overwrite existing files.
- Creation is allowed only when the exact missing file path is present in `allowedPaths`.
- Writer is text-file only in v1.
- Writer must not read, create, or modify images or other binary assets.
- Exact missing file creation is text-file agnostic: source, test, docs, config, lockfiles, and similar text files are allowed when explicitly listed.
- Do not create or modify binary files. Binary assets must be handled by the parent agent explicitly.
- Keep changes minimal and traceable to the delegated task.
- Do not run formatters or automatic formatting in v1.
- Do not reformat or refactor unrelated code.
- Do not run shell commands unless a future profile explicitly grants that capability.
- Do not run package managers or generators to produce lockfile changes.
- Treat lockfiles as generated files.
- Lockfiles may be edited only when explicitly listed in `allowedPaths` and the task explicitly says to edit lockfiles or generated files.
- Do not edit generated files unless the parent explicitly listed them and the task explicitly says to edit generated files.
- A generated file is a file normally produced by another tool rather than hand-written directly, for example lockfiles, protobuf/OpenAPI clients, generated GraphQL/schema files, build outputs, or files containing markers such as `DO NOT EDIT`, `generated by`, or `Code generated`.
- If an allowed file appears generated but the task does not explicitly mention generated-file editing, stop and report that the parent should regenerate or clarify.
- Do not delete files. Only the parent agent may delete files.
- Do not commit, push, deploy, or mutate external hosted services.
- If the task is vague, asks for broad investigation, or does not describe implementation-ready changes, stop and ask the parent to use `reader` first.
- Return a compact file-level summary of changed files, created files, rationale, and validation limits.
- If formatting, package manager lockfile regeneration, or generated-file refresh may be needed, report it as a parent validation/cleanup consideration instead of running it.
- Use explicit validation status only: `Not run`, `Not available`, `Parent should run: <command>`, or `Checked by inspection` for syntax/structure observations only.
- Do not claim behavioral validation without running validation tools.
- Do not include line-by-line diffs or changed-line references by default; the parent agent can inspect diffs directly when needed.

If a future writer needs to run tests, prefer adding a third `validator` profile instead of expanding writer permissions. The parent agent decides whether to run `reader`, `writer`, `validator`, or direct parent validation. Delegates should not route to each other.

## Shared child process marker

Replace the extension-specific marker with a shared delegate marker:

```ts
export const DELEGATE_CHILD_MARKER = "PI_DELEGATE_CHILD";
export const DELEGATE_KIND_ENV = "PI_DELEGATE_KIND";
export const DELEGATE_ALLOWED_PATHS_ENV = "PI_DELEGATE_ALLOWED_PATHS";
```

Do not add legacy delegate aliases or legacy marker compatibility unless a user explicitly asks for a compatibility migration. Keep the new delegate surface clean.

Child behavior:

- Parent process registers `reader` and `writer` only.
- Child process does not register delegate tools.
- Child process may register safety guards from `child-guards.ts`.

`index.ts` should have one clear gate:

```ts
export default function (pi: ExtensionAPI) {
  if (isDelegateChildProcess()) {
    registerDelegateChildGuards(pi);
    return;
  }

  registerDelegateTool(pi, readerProfile);
  registerDelegateTool(pi, writerProfile);
}
```

This prevents recursive delegation while still allowing child-only write guards.

## Writer safety guard

The writer should not rely only on prompt instructions. Add a child process guard that enforces path scope for native file mutation tools.

`child-guards.ts` should export:

```ts
export interface AllowedPath {
  input: string;
  absolutePath: string;
  realPath?: string;
  kind: "existing_file" | "missing_file";
  textKind: "known_text" | "unknown_missing";
}

export interface ChildGuardConfig {
  delegateKind: DelegateToolName;
  cwd: string;
  allowedPaths: AllowedPath[];
}

export function isDelegateChildProcess(env?: NodeJS.ProcessEnv): boolean;
export function loadChildGuardConfig(cwd: string, env?: NodeJS.ProcessEnv): ChildGuardConfig | undefined;
export function registerDelegateChildGuards(pi: ExtensionAPI): void;
export function extractToolPath(input: unknown): string | undefined;
export function normalizeToolPath(rawPath: string, cwd: string): string;
export function resolveAllowedPaths(rawPaths: string[], cwd: string): AllowedPath[];
export function isPathAllowed(candidatePath: string, allowedPaths: AllowedPath[]): boolean;
export function blockReasonForToolCall(toolName: string, input: unknown, config: ChildGuardConfig): string | undefined;
```

Guard behavior:

- If not in a delegate child process, do nothing.
- If `PI_DELEGATE_KIND=reader`, block `write`, `edit`, `bash`, and any delegate tool if they appear.
- If `PI_DELEGATE_KIND=writer`, allow `read`, `edit`, and `write` only when the target path matches an exact file in `allowedPaths`.
- Block writer reads outside `allowedPaths`; broad investigation belongs to `reader`.
- Allow `read` attempts for missing exact paths listed in `allowedPaths`; the built-in read tool should fail naturally with file-not-found.
- Block directory paths in `allowedPaths`; v1 writer scope is exact files only.
- Block deletion tools and deletion-like commands if they appear. Only the parent agent may delete files.
- Block `bash` if it appears in writer by accident.
- Block recursive calls to `reader`, `writer`, and future delegate tool names.
- Extract tool target paths from `input.path` first, with `input.file_path` as a compatibility fallback.
- If neither `path` nor `file_path` is a non-empty string, block with an invalid path reason.
- If both `path` and `file_path` exist and differ after normalization, block as ambiguous.
- Normalize leading `@` in paths because models sometimes include it.
- Accept relative or absolute `allowedPaths`.
- Resolve relative paths against child `cwd`.
- Writer may accept `params.cwd`, but it must resolve to an existing directory. All `allowedPaths` are resolved relative to the normalized writer cwd when relative.
- Every resolved allowed path must stay inside normalized writer `cwd`.
- For existing files, use `realpath` to prevent symlink escapes.
- Existing allowed paths must resolve to regular text files.
- Images and other binary assets are not allowed in writer, even for read-only access.
- Candidate existing paths must realpath to the same regular text file as an allowed entry.
- Block symlink escapes outside `cwd`.
- For missing files, validate the resolved absolute file path exactly matches an allowed missing-file entry.
- Allow `read` attempts for missing allowed paths and let the built-in read tool report file-not-found.
- Allow `write` to create a missing text file only when that exact path was listed in `allowedPaths`.
- For `write`, require `content` to be a string and reject binary-looking or ambiguous content.
- For `edit`, guard the target path and text-file eligibility, and inspect visible replacement text for binary-looking or ambiguous content.
- For `edit`, if `edits` is an array, block when any `oldText` or `newText` string looks binary or ambiguous.
- For `edit`, if `edits` is a string and its byte length is at or below `MAX_STRINGIFIED_EDITS_GUARD_BYTES`, try JSON.parse and inspect parsed `oldText` and `newText` values when parsing succeeds.
- For `edit`, if stringified `edits` exceeds `MAX_STRINGIFIED_EDITS_GUARD_BYTES`, block as ambiguous.
- For `edit`, if stringified `edits` parsing fails under the limit, let the built-in edit tool handle validation.
- For `edit`, if legacy top-level `oldText` or `newText` is present and looks binary or ambiguous, block.
- For `edit`, do not duplicate full schema validation; let the built-in edit tool validate malformed edits.
- Block `write` to existing files; existing file modifications must use `edit`.
- Do not allow creating arbitrary files inside an allowed directory, because allowed directories are unsupported.

This guard is the second safety layer. The first safety layer is the writer tool list: pass only `read`, `edit`, and `write` to the child. The guard is defense-in-depth for config drift, reload behavior, extension interaction, or future Pi behavior.

## Shared exported modules

### constants.ts

Move shared constants here.

Exports:

```ts
export const DELEGATE_CHILD_MARKER = "PI_DELEGATE_CHILD";
export const DELEGATE_KIND_ENV = "PI_DELEGATE_KIND";
export const DELEGATE_ALLOWED_PATHS_ENV = "PI_DELEGATE_ALLOWED_PATHS";
export const DELEGATE_BIN_ENV = "PI_DELEGATE_BIN";

export const DEFAULT_READER_MODEL = "openai-codex/gpt-5.3-codex";
export const DEFAULT_WRITER_MODEL = "openai-codex/gpt-5.3-codex-spark";
export const DEFAULT_THINKING = "medium" satisfies ThinkingLevel;
export const DEFAULT_TIMEOUT_MS = 600_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 3_600_000;
export const DEFAULT_MAX_RESULT_BYTES = 24_000;
export const MIN_MAX_RESULT_BYTES = 1_000;
export const MAX_MAX_RESULT_BYTES = 1_000_000;
export const STDERR_TAIL_BYTES = 4_000;
export const DELEGATE_SESSION_DIR_NAME = "delegate-sessions";
export const DEFAULT_TASK_PREVIEW_CHARS = 120;
export const MAX_STRINGIFIED_EDITS_GUARD_BYTES = 64_000;
```

Notes:

- Default reader model is `openai-codex/gpt-5.3-codex`.
- Default writer model is `openai-codex/gpt-5.3-codex-spark`.
- Default thinking remains shared as `medium` for reader and writer, with per-call override still available.
- Default `maxResultBytes` remains shared as 24,000 for reader and writer, with per-call override still available.
- Do not add a lower writer-specific `maxResultBytes` default in v1; enforce writer compactness through the output contract instead.
- `DELEGATE_BIN_ENV` replaces the old test override name.
- Do not keep `PI_SIMPLE_SUBAGENT_BIN` fallback support in the clean implementation.

### types.ts

Keep all public types here. Avoid importing runtime-heavy modules into `types.ts`.

Exports:

```ts
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type RunStatus = "completed" | "failed" | "timeout" | "aborted";
export type DelegateToolName = "reader" | "writer";
export type DelegateCapability = "read" | "write";
export type DelegateProgressStatus = "starting" | "running" | "completed" | "failed" | "timeout" | "aborted";
export type DelegatePhase =
  | "discovering_agents"
  | "preparing_prompt"
  | "launching_child"
  | "reading_child_events"
  | "finishing";
export type SystemPromptMode = "append" | "replace";

export interface AgentConfig {
  name: string;
  description?: string;
  model?: string;
  thinking?: ThinkingLevel;
  systemPromptMode: SystemPromptMode;
  systemPrompt: string;
  filePath: string;
}

export interface DiscoveredAgents {
  agents: AgentConfig[];
  agentsDir: string;
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

export interface ReaderParams extends BaseDelegateParams {}

export interface WriterParams extends BaseDelegateParams {
  allowedPaths: string[];
}

export type DelegateParams = ReaderParams | WriterParams;

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

export interface NormalizedReaderParams extends NormalizedBaseDelegateParams {}

export interface NormalizedWriterParams extends NormalizedBaseDelegateParams {
  allowedPaths: string[];
  resolvedAllowedPaths: string[];
}

export type NormalizedDelegateParams = NormalizedReaderParams | NormalizedWriterParams;

export interface DelegateProfile<TParams extends BaseDelegateParams, TNormalized extends NormalizedBaseDelegateParams> {
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
  buildSystemPrompt(agent: AgentConfig, params: TNormalized): string;
  buildTaskPrompt(invocation: ResolvedInvocation<TNormalized>): string;
  buildChildEnv?(invocation: ResolvedInvocation<TNormalized>): Record<string, string>;
}

export interface ResolvedInvocation<TParams extends NormalizedBaseDelegateParams = NormalizedBaseDelegateParams> {
  profile: DelegateProfile<any, TParams>;
  agent: AgentConfig;
  params: TParams;
  model: string;
  thinking: ThinkingLevel;
  tools: readonly string[];
  sessionDir: string;
  cleanupSessionDirOnSuccess: boolean;
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
  lastEvent?: string;
  lastToolName?: string;
}

export interface DelegateProgressDetails {
  delegate: DelegateToolName;
  agent: string;
  taskPreview: string;
  cwd: string;
  status: DelegateProgressStatus;
  phase: DelegatePhase;
  elapsedMs: number;
  toolCallCount: number;
  lastEvent?: string;
  lastToolName?: string;
  allowedPathsPreview?: string[];
}

export interface DelegateProgressUpdate {
  content: Array<{ type: "text"; text: string }>;
  details: DelegateProgressDetails;
}

export type DelegateProgressReporter = (update: DelegateProgressUpdate) => void;
export type DelegateRenderedResult = DelegateProgressUpdate | DelegateToolResult;

export interface ChildProcessResult {
  status: RunStatus;
  exitCode: number | null;
  stderrTail: string;
  error?: string;
  state: JsonEventState;
}

export interface DelegateToolDetails extends DelegateProgressDetails {
  model: string;
  thinking: ThinkingLevel;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  allowedPaths?: string[];
  preservedSessionDir?: string;
  stderrTail?: string;
  error?: string;
}

export interface DelegateToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: DelegateToolDetails;
}

export interface FrontmatterParseResult {
  frontmatter: Record<string, string>;
  body: string;
}
```

### schemas.ts

Keep TypeBox schemas separate from runtime behavior.

Exports:

```ts
export const BaseDelegateParamsSchema: TObject;
export const ReaderParamsSchema: TObject;
export const WriterParamsSchema: TObject;
```

Rules:

- `ReaderParamsSchema` extends base only.
- `WriterParamsSchema` extends base with `allowedPaths` as a required non-empty string array.
- Do not add `mode` to writer. If another mode is needed later, create another profile.

### toolsets.ts

Exports:

```ts
export const READER_TOOLS: readonly string[];
export const WRITER_TOOLS: readonly string[];
export const DELEGATE_TOOL_NAMES: readonly DelegateToolName[];
export function toolsForPrompt(tools: readonly string[]): string;
```

Rules:

- Reader gets Context Mode read tools only.
- Writer gets `read`, `edit`, and `write` by default.
- Writer never gets delete-capable tools by default.
- Do not give writer `ctx_search` by default in v1, because it can read indexed content outside `allowedPaths`.
- Keep all tool list decisions in this module or profile modules, not in the runner.
- Treat tool-list restriction as the first safety layer and child `tool_call` guards as defense-in-depth.

### paths.ts

Move path/session helpers here.

Exports:

```ts
export function getAgentRoot(): string;
export function cwdSessionSegments(cwd: string): string[];
export function getDelegateSessionDir(options: {
  cwd: string;
  delegateName: DelegateToolName;
  agentRoot?: string;
  sessionDirSegment?: string;
}): string;
export function redactHomePath(text: string): string;
```

Recommended session layout:

```text
~/.pi/agent/delegate-sessions/<delegate-name>/<absolute-cwd-segments>/
```

This keeps reader and writer memory separate while using one shared session root.

### agent-files.ts

Move current agent discovery and frontmatter parsing here.

Exports:

```ts
export function stripOptionalQuotes(value: string): string;
export function parseFrontmatter(content: string): FrontmatterParseResult;
export function parseAgentFile(filePath: string, content: string): AgentConfig;
export async function discoverAgents(agentRoot?: string): Promise<DiscoveredAgents>;
```

Internal helpers can remain unexported unless tests or other modules need them:

```ts
function parseModel(value: string | undefined): string | undefined;
function parseThinking(value: string | undefined, filePath: string): ThinkingLevel | undefined;
function parseSystemPromptMode(value: string | undefined, filePath: string): SystemPromptMode;
```

If tests need direct coverage, export them from `agent-files.ts` but keep them documented as parser helpers.

`systemPromptMode` policy for delegates:

- Keep parsing `systemPromptMode` for compatibility with existing agent files.
- Do not let `systemPromptMode` remove delegate safety boundaries.
- In delegate tools, treat `systemPromptMode` as applying only to the agent role section.
- `append` means include the agent role prompt after the delegate boundary.
- `replace` means the agent role prompt replaces any default role text, but the delegate boundary still wraps it.

### params.ts

Move normalization helpers here.

Exports:

```ts
export function normalizeNonEmptyString(value: unknown, field: string): string;
export function normalizeOptionalString(value: unknown, field: string): string | undefined;
export function normalizeBoolean(value: unknown, field: string, defaultValue: boolean): boolean;
export function normalizeBoundedNumber(value: unknown, field: string, defaultValue: number, min: number, max: number): number;
export function normalizeThinking(value: unknown): ThinkingLevel | undefined;
export function normalizeBaseParams(params: BaseDelegateParams, defaultCwd: string): NormalizedBaseDelegateParams;
export function normalizeAllowedPaths(rawPaths: unknown, cwd: string): { allowedPaths: string[]; resolvedAllowedPaths: string[] };
```

Reader and writer profile modules should compose these helpers.

`normalizeAllowedPaths` rules:

- Require a non-empty array of non-empty strings.
- Accept relative or absolute paths.
- Resolve relative paths against the normalized delegate `cwd`.
- Require every resolved path to stay inside the normalized delegate `cwd`.
- Strip a leading `@` from model-provided paths.
- Reject entries that resolve to directories.
- Permit existing regular text files and missing exact file paths.
- For existing files, store the realpath and require candidate existing paths to resolve to the same real file.
- Reject symlink escapes outside `cwd`.
- Treat missing exact file paths as explicit text-file creation targets, not as parent-directory scopes.
- Deduplicate by resolved absolute path.
- Do not interpret an allowed path as a directory scope.

### profiles.ts

Optional barrel export for profiles.

Exports:

```ts
export { readerProfile } from "./profiles/reader.ts";
export { writerProfile } from "./profiles/writer.ts";
```

### profiles/reader.ts

Reader-specific behavior only.

Exports:

```ts
export const readerProfile: DelegateProfile<ReaderParams, NormalizedReaderParams>;
export function normalizeReaderParams(params: ReaderParams, defaultCwd: string): NormalizedReaderParams;
export function buildReaderSystemPrompt(agent: AgentConfig, params: NormalizedReaderParams): string;
export function buildReaderTaskPrompt(invocation: ResolvedInvocation<NormalizedReaderParams>): string;
```

Reader profile properties:

```ts
name: "reader";
capability: "read";
label: "Reader";
sessionDirSegment: "reader";
sessionMode: "persistent";
defaultModel: DEFAULT_READER_MODEL;
defaultThinking: DEFAULT_THINKING;
tools: READER_TOOLS;
```

Reader uses persistent sessions per `cwd` only because the main goal is to retain Context Mode indexes and per-target investigation memory. Do not split reader sessions by agent in v1. Different reader agents sharing the same cwd intentionally share child session memory; document this in README and mention it briefly in the reader system prompt. Reader still returns compact findings and does not orchestrate follow-up delegates. Delegate safety boundaries always wrap and win over agent `systemPromptMode`; an agent file cannot replace the reader boundary prompt.

### profiles/writer.ts

Writer-specific behavior only.

Exports:

```ts
export const writerProfile: DelegateProfile<WriterParams, NormalizedWriterParams>;
export function normalizeWriterParams(params: WriterParams, defaultCwd: string): NormalizedWriterParams;
export function buildWriterSystemPrompt(agent: AgentConfig, params: NormalizedWriterParams): string;
export function buildWriterTaskPrompt(invocation: ResolvedInvocation<NormalizedWriterParams>): string;
export function buildWriterChildEnv(invocation: ResolvedInvocation<NormalizedWriterParams>): Record<string, string>;
```

Writer profile properties:

```ts
name: "writer";
capability: "write";
label: "Writer";
sessionDirSegment: "writer";
sessionMode: "fresh";
defaultModel: DEFAULT_WRITER_MODEL;
defaultThinking: DEFAULT_THINKING;
tools: WRITER_TOOLS;
```

Writer must use a fresh child session for each invocation. Do not pass `--continue` for writer. Writer edits must be based only on the current task, allowed files, and explicit prompt, not stale session memory. Delete writer fresh session dirs after successful runs. Preserve them on failure only when `includeDiagnostics` is true.

Writer agent prompt policy:

- Writer may use any discovered user-level agent file.
- The writer boundary prompt must override the agent role on capability limits.
- Delegate safety boundaries always wrap and win over agent `systemPromptMode`; an agent file cannot replace the writer boundary prompt.
- Keep parsing `systemPromptMode` for compatibility, but treat it as applying only to the agent role section.
- Treat agent `systemPromptMode: "replace"` as applying only to the agent role section, not to delegate safety boundaries.
- If an agent role asks for broader reads, shell commands, deletion, full-file overwrite, commits, external mutations, or delegate orchestration, the writer boundary wins.
- Child guards enforce the write/read scope regardless of agent prompt content.

Writer task prompt requirements:

- Treat `task` as the complete change brief.
- Do not infer unstated requirements from nearby files or broad repository patterns.
- Use `reader` output or parent-provided instructions as the source of truth.
- If the brief is not implementation-ready, return a refusal-style finding that asks the parent for a clearer brief or a reader investigation.

Writer child env should include:

```ts
{
  PI_DELEGATE_CHILD: "1",
  PI_DELEGATE_KIND: "writer",
  PI_DELEGATE_ALLOWED_PATHS: JSON.stringify(invocation.params.resolvedAllowedPaths),
}
```

### runner.ts

Shared orchestration only.

Exports:

```ts
export async function runDelegate<TParams extends BaseDelegateParams, TNormalized extends NormalizedBaseDelegateParams>(
  profile: DelegateProfile<TParams, TNormalized>,
  params: TParams,
  defaultCwd: string,
  signal?: AbortSignal,
  reportProgress?: DelegateProgressReporter,
): Promise<DelegateToolResult>;

export function resolveInvocation<TParams extends NormalizedBaseDelegateParams>(
  profile: DelegateProfile<any, TParams>,
  params: TParams,
  agents: AgentConfig[],
): ResolvedInvocation<TParams> | string;
```

Runner steps:

1. Start timer.
2. Normalize params through `profile.normalizeParams`.
3. Emit `starting` progress with phase `discovering_agents`.
4. Discover user-level agents.
5. Resolve selected agent by name.
6. Create a stable profile-specific session dir with `getDelegateSessionDir` when `profile.sessionMode` is `persistent`; create a fresh temp session dir when `profile.sessionMode` is `fresh`.
7. Set `cleanupSessionDirOnSuccess` to true for fresh sessions.
8. Emit `running` progress with phase `preparing_prompt`.
8. Create temp prompt/task files using profile prompt builders.
9. Build Pi args using profile tools.
10. Build child env from shared env plus `profile.buildChildEnv`.
11. Emit `running` progress with phase `launching_child`.
12. Run child process and pass the progress reporter to `runChildProcess`.
13. While the child emits JSON events, emit throttled `running` progress with phase `reading_child_events`.
15. Emit `finishing` progress when the child exits.
16. Convert child result into `DelegateToolResult`.
17. Clean temp prompt/task files in `finally`.
18. For fresh writer sessions, delete the child session dir on success. On failure, preserve it only when `includeDiagnostics` is true and include the redacted session dir path in details.

Model/thinking precedence in `resolveInvocation` applies to both reader and writer:

1. Call param `model` / `thinking`.
2. Agent file `model` / `thinking`.
3. Profile `defaultModel` / `defaultThinking`.

No reader/writer-specific conditions should appear in this file. Progress should be built from generic invocation metadata plus profile hooks, not profile-name branches.

### register-tool.ts

Convert profiles to Pi tools.

Exports:

```ts
export function registerDelegateTool<TParams extends BaseDelegateParams, TNormalized extends NormalizedBaseDelegateParams>(
  pi: ExtensionAPI,
  profile: DelegateProfile<TParams, TNormalized>,
): void;
```

Behavior:

- Tool name comes from `profile.name`.
- Schema comes from `profile.parameters`.
- Description, label, prompt snippet, and prompt guidelines come from profile.
- `renderCall` comes from shared `renderDelegateCall` and displays the static title plus arg-derived agent, task preview, and optional allowed path preview.
- `renderResult` comes from shared `renderDelegateResult` and displays live progress for partial updates, then final status, duration, tool count, and optional scope for the final result.
- Execute adapts Pi `onUpdate` to `DelegateProgressReporter` and calls `runDelegate(profile, params, ctx.cwd, signal, reportProgress)`.
- Catch block uses shared immediate failure formatting.

### temp-files.ts

Exports:

```ts
export async function createTempRunFiles<TParams extends NormalizedBaseDelegateParams>(
  invocation: ResolvedInvocation<TParams>,
): Promise<TempRunFiles>;

export async function cleanupTempRunFiles(files: TempRunFiles | undefined): Promise<void>;
```

Rules:

- Use `fs.promises.mkdtemp` under `os.tmpdir()`.
- Write prompt and task files with mode `0o600`.
- Always clean prompt/task files in `finally`.
- Do not delete persistent reader session dirs.
- Delete fresh writer session dirs after successful runs.
- Preserve failed writer session dirs only when diagnostics are enabled.

### pi-invocation.ts

Exports:

```ts
export function buildPiArgs<TParams extends NormalizedBaseDelegateParams>(
  invocation: ResolvedInvocation<TParams>,
  files: TempRunFiles,
): string[];

export function getPiInvocation(args: string[], env?: NodeJS.ProcessEnv): { command: string; args: string[] };
```

Rules:

- Keep `--mode json`, `-p`, `--session-dir`, `--model`, `--thinking`, `--append-system-prompt`, `--tools`, and task file handling here.
- Add `--continue` only when `invocation.profile.sessionMode === "persistent"`.
- Do not add `--continue` for writer/fresh sessions.
- Use `PI_DELEGATE_BIN` override first.
- Do not fall back to old simple-subagent override env names.
- Avoid shell interpolation. Return command and args array.

### child-process.ts

Exports:

```ts
export interface RunChildProcessOptions {
  invocation: { command: string; args: string[] };
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
  reportProgress?: DelegateProgressReporter;
  progressContext: Omit<DelegateProgressDetails, "status" | "phase" | "elapsedMs" | "toolCallCount">;
  startedAt: number;
}

export async function runChildProcess(options: RunChildProcessOptions): Promise<ChildProcessResult>;
export function killChild(proc: ReturnType<typeof spawn>): void;
export function appendTail(current: string, next: string, maxBytes: number): string;
```

Rules:

- Keep `shell: false`.
- Merge env with `process.env` plus delegate env.
- Parse stdout line by line through `applyJsonEventLine`.
- Emit throttled progress from parsed JSON events.
- Emit progress immediately when `toolCallCount` changes.
- Throttle time-only progress to about once per second.
- Keep bounded stderr tail.
- Timeout sends SIGTERM then SIGKILL.
- Abort signal sends SIGTERM then SIGKILL.

### json-events.ts

Exports:

```ts
export function emptyEventState(): JsonEventState;
export function textFromMessage(message: unknown): string;
export function updateUsageMetadata(state: JsonEventState, message: unknown): void;
export interface JsonEventUpdate {
  eventType: string;
  toolCallCountChanged: boolean;
  lastToolName?: string;
}

export function applyJsonEventLine(line: string, state: JsonEventState): JsonEventUpdate | undefined;
```

Potential improvement:

- Cap `state.streamingText` length to avoid unbounded memory if the child streams a very large message.
- Keep final text extraction from `message_end` and `agent_end`.
- Count tool calls from `tool_execution_start` without importing tool args.
- Record only compact event metadata for progress: event type, tool call count, and tool name when available.
- Never store raw child tool args in `JsonEventState`.

### redaction.ts

Exports:

```ts
export function redactSensitiveText(text: string): string;
export function redactHomePath(text: string): string;
```

Improve current redaction:

- Redact `Bearer ...`.
- Redact `sk-...` style keys.
- Redact unquoted and quoted assignments for keys containing `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `AUTH`, `BEARER`, `API_KEY`, or `PRIVATE`.
- Redact home directory paths to `~`.

### truncation.ts

Exports:

```ts
export function truncateMiddleByChars(text: string, maxChars: number): { text: string; truncated: boolean };
export function truncateMiddleByBytes(text: string, maxBytes: number): { text: string; truncated: boolean };
```

Recommendation:

- Keep current char truncation for compatibility if needed.
- Use byte truncation for `maxResultBytes`, because the parameter promises bytes.

### text-files.ts

Centralize text/binary checks used by writer path normalization and child guards.

Exports:

```ts
export function isLikelyBinaryBuffer(buffer: Buffer): boolean;
export async function assertExistingTextFile(filePath: string): Promise<void>;
export function isLikelyTextContent(content: string): boolean;
export function blockReasonForBinaryWrite(content: unknown): string | undefined;
```

Rules:

- Existing writer `allowedPaths` must be regular text files.
- Use strict binary detection. If a file or content is ambiguous, block it and let the parent agent handle it.
- Use a bounded byte sample for binary detection; do not read whole large files just to classify them.
- Treat NUL bytes as binary.
- Treat decoding failures, replacement characters, or suspicious control-character ratios as binary/ambiguous and block them.
- Missing allowed paths are classified as `unknown_missing`; the guard validates the `write` content strictly when creation is attempted.
- New file `write` content must be a string and must not look binary.
- Do not rely only on file extension. Extensions can help error messages, but content sniffing is the primary check.
- On ambiguity, block and return a concise reason that the parent must handle binary or ambiguous file content.

### results.ts

Exports:

```ts
export function resultTextFromChild(child: ChildProcessResult): string;
export function buildFailureText(child: ChildProcessResult, includeDiagnostics: boolean): string;
export function makeToolResult<TParams extends NormalizedBaseDelegateParams>(
  invocation: ResolvedInvocation<TParams>,
  child: ChildProcessResult,
  durationMs: number,
): DelegateToolResult;
export function makeImmediateFailure(
  params: NormalizedBaseDelegateParams,
  delegateName: DelegateToolName,
  agentName: string,
  message: string,
  durationMs: number,
): DelegateToolResult;
```

Behavior decisions:

- Redact before truncating.
- Include stderr tail only when `includeDiagnostics` is true.
- If `includeDiagnostics` is false and no final child message exists, include only a minimal failure reason, not raw stderr.
- Include `allowedPaths` in details for writer after redaction.
- Include progress fields in final details so `renderResult` can show the same title/subtitle shape as live progress.
- Include `preservedSessionDir` only for failed fresh sessions when `includeDiagnostics` is true, and redact the home path.

### progress.ts

Build and throttle progress updates. This module owns UI-progress data, but not rendering.

Exports:

```ts
export function buildTaskPreview(task: string, maxChars?: number): string;
export function buildAllowedPathsPreview(paths: readonly string[] | undefined, cwd: string, maxItems?: number): string[] | undefined;
export function makeProgressDetails<TParams extends NormalizedBaseDelegateParams>(options: {
  invocation: ResolvedInvocation<TParams>;
  status: DelegateProgressStatus;
  phase: DelegatePhase;
  startedAt: number;
  state?: JsonEventState;
}): DelegateProgressDetails;
export function makeProgressUpdate(details: DelegateProgressDetails): DelegateProgressUpdate;
export function createProgressThrottler(reportProgress: DelegateProgressReporter | undefined, intervalMs?: number): {
  emit(details: DelegateProgressDetails, options?: { force?: boolean }): void;
};
```

Progress details should include:

- `delegate`: `reader` or `writer`.
- `agent`: selected agent name.
- `taskPreview`: redacted, whitespace-collapsed, truncated preview of the delegated task.
- `taskPreview` uses the same default max for reader and writer: 120 characters.
- `cwd`: redacted cwd stored in details for debugging.
- `status`: current status.
- `phase`: coarse execution phase.
- `elapsedMs`: wall-clock elapsed time.
- `toolCallCount`: number of child tool calls observed.
- `lastEvent`: compact JSON event type, if known.
- `lastToolName`: child tool name, if available from JSON event metadata.
- `allowedPathsPreview`: writer scope preview, redacted and truncated. Prefer paths relative to writer `cwd`; use redacted absolute paths only when a relative path is not possible. Default collapsed preview shows at most 2 paths plus `+N more`.

Rules:

- Progress is for UI only.
- Do not append progress logs to final `content`.
- Do not include raw child stdout, stderr, tool args, or long streamed text.
- Redact before previewing.
- Collapse whitespace before truncating.
- Use plain ASCII truncation marker `...`.
- Use `DEFAULT_TASK_PREVIEW_CHARS` for both reader and writer unless a renderer explicitly opts into a shorter value.
- Use a stable one-line partial `content`, for example `Reader running...`, only because Pi partial updates expect a result-like shape. The useful data should be in `details`.
- If Pi accepts details-only partial updates in the future, prefer details-only updates.

### renderers.ts

Render the live and final delegate tool rows. Rendering is UI only and should not change model-visible content.

Exports:

```ts
export function renderDelegateCall(args: unknown, theme: Theme, context: ToolRenderContext): Component;
export function renderDelegateResult(result: DelegateRenderedResult, options: ToolRenderOptions, theme: Theme, context: ToolRenderContext): Component;
export function formatDelegateTitle(detailsOrArgs: unknown): string;
export function formatDelegateSubtitle(details: DelegateProgressDetails): string;
export function formatDuration(ms: number): string;
```

Recommended visual form:

```text
Reader
agent: investigator
task: Analyze agent/extensions/simple-subagent/index.ts and report risks...
status: running - 2 tool calls - 18s
```

Writer adds scope:

```text
Writer
agent: implementer
task: Apply login timeout fix...
scope: src/auth/login.ts, src/auth/login.test.ts
status: completed - 2 tool calls - 31s
```

Rendering rules:

- Import concrete renderer types from Pi/TUI in the implementation, for example `Component`, `Text`, `Theme`, and the tool render context/options types used by Pi.
- `renderCall` should use only initial args, because it is the static call header.
- `renderResult` should support both partial `DelegateProgressUpdate` values from `onUpdate` and final `DelegateToolResult` values from `execute`.
- Show `agent`, `taskPreview`, `status`, `toolCallCount`, and elapsed/duration.
- Show `scope` only when `allowedPathsPreview` exists.
- In collapsed view, cap scope to 2 paths plus `+N more`.
- Keep default collapsed view to 3-5 short lines.
- Do not show `cwd`, `lastEvent`, or `lastToolName` in collapsed view.
- Expanded view may show `cwd`, `phase`, `lastEvent`, `lastToolName`, `model`, `thinking`, and exit code.
- Never show full task text unless expanded and still truncated/redacted.
- Never show raw child logs or secret-like values.
- Do not add subtitle/progress to `description`, `promptSnippet`, `promptGuidelines`, task prompt, or final result `content`.

## Tool API proposal

### reader tool

```ts
reader({
  agent: string,
  task: string,
  model?: string,
  thinking?: ThinkingLevel,
  cwd?: string,
  timeoutMs?: number,
  maxResultBytes?: number,
  includeDiagnostics?: boolean,
})
```

Purpose:

- Investigation.
- Code review.
- Documentation research.
- Test/log analysis.
- Evidence gathering.

Output:

- Compact markdown with result, evidence, validation, risks, and parent considerations.
- For binary assets, report metadata or a concise summary only; do not include raw binary content.
- For generated files, report generated status when relevant and keep findings parent-action-neutral.
- No `## Next step` heading.
- No file changes.
- No delegate orchestration recommendations such as "call writer next".

### writer tool

```ts
writer({
  agent: string,
  task: string,
  allowedPaths: string[],
  model?: string,
  thinking?: ThinkingLevel,
  cwd?: string,
  timeoutMs?: number,
  maxResultBytes?: number,
  includeDiagnostics?: boolean,
})
```

Purpose:

- Apply local file edits in a narrow path scope.
- Create files only when task requires it and path is allowed.
- Return a compact file-level changed-files summary and explicit validation status.
- Do not return full diffs or changed-line references by default.
- Do not claim tests, type checks, or runtime validation ran unless the writer profile later gains explicit validation tools.

Required safety:

- Tool-list restriction and child `tool_call` blocking are both required.
- Writer `--tools` must be exactly `read,edit,write` in v1.
- `task` must be a specific implementation-ready change brief.
- If `task` requires broad investigation, call `reader` first instead of `writer`.
- Optional `cwd` must resolve to an existing directory.
- `allowedPaths` may be relative or absolute.
- Resolved `allowedPaths` must stay inside normalized writer `cwd`.
- `allowedPaths` must be non-empty.
- Every allowed path must be an exact file path.
- Existing allowed paths must be regular text files, not directories or binary files.
- Missing allowed paths are permitted only as exact file creation targets.
- Writer child guard must block `read`, `edit`, and `write` unless the target exactly matches an allowed file path.
- Writer child guard must block binary existing files and binary-looking write content for new files.
- Writer child guard must block `write` on existing files; existing file modifications must use `edit`.
- Writer child guard must block deletion tools if they are ever present.
- Writer must not receive direct shell or Context Mode search/execute tools by default.

## Migration plan

### Phase 0: Baseline

1. Run current tests.
2. Record current public behavior:
   - `subagent` tool name.
   - `PI_SIMPLE_SUBAGENT_CHILD` marker.
   - `PI_SIMPLE_SUBAGENT_BIN` test override.
   - `subagent-sessions` session dir.
   - Current JSON parsing and redaction behavior.
3. Keep a focused diff. Do not refactor unrelated files.

### Phase 1: Extract shared modules without behavior change

Move existing logic out of `index.ts` before changing the public tool names.

Extract in this order:

1. `types.ts` already exists. Expand only if needed.
2. `constants.ts`.
3. `toolsets.ts`.
4. `paths.ts`.
5. `agent-files.ts`.
6. `params.ts`.
7. `json-events.ts`.
8. `redaction.ts` and `truncation.ts`.
9. `temp-files.ts`.
10. `pi-invocation.ts`.
11. `child-process.ts`.
12. `results.ts`.
13. `text-files.ts`.
14. `progress.ts`.
15. `renderers.ts`.
16. `runner.ts`.
17. `register-tool.ts`.

Validation:

- Existing test suite passes after each meaningful extraction group.
- No behavior changes in tool output except import paths and module boundaries.

### Phase 2: Milestone A - reader replacement with progress/rendering

1. Add `DelegateProfile` type.
2. Add `profiles/reader.ts` matching the current read-only behavior.
3. Change `index.ts` to register `readerProfile` through `registerDelegateTool`.
4. Remove the `subagent` tool registration instead of keeping a compatibility alias.
5. Keep tests passing after updating expected tool names.
6. Add shared progress details and renderers while preserving the final `content` shape.
7. Validate that `reader` works end-to-end before adding any writer capability.

This milestone proves the runner is profile-driven, validates the public rename, validates progress UI, and keeps the public surface clean.

### Phase 3: Harden reader behavior

1. Verify `readerProfile` remains the only read-only delegate profile.
2. Add tests proving:
   - `reader` registers with reader schema.
   - `reader` receives only reader tools.
   - `reader` child env sets `PI_DELEGATE_CHILD=1` and `PI_DELEGATE_KIND=reader`.
   - Child process does not register recursive delegate tools.

### Phase 4: Milestone B - add writer with guards

1. Add `WriterParams` and `NormalizedWriterParams`.
2. Add `WriterParamsSchema` with required non-empty `allowedPaths`.
3. Add `normalizeAllowedPaths`.
4. Add `profiles/writer.ts`.
5. Add `child-guards.ts`.
6. Register writer profile.
7. Add tests proving:
   - Writer prompt boundaries override broader or conflicting agent role instructions.
   - Agent `systemPromptMode: "replace"` cannot remove delegate safety boundaries.
   - `systemPromptMode` is still parsed for compatibility and scoped to agent role text only.
   - Writer prompt treats `task` as an implementation-ready change brief.
   - Writer returns a clear failure/finding when the task asks for broad investigation instead of specific changes.
   - Writer rejects missing `allowedPaths`.
   - Writer rejects empty `allowedPaths`.
   - Writer accepts optional `cwd` only when it resolves to an existing directory.
   - Writer accepts relative and absolute allowed file paths.
   - Writer resolves relative allowed file paths against normalized writer `cwd`.
   - Writer rejects allowed paths that resolve outside normalized writer `cwd`.
   - Writer rejects directory entries in `allowedPaths`.
   - Writer rejects existing binary files in `allowedPaths`.
   - Writer rejects symlink escapes outside `cwd`.
   - Writer normalizes existing allowed files by realpath.
   - Writer permits missing exact file paths as creation targets.
   - Writer can create only a missing exact text file listed in `allowedPaths`.
- Writer may edit lockfiles only when explicitly listed as text files and explicitly requested as lockfile/generated-file edits in the task.
- Writer must not run package managers to generate lockfile changes.
- Writer may edit generated files only when explicitly listed and explicitly requested in the task.
- Generated-file detection is prompt-level only in v1; guards should not try to enforce generated-file semantics because detection is project-specific.
   - Writer cannot overwrite an existing file with `write`; it must use `edit`.
   - Writer child env includes JSON encoded resolved allowed paths.
   - Writer tools include `read`, `edit`, and `write` only.
   - Writer tools do not include `bash`, `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, or `ctx_search` by default.
   - Writer prompt forbids running formatters or automatic formatting in v1.
   - Child guard still blocks unsafe calls if any unexpected tool appears despite the restricted tool list.
   - Child guard allows reads for exact allowed paths, including missing allowed creation targets where read naturally fails.
   - Child guard allows edits for exact existing allowed files.
   - Child guard blocks edits outside allowed paths.
   - Child guard blocks writes outside allowed paths.
   - Child guard blocks recursive delegate tool calls.
   - Child guard blocks deletion tools or deletion-like tool calls if they appear.

### Phase 5: Cleanup old simple-subagent reference

After the reader implementation validates:

1. Ensure the implementation lives in `agent/extensions/delegates`.
2. Update README paths and validation commands.
3. Do not keep compatibility env names such as `PI_SIMPLE_SUBAGENT_BIN`; use clean delegate env names only.
4. Do not keep a `subagent` alias. Update local prompts/rules that still mention the old tool name to use `reader` only after the `reader` tool exists and passes validation. Do not update rules early, because that would make active guidance reference a tool that does not exist yet.
5. Delete `agent/extensions/simple-subagent` after reader validates. The folder is no longer needed as a live extension once the reference implementation has been copied/refactored into delegates.

## Testing plan

### Unit tests

Milestone A should keep tests in one `delegates.test.ts` file for speed and continuity with the current simple-subagent test style. Split tests into focused files only if Milestone B makes the test file too large or hard to navigate.

Add or update tests for each exported shared function.

Required test groups:

- `agent-files.test.ts`
  - frontmatter parser only treats leading block as metadata.
  - empty body handling.
  - invalid thinking level throws.
  - duplicate agents throw.

- `params.test.ts`
  - base param normalization.
  - cwd existence check.
  - reader accepts explicit cwd outside parent cwd when it exists.
  - writer cwd normalization before allowed path normalization.
  - writer accepts relative and absolute allowed paths.
  - writer rejects allowed paths outside normalized writer cwd.
  - timeout clamp.
  - max result byte clamp.
  - writer task prompt requires an implementation-ready change brief.
  - writer allowed path normalization.
  - writer rejects directory scopes.
  - writer rejects symlink escapes outside `cwd`.
  - writer realpath-normalizes existing allowed files.
  - writer allows missing exact text file creation targets.
  - writer rejects existing binary files in `allowedPaths`.
  - writer rejects binary-looking write content for new files.
  - writer rejects creating unlisted sibling files.
  - writer blocks `write` on existing files.

- `paths.test.ts`
  - session dir maps cwd under delegate sessions root.
  - reader persistent session dirs are stable per cwd only, not per agent.
  - writer fresh session dirs are unique per invocation.
  - writer fresh session dirs are deleted on success.
  - failed writer fresh session dirs are preserved only when diagnostics are enabled.
  - reader and writer session behavior is separated.
  - home path redaction.

- `profiles.test.ts`
  - model and thinking precedence is call param, then agent file, then profile defaults.
  - reader prompt has read-only contract.
  - reader prompt allows tests/builds only as read-only checks and forbids known file/external mutations.
  - reader prompt forbids dumping raw binary bytes or large binary-derived output.
  - reader prompt allows read-only generated-file inspection while avoiding manual generated-edit recommendations.
  - writer prompt has exact file read/write scope contract.
  - writer prompt explains what generated files are and warns against generated-file edits unless explicitly requested.
  - generated-file detection is not enforced by guards in v1.
  - writer boundary overrides conflicting agent role permissions.
  - agent `systemPromptMode: "replace"` cannot remove delegate safety boundaries.
  - `systemPromptMode` is parsed but affects only agent role text.
  - reader tools exclude write tools.
  - writer tools include write tools and exclude shell, Context Mode execute, and Context Mode search tools.

- `progress.test.ts`
  - task preview is redacted, whitespace-collapsed, truncated, and defaults to 120 characters for reader and writer.
  - allowed path preview is redacted, relative to writer cwd when possible, and capped to 2 paths plus `+N more` by default.
  - progress details include delegate, agent, status, phase, elapsed time, and tool count.
  - throttler emits forced updates immediately.
  - throttler limits repeated time-only updates.

- `renderers.test.ts`
  - render call shows delegate title, agent, task preview, and running status.
  - render result shows final status, duration, tool count, and optional scope.
  - collapsed render does not show `cwd`, `lastEvent`, or `lastToolName`.
  - expanded render may show redacted `cwd`, `lastEvent`, and `lastToolName`.
  - expanded rendering still redacts and truncates sensitive values.

- `json-events.test.ts`
  - final message extraction.
  - streaming fallback extraction.
  - tool call counting.
  - error metadata extraction.
  - large streaming text remains bounded.

- `redaction.test.ts`
  - Bearer token redaction.
  - `sk-...` redaction.
  - quoted and unquoted secret assignment redaction.
  - home path redaction.

- `truncation.test.ts`
  - byte limit is respected for ASCII and non-ASCII text.
  - middle truncation includes marker.

- `child-guards.test.ts`
  - read child blocks mutation tools.
  - writer child allows exact allowed path reads, including missing allowed creation targets where read naturally fails.
  - writer child allows exact existing allowed file edits.
  - writer child blocks reads and edits for disallowed paths.
  - writer child blocks sibling files inside a parent directory that was not explicitly listed.
  - writer child accepts `path` and `file_path` compatibility paths, but blocks missing or ambiguous target paths.
  - writer child blocks existing binary file reads/edits.
  - writer child blocks edit match/replacement text that looks binary or ambiguous.
  - writer child parses bounded stringified `edits` to inspect replacement text.
  - writer child blocks oversized stringified `edits` as ambiguous.
  - writer child blocks binary-looking write content for new files.
  - writer child blocks deletion tool calls.
  - writer child guard remains effective even if an unsafe tool unexpectedly appears in the child tool list.
  - symlink escape outside `cwd` is blocked where realpath is available.
  - candidate existing paths must realpath to the same regular file as an allowed entry.
  - recursive delegate tools are blocked.

### Integration tests with fake Pi

Keep the existing fake Pi strategy.

Required scenarios:

- Reader launches fake Pi with expected args and tools, including `--continue`.
- Writer launches fake Pi with expected args, tools, and env, excluding `--continue`.
- Writer fresh session dir is deleted on success.
- `includeDiagnostics` defaults to `false` for both reader and writer.
- Writer supports `includeDiagnostics: true` as an explicit debugging opt-in.
- Writer diagnostics are bounded and redacted.
- Writer failed session dir is preserved only when `includeDiagnostics` is true and reported redacted in details.
- `onUpdate` receives starting, launching, child-event, and finishing progress without changing final `content`.
- Progress updates include task preview and never include raw child stdout, stderr, tool args, or diffs.
- Writer final result includes compact file-level changed-files summary, not full diffs or changed-line references.
- Writer final result reports validation as `Not run`, `Not available`, `Parent should run: <command>`, or `Checked by inspection` only.
- Writer rejects binary, image, or ambiguous existing files, binary-looking or ambiguous new-file writes, and binary-looking or ambiguous edit match/replacement text.
- Temp files are created with expected content and cleaned up.
- Child final answer is redacted and truncated.
- Diagnostics are not imported unless allowed.
- Child marker prevents tool registration in child mode.
- No `subagent` compatibility alias is registered.

### Manual validation commands

Update README validation commands after file move.

Example:

```bash
bun agent/extensions/delegates/delegates.test.ts
bun build agent/extensions/delegates/index.ts --target=node --external @earendil-works/pi-coding-agent --external @earendil-works/pi-ai --external typebox --outfile=/tmp/delegates-check.js
node --check /tmp/delegates-check.js
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi --no-extensions -e agent/extensions/delegates/index.ts --list-models definitely-no-such-model-filter
```

## ADR update

Create an ADR when Milestone B starts or completes, not before. The decision is significant enough because it chooses:

- Separate `reader` and `writer` tools instead of one mode-heavy delegate.
- Exact-file writer scope.
- Writer fresh sessions and reader persistent per-cwd sessions.
- No legacy `subagent` alias.
- Parent-owned orchestration.
- Prompt-level generated-file caution and guard-level objective path/text safety.

Recommended ADR path:

```text
agent/extensions/delegates/docs/adr/0001-reader-writer-delegate-split.md
```

Milestone A should include README docs for the user-facing `reader` rename. The ADR can wait until Milestone B starts or completes so it captures the full reader/writer trade-off.

## README updates

The README should explain:

- Difference between `reader` and `writer`.
- Delegates reduce parent-agent memory and tool-call noise; the parent agent remains the orchestrator.
- That reader sessions are persistent per cwd and may be shared by different reader agents for that cwd.
- That `writer.task` is a specific change brief, not an investigation request.
- That delegate outputs use `## Parent considerations` instead of `## Next step`.
- Why writer requires `allowedPaths`.
- Why writer does not get shell tools by default.
- How to use reader for investigation.
- How to use writer for scoped edits.
- That there is no legacy `subagent` alias; use `reader` for read-only delegation.
- How child process recursion is prevented.
- How child guards enforce writer path scope.
- Validation commands.

Example usage:

```text
Use reader with agent "investigator" and task "Inspect the auth flow and report the files that need edits. Do not edit files."
```

```text
Use writer with agent "implementer", allowedPaths ["src/auth/login.ts", "src/auth/login.test.ts"], and task "Apply the login timeout fix described by the reader. Keep changes limited to the allowed paths."
```

## Recommended implementation order

Milestone A - reader replacement:

1. Extract constants and toolsets into the new `agent/extensions/delegates` implementation, using `simple-subagent` only as reference material.
2. Extract parser, path, param, JSON event, process, redaction, truncation, text-file helper stubs if needed, and result helpers.
3. Add shared `DelegateProfile` architecture and type definitions that anticipate writer, including `DelegateToolName = "reader" | "writer"`, but do not expose writer publicly yet.
4. Register `readerProfile` as the clean replacement for the old tool.
5. Add shared progress details, throttled `onUpdate` plumbing, and UI renderers.
6. Add only the child recursion guard in Milestone A: `PI_DELEGATE_CHILD` prevents delegate tools from registering in child processes.
7. Do not add writer path/text guards until Milestone B.
8. Do not register `writer` in Milestone A.
9. Do not register old `subagent` as an alias.
10. Add/update README for Milestone A because `reader` is user-facing.
11. Validate `reader` end-to-end before adding writer capability.

Milestone B - writer addition:

11. Extend the child guard framework with writer path/text guards.
12. Add `writer` profile with required `allowedPaths`.
13. Add writer child path/text guard tests.
14. Update README for writer additions.
15. Create or update the ADR when Milestone B starts or completes.
16. Implement directly in `agent/extensions/delegates`; do not implement new work in `agent/extensions/simple-subagent`.
17. Treat `agent/extensions/simple-subagent` as temporary reference material only, and delete it after the delegates implementation is validated.
18. After `reader` is implemented and validated, update local rules/prompts that mention the old `subagent` tool to use `reader`.
19. Run all tests and build checks.

## Complexity control checklist

Use this checklist during implementation:

- No `if (profile.name === "reader")` in `runner.ts`.
- No `if (profile.name === "writer")` in `runner.ts`.
- No `mode` parameter on writer.
- No mixed reader/writer prompt builder.
- No mixed reader/writer schema.
- No duplicated child process runner.
- No duplicate JSON event parser.
- No duplicate redaction logic.
- No duplicate temp file logic.
- No duplicate progress formatting logic.
- No progress logs in final `content`.
- No full diffs or changed-line references in writer final `content` by default.
- No writer shell tools by default.
- No writer deletion tools or deletion behavior.
- Writer safety requires both restricted `--tools` and child `tool_call` blocking.
- No writer full-file overwrite of existing files.
- No writer binary, image, or ambiguous file read/create/modify in v1; parent/reader handles detected or ambiguous binary content.
- No writer automatic formatting in v1; parent owns formatting decisions.
- No writer package-manager or generator execution for lockfiles/generated files; parent owns those decisions.
- No writer lockfile/generated-file edits unless explicitly listed and explicitly requested.
- No guard-level generated-file detection in v1; keep it prompt-level because it is project-specific.
- No delegate-to-delegate orchestration recommendations; parent decides follow-up actions.
- No agent `systemPromptMode` can remove reader/writer delegate safety boundaries.
- Reader tests/builds must be read-only checks only; no known file/external mutations.
- Reader may summarize binary assets but must not dump raw binary content.
- Reader may inspect generated files read-only and identify generated status when relevant.
- No `## Next step` heading in delegate output contracts.
- No recursive delegate tools in child processes.
- Writer must have non-empty `allowedPaths`.
- Writer path scope must be enforced by child guard, not only by prompt.

## Open decisions

1. Extension directory name:
   - Decision: implement directly in `agent/extensions/delegates`. Do not implement new work in `agent/extensions/simple-subagent`; that folder is temporary reference material and should be deleted after delegates are validated.

2. Old tool-name compatibility:
   - Recommended: do not create it. Keep the delegate surface to `reader` and `writer` only.

3. Writer validation:
   - Recommended: parent validates after writer. Do not give writer shell tools by default.

4. Session directory policy:
   - Recommended: reader uses `delegate-sessions/reader/<cwd-segments>` with `--continue` to retain Context Mode memory per target cwd; writer uses a fresh per-invocation session dir without `--continue`, deletes it on success, and preserves it on failure only when diagnostics are enabled.

5. Future validator:
   - Recommended: add a separate `validator` profile if child-side test execution becomes necessary.

6. Rules and prompt migration timing:
   - Recommended: do not update rules/prompts from `subagent` to `reader` before the `reader` tool exists and passes validation. Update those references in the same implementation change after the tool rename is functional.

7. ADR timing:
   - Recommended: create an ADR when Milestone B starts or completes, using this plan as source material. Milestone A should still include README docs for the user-facing `reader` rename.

## Success criteria

The refactor is successful when:

Milestone A success:

- `reader` is available and behaves like the current read-only delegation behavior.
- Milestone A may include writer-ready shared types, including `DelegateToolName = "reader" | "writer"`, but it does not register or expose `writer`.
- Progress UI and renderers work without changing final model-visible content.
- The old `subagent` tool is not registered.
- Child recursion guard prevents delegate tools from registering in child processes.
- Writer path/text guards are not included until Milestone B.

Milestone B success:

- `writer` is available and can edit only scoped local paths.
- Shared functions, types, schemas, constants, and process helpers are exported from focused modules.
- Reader uses persistent child sessions per cwd, shared by reader agents for that cwd; writer uses fresh child sessions.
- `includeDiagnostics` defaults to `false` for both reader and writer.
- Writer supports bounded/redacted diagnostics by explicit opt-in.
- Writer fresh sessions are deleted on success and preserved on failure only with diagnostics enabled.
- The shared runner has no reader/writer conditionals.
- Child processes cannot recursively register delegate tools.
- Live progress shows delegate title, agent, task preview, status, elapsed time, and tool count without changing final model-visible content.
- Unit and fake-Pi integration tests cover reader, writer, and progress rendering without old alias behavior.
- Implementation lives in `agent/extensions/delegates`; restored `agent/extensions/simple-subagent` is removed after validation.
- README explains the safety model, progress UI, compact file-level writer summaries, explicit validation status, and usage clearly.
- ADR records the reader/writer split and safety trade-offs once Milestone B starts or completes.
