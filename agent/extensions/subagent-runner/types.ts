import type { AGENTS, MODES } from "./constants.ts";

export type AgentName = (typeof AGENTS)[number];
export type Mode = (typeof MODES)[number];
export type Status = "ok" | "blocked" | "error";
export type Confidence = "low" | "medium" | "high";

export type AvailableModel = {
  provider: string;
  model: string;
};

export type ModelSelector = {
  raw: string;
  provider?: string;
  model: string;
  thinkingSuffix: string;
};

export type ModelResolution =
  | {
      ok: true;
      requested: string;
      model: string;
      suggestions: string[];
    }
  | {
      ok: false;
      requested: string;
      diagnostic: string;
      blockers: string[];
      suggestions: string[];
      command?: string;
    };

export type ChildRunResult = {
  state: ObservedChildState;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputCapExceeded: boolean;
  stderr: string;
};

export type InvalidReportedPath = {
  field: string;
  path: string;
};

export type Evidence = {
  file?: string;
  line?: number;
  symbol?: string;
  command?: string;
  reason: string;
};

export type SubagentParams = {
  agent: AgentName;
  task: string;
  cwd?: string;
  workstream?: string;
  mode?: Mode;
  timeoutMs?: number;
  model?: string;
  reset?: boolean;
  allowRecursive?: boolean;
};

export type SubagentResult = {
  status: Status;
  agent: AgentName;
  summary: string;
  finding: string;
  evidence: Evidence[];
  toolsUsed: string[];
  filesRead: string[];
  filesChanged: string[];
  confidence: Confidence;
  blockers: string[];
  recommendedNextStep: string;
  workstream?: string;
  sessionDir?: string;
  sessionId?: string;
  durationMs?: number;
  model?: string;
};

export type ObservedChildState = {
  finalText: string;
  currentAssistantText: string;
  inAssistantMessage: boolean;
  sessionId?: string;
  toolsUsed: Set<string>;
  parseErrors: number;
  skippedLargeLines: number;
  toolUseViolations?: string[];
  toolResultWarnings?: string[];
  toolUseTexts?: string[];
};
