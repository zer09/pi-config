import { Buffer } from "node:buffer";
import { stripVTControlCharacters } from "node:util";
import type { WaitDetails } from "./types.ts";

export function clip(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  let result = "";
  let used = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (used + size > bytes - 3) break;
    result += character;
    used += size;
  }
  return `${result}...`;
}

export function safeText(value: unknown, bytes = 64): string {
  if (typeof value !== "string") return "unnamed";
  const text = stripVTControlCharacters(value)
    .replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}{}\[\]`"\\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return clip(text || "unnamed", bytes);
}

export function safeUrl(
  value: unknown,
  repo: string,
  id: number,
  job = false,
): string | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const prefix = `/${repo}/actions/runs/${id}`;
    if (!url.pathname.startsWith(prefix)) return null;
    const suffix = url.pathname.slice(prefix.length);
    if (
      job
        ? !/^\/job\/\d+$/.test(suffix)
        : !/^(?:\/attempts\/\d+)?$/.test(suffix)
    )
      return null;
    // Query strings and fragments can carry credentials. They are not needed to open a run or job.
    const result = `${url.origin}${url.pathname}`;
    if (/(?:github_pat_|gh[pousr]_)/i.test(result)) return null;
    return Buffer.byteLength(result) <= 220 ? result : null;
  } catch {
    return null;
  }
}

export function formatResult(details: WaitDetails): string {
  const lines = [
    `${details.outcome}: (${details.elapsedSeconds}s; ${details.pollCount} polls)`,
  ];
  for (const run of details.runs) {
    const label = run.label ? `${safeText(run.label, 48)} ` : "";
    const status =
      run.status === "completed"
        ? `completed/${run.conclusion ?? "unknown"}`
        : run.status;
    lines.push(
      `${label}#${run.id} attempt ${run.attempt ?? "?"}: ${safeText(status, 48)}`,
    );
  }
  for (const failure of details.failures) {
    if (failure.error)
      lines.push(`  #${failure.id} failure summary ${failure.error}`);
    for (const job of failure.jobs) {
      let line = `  #${failure.id} ${job.name}: ${job.conclusion}`;
      if (job.steps.length) line += `; steps: ${job.steps.join(", ")}`;
      if (job.omittedSteps) line += ` (+${job.omittedSteps} steps)`;
      if (job.url) line += `; ${job.url}`;
      lines.push(line);
    }
    if (failure.omittedJobs)
      lines.push(
        `  #${failure.id} +${failure.omittedJobs} failed jobs omitted`,
      );
  }
  // Keep every run line. Only optional failure detail can reach these limits.
  const output: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (output.length === 23 || bytes + Buffer.byteLength(line) + 1 > 3850) {
      output.push("... failure details truncated");
      break;
    }
    output.push(line);
    bytes += Buffer.byteLength(line) + 1;
  }
  return output.join("\n");
}
