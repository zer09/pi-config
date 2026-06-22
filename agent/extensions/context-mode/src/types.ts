export type JsonSchema = Record<string, unknown>;

export type TextContent = { type: "text"; text: string };

export type ToolResult = {
  content: TextContent[];
  details?: Record<string, unknown>;
  isError?: boolean;
  terminate?: boolean;
};

export type ToolUpdate = ToolResult;

export type PiRenderTheme = {
  bold(text: string): string;
  fg(color: string, text: string): string;
};

export type PiRenderContext = {
  lastComponent?: unknown;
  args?: unknown;
  state?: Record<string, unknown>;
  invalidate?: () => void;
  toolCallId?: string;
  cwd?: string;
  executionStarted?: boolean;
  argsComplete?: boolean;
  isPartial?: boolean;
  expanded?: boolean;
  showImages?: boolean;
  isError?: boolean;
};

export type Component = {
  render(width: number): string[];
  invalidate(): void;
  handleInput?(data: string): void;
};

export type ToolRegistration<TParams extends Record<string, unknown> = Record<string, unknown>> = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: JsonSchema;
  renderCall?: (args: TParams, theme: PiRenderTheme, context: PiRenderContext) => Component;
  renderResult?: (
    result: ToolResult,
    options: { expanded: boolean; isPartial: boolean },
    theme: PiRenderTheme,
    context: PiRenderContext,
  ) => Component;
  execute: (
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: (result: ToolUpdate) => void,
    ctx?: ExtensionContextLike,
  ) => Promise<ToolResult>;
};

export type ExtensionApiLike = {
  registerTool(tool: ToolRegistration): void;
  on?(event: "session_shutdown", handler: (event: unknown, ctx: ExtensionContextLike) => void | Promise<void>): void;
};

export type ExtensionContextLike = {
  cwd?: string;
};

export type LeanToolName = "ctx_execute_file" | "ctx_batch_execute" | "ctx_search";

export type RegisteredCtxTool = {
  name: string;
  config?: {
    inputSchema?: {
      parse?: (input: unknown) => unknown;
    };
  };
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type Backend = {
  tools: Map<string, RegisteredCtxTool>;
  withProjectDirOverride: <T>(
    project: string | { projectDir: string; sessionId?: string },
    fn: () => Promise<T>,
  ) => Promise<T>;
};
