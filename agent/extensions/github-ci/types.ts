export type Outcome = "PASS" | "FAIL" | "TIMEOUT" | "CANCELLED";

export interface RunSnapshot {
  status: string;
  conclusion: string | null;
  attempt: number | null;
  headSha: string | null;
  event: string | null;
  url: string | null;
}

export interface RunState extends RunSnapshot {
  id: number;
  label?: string;
}

export interface FailedJob {
  name: string;
  conclusion: string;
  steps: string[];
  omittedSteps: number;
  url: string | null;
}

export interface FailureSummary {
  jobs: FailedJob[];
  omittedJobs: number;
  error?: "unavailable" | "cancelled" | "timeout";
}

export interface WaitDetails {
  outcome: Outcome;
  elapsedSeconds: number;
  pollCount: number;
  runs: RunState[];
  failures: Array<FailureSummary & { id: number }>;
}

export interface WatchDependencies {
  queryRun(repo: string, id: number, signal: AbortSignal): Promise<RunSnapshot>;
  queryFailureSummary(
    repo: string,
    id: number,
    signal: AbortSignal,
  ): Promise<FailureSummary>;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  now(): number;
}
