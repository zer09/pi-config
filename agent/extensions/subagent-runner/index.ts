import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  AGENTS,
  CONFIDENCE,
  DEFAULT_TIMEOUT_MS,
  FAILED_TOOL_RESULT_PATTERN,
  HOME_PREFIX,
  INCOMPLETE_OK_RESULT_PATTERN,
  LOG_DIR,
  LOG_FILE,
  MAX_ARRAY_ITEMS,
  MAX_EVIDENCE_ITEMS,
  MAX_FIELD_CHARS,
  MAX_FINDING_CHARS,
  MAX_JSON_LINE_BYTES,
  MAX_RESULT_RETRIES,
  MAX_STDERR_BYTES,
  MAX_SUMMARY_CHARS,
  MAX_TIMEOUT_MS,
  MODES,
  NEGATIVE_EXISTENCE_RESULT_PATTERN,
  NO_MATCH_TOOL_RESULT_PATTERN,
  POSITIVE_EXISTENCE_TASK_PATTERN,
  QUOTED_TILDE_PATH_PATTERN,
  STATUSES,
} from "./constants.ts";
import {
  buildBootstrapPrompt,
  buildTaskPayload,
  extractRoleDefaultModel,
  readRolePrompt,
  selectSubagentModel,
} from "./prompt.ts";
import {
  parseListModelsOutput,
  resolveModelFromListOutput,
  resolveSubagentModel,
  splitModelSelector,
} from "./models.ts";
import {
  buildSessionDir,
  deriveWorkstream,
  expandHomePath,
  replaceHome,
  resolveCwd,
  sanitizeSlug,
} from "./path-utils.ts";
import { compactString, redactForReturn } from "./redaction.ts";
import type {
  ChildRunResult,
  Confidence,
  Evidence,
  InvalidReportedPath,
  ObservedChildState,
  Status,
  SubagentParams,
  SubagentResult,
} from "./types.ts";

export {
  buildSessionDir,
  deriveWorkstream,
  expandHomePath,
  replaceHome,
  resolveCwd,
  sanitizeSlug,
} from "./path-utils.ts";
export {
  buildBootstrapPrompt,
  extractRoleDefaultModel,
  selectSubagentModel,
} from "./prompt.ts";
export {
  parseListModelsOutput,
  resolveModelFromListOutput,
  splitModelSelector,
} from "./models.ts";
export { compactString, redactForReturn } from "./redaction.ts";
export type { ObservedChildState } from "./types.ts";

export function buildPiArgs(
  params: SubagentParams,
  sessionDir: string,
  bootstrapPrompt: string,
): string[] {
  const args = ["--mode", "json", "--session-dir", sessionDir];
  if (!params.reset) args.push("--continue");
  args.push("--append-system-prompt", bootstrapPrompt);
  if (params.model?.trim()) args.push("--model", params.model.trim());
  args.push(`Sub-agent task:\n${buildTaskPayload(params)}`);
  return args;
}

function extractStringContentText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return content;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return content;
    const type =
      typeof parsed.type === "string" ? parsed.type.toLowerCase() : "";
    if (type === "text" && typeof parsed.text === "string") return parsed.text;
    if (
      (type === "thinking" ||
        type === "reasoning" ||
        type === "toolcall" ||
        type === "tool_call") &&
      !("status" in parsed)
    )
      return "";
  } catch {
    return content;
  }
  return content;
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const candidate = message as { content?: unknown };
  if (typeof candidate.content === "string")
    return extractStringContentText(candidate.content);
  if (!Array.isArray(candidate.content)) return "";
  return candidate.content
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function pushUnique(list: string[] | undefined, value: string): string[] {
  const output = list ?? [];
  if (!output.includes(value)) output.push(value);
  return output;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? "" : json;
  } catch {
    return String(value);
  }
}

function observeToolCallsFromContent(
  content: unknown,
  state: ObservedChildState,
): void {
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    const type =
      typeof record.type === "string" ? record.type.toLowerCase() : "";
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.toolName === "string"
          ? record.toolName
          : undefined;
    if (!name || (!type.includes("tool") && !("arguments" in record))) continue;
    state.toolsUsed.add(name);
    const argumentsText = stringifyUnknown(
      record.arguments ?? record.args ?? record.input,
    );
    if (argumentsText.trim())
      state.toolUseTexts = pushUnique(
        state.toolUseTexts,
        compactString(redactForReturn(argumentsText), "", MAX_FIELD_CHARS),
      );
    if (QUOTED_TILDE_PATH_PATTERN.test(argumentsText)) {
      state.toolUseViolations = pushUnique(
        state.toolUseViolations,
        "A tool call used a literal `~/...` path. Context Mode tool arguments must use absolute paths; redact to `~` only in final JSON.",
      );
    }
  }
}

function observeToolResultText(text: string, state: ObservedChildState): void {
  if (!text.trim()) return;
  if (NO_MATCH_TOOL_RESULT_PATTERN.test(text)) {
    state.toolResultWarnings = pushUnique(
      state.toolResultWarnings,
      "A Context Mode search result reported no matching sections.",
    );
  }
  if (FAILED_TOOL_RESULT_PATTERN.test(text)) {
    state.toolResultWarnings = pushUnique(
      state.toolResultWarnings,
      "A tool result reported a failed command or missing path.",
    );
  }
}

export function observeJsonLine(line: string, state: ObservedChildState): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event: any;
  try {
    event = JSON.parse(trimmed);
  } catch {
    state.parseErrors += 1;
    return;
  }

  if (event?.type === "session" && typeof event.id === "string")
    state.sessionId = event.id;
  if (typeof event?.toolName === "string") {
    state.toolsUsed.add(event.toolName);
    const argumentsText = stringifyUnknown(event.args ?? event.arguments);
    if (argumentsText.trim())
      state.toolUseTexts = pushUnique(
        state.toolUseTexts,
        compactString(redactForReturn(argumentsText), "", MAX_FIELD_CHARS),
      );
    if (QUOTED_TILDE_PATH_PATTERN.test(argumentsText)) {
      state.toolUseViolations = pushUnique(
        state.toolUseViolations,
        "A tool call used a literal `~/...` path. Context Mode tool arguments must use absolute paths; redact to `~` only in final JSON.",
      );
    }
  }
  if (event?.toolCall && typeof event.toolCall.name === "string") {
    state.toolsUsed.add(event.toolCall.name);
    const argumentsText = stringifyUnknown(
      event.toolCall.arguments ?? event.toolCall.args ?? event.toolCall.input,
    );
    if (argumentsText.trim())
      state.toolUseTexts = pushUnique(
        state.toolUseTexts,
        compactString(redactForReturn(argumentsText), "", MAX_FIELD_CHARS),
      );
    if (QUOTED_TILDE_PATH_PATTERN.test(argumentsText)) {
      state.toolUseViolations = pushUnique(
        state.toolUseViolations,
        "A tool call used a literal `~/...` path. Context Mode tool arguments must use absolute paths; redact to `~` only in final JSON.",
      );
    }
  }
  observeToolCallsFromContent(event?.message?.content, state);

  if (event?.type === "message" && event.message?.role === "assistant") {
    const text = extractAssistantText(event.message);
    if (text.trim()) {
      state.finalText = text;
      state.currentAssistantText = text;
    }
    state.inAssistantMessage = false;
  }

  if (event?.type === "message" && event.message?.role === "toolResult") {
    observeToolResultText(extractAssistantText(event.message), state);
  }

  if (event?.type === "message_start") {
    state.inAssistantMessage = event.message?.role === "assistant";
    if (state.inAssistantMessage) state.currentAssistantText = "";
  }

  if (
    event?.type === "message_update" &&
    event.assistantMessageEvent?.type === "text_delta" &&
    typeof event.assistantMessageEvent.delta === "string"
  ) {
    state.inAssistantMessage = true;
    state.currentAssistantText += event.assistantMessageEvent.delta;
    if (state.currentAssistantText.trim())
      state.finalText = state.currentAssistantText;
  }

  if (Array.isArray(event?.toolResults)) {
    for (const result of event.toolResults) {
      if (typeof result?.toolName === "string")
        state.toolsUsed.add(result.toolName);
      observeToolResultText(stringifyUnknown(result), state);
    }
  }

  if (event?.type === "message_end" && event.message?.role === "assistant") {
    const text =
      extractAssistantText(event.message) || state.currentAssistantText;
    if (text.trim()) state.finalText = text;
    state.inAssistantMessage = false;
  }

  if (event?.type === "turn_end") {
    const text =
      extractAssistantText(event.message) || state.currentAssistantText;
    if (text.trim()) state.finalText = text;
  }

  if (event?.type === "agent_end" && Array.isArray(event.messages)) {
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (message?.role === "assistant") {
        const text = extractAssistantText(message);
        if (text.trim()) state.finalText = text;
        break;
      }
    }
  }
}

function repairTruncatedJsonObject(candidate: string): string | null {
  const first = candidate.indexOf("{");
  if (first === -1) return null;
  let repaired = candidate.slice(first).trimEnd();
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of repaired) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) return null;
      stack.pop();
    }
  }

  if (!stack.length && !inString && !escaped) return null;
  if (escaped) repaired = repaired.slice(0, -1);
  if (inString) repaired += '"';
  if (/[:,]\s*$/.test(repaired)) return null;
  for (let index = stack.length - 1; index >= 0; index -= 1)
    repaired += stack[index] === "{" ? "}" : "]";
  return repaired;
}

export function parseJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first === -1) return null;
    if (last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1));
      } catch {
        // Continue to bounded repair below.
      }
    }
    const repaired = repairTruncatedJsonObject(candidate);
    if (!repaired) return null;
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

function normalizeStatus(value: unknown): Status | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "ok" ||
    normalized === "pass" ||
    normalized === "passed" ||
    normalized === "success" ||
    normalized === "succeeded"
  )
    return "ok";
  if (normalized === "blocked" || normalized === "block") return "blocked";
  if (
    normalized === "error" ||
    normalized === "fail" ||
    normalized === "failed" ||
    normalized === "failure"
  )
    return "error";
  return null;
}

function normalizeConfidence(value: unknown): Confidence {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (CONFIDENCE.has(normalized)) return normalized as Confidence;
    if (normalized === "certain") return "high";
    if (normalized === "unknown") return "low";
  }
  return "medium";
}

function asStringArray(value: unknown, maxItems = MAX_ARRAY_ITEMS): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  return items
    .slice(0, maxItems)
    .filter(
      (item): item is string =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        !/^(none|no|n\/a|null|undefined|\[\])$/i.test(item.trim()),
    )
    .map((item) => compactString(item, "", MAX_FIELD_CHARS));
}

function evidenceReason(item: unknown): string {
  if (typeof item === "string")
    return compactString(item, "Evidence item", MAX_FIELD_CHARS);
  if (!item || typeof item !== "object")
    return compactString(item, "Evidence item", MAX_FIELD_CHARS);
  const record = item as Record<string, unknown>;
  if (typeof record.reason === "string" && record.reason.trim())
    return compactString(record.reason, "Evidence item", MAX_FIELD_CHARS);
  if (typeof record.detail === "string" && record.detail.trim())
    return compactString(record.detail, "Evidence item", MAX_FIELD_CHARS);
  const check = typeof record.check === "string" ? record.check : undefined;
  const result = typeof record.result === "string" ? record.result : undefined;
  if (check || result)
    return compactString(
      [check, result].filter(Boolean).join(": "),
      "Evidence item",
      MAX_FIELD_CHARS,
    );
  return compactString(record, "Evidence item", MAX_FIELD_CHARS);
}

function normalizeEvidence(value: unknown): Evidence[] {
  const items = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return items.slice(0, MAX_EVIDENCE_ITEMS).map((item) => {
    if (!item || typeof item !== "object")
      return { reason: evidenceReason(item) };
    const record = item as Record<string, unknown>;
    return {
      ...(typeof record.file === "string"
        ? { file: compactString(record.file, "", MAX_FIELD_CHARS) }
        : typeof record.path === "string"
          ? { file: compactString(record.path, "", MAX_FIELD_CHARS) }
          : {}),
      ...(typeof record.line === "number" ? { line: record.line } : {}),
      ...(typeof record.symbol === "string"
        ? { symbol: compactString(record.symbol, "", MAX_FIELD_CHARS) }
        : {}),
      ...(typeof record.command === "string"
        ? { command: compactString(record.command, "", MAX_FIELD_CHARS) }
        : {}),
      reason: evidenceReason(record),
    };
  });
}

function hasBlockingValue(value: unknown): boolean {
  return asStringArray(value).length > 0;
}

function inferBooleanStatus(value: unknown): Status | null {
  if (typeof value === "boolean") return value ? "ok" : "error";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes") return "ok";
  if (normalized === "false" || normalized === "no") return "error";
  return normalizeStatus(value);
}

function inferStatus(input: Record<string, unknown>): Status | null {
  const explicit = normalizeStatus(input.status);
  if (explicit) return explicit;
  if (hasBlockingValue(input.blockers) || hasBlockingValue(input.blocker))
    return "blocked";
  const booleanStatus =
    inferBooleanStatus(input.ok) ??
    inferBooleanStatus(input.success) ??
    inferBooleanStatus(input.passed);
  if (booleanStatus) return booleanStatus;
  if (input.summary !== undefined || input.finding !== undefined) return "ok";
  return null;
}

export function validateAndNormalize(
  value: unknown,
  params: SubagentParams,
  observed: ObservedChildState,
  metadata: {
    workstream: string;
    sessionDir: string;
    durationMs: number;
    model?: string;
  },
): SubagentResult | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const status = inferStatus(input);
  if (!status) return null;

  const confidence = normalizeConfidence(input.confidence);
  const recommendedCandidate =
    input.recommendedNextStep ??
    input.recommended_next_step ??
    (Array.isArray(input.recommended_next_steps)
      ? input.recommended_next_steps[0]
      : input.recommended_next_steps);
  const fallbackResultText = compactString(
    input,
    "Sub-agent returned a structured result.",
    MAX_FINDING_CHARS,
  );
  const summary = compactString(
    input.summary ?? input.finding ?? fallbackResultText,
    "Sub-agent returned a structured result.",
    MAX_SUMMARY_CHARS,
  );
  const finding = compactString(
    input.finding ?? input.summary ?? fallbackResultText,
    "No specific finding returned.",
    MAX_FINDING_CHARS,
  );
  const recommendedNextStep = compactString(
    recommendedCandidate,
    "Review the sub-agent result and decide the next step.",
    MAX_FIELD_CHARS,
  );

  const toolsUsed = [
    ...new Set([
      ...asStringArray(input.toolsUsed),
      ...asStringArray(input.tools_used),
      ...observed.toolsUsed,
    ]),
  ].sort();
  return {
    status,
    agent: params.agent,
    summary,
    finding,
    evidence: normalizeEvidence(input.evidence),
    toolsUsed,
    filesRead: [
      ...new Set([
        ...asStringArray(input.filesRead),
        ...asStringArray(input.files_read),
      ]),
    ],
    filesChanged: [
      ...new Set([
        ...asStringArray(input.filesChanged),
        ...asStringArray(input.files_changed),
      ]),
    ],
    confidence,
    blockers: [
      ...new Set([
        ...asStringArray(input.blockers),
        ...asStringArray(input.blocker),
      ]),
    ],
    recommendedNextStep,
    workstream: metadata.workstream,
    sessionDir: replaceHome(metadata.sessionDir),
    sessionId: observed.sessionId,
    durationMs: metadata.durationMs,
    model: metadata.model,
  };
}

export function shouldRetryNoToolResult(
  result: SubagentResult | null,
  observedToolCount = 0,
): boolean {
  return Boolean(result && observedToolCount === 0);
}

export function shouldRetryNoToolBlockedResult(
  result: SubagentResult | null,
  observedToolCount = 0,
): boolean {
  return shouldRetryNoToolResult(result, observedToolCount);
}

function resolveReportedPath(value: string, cwd: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  const withoutLine = trimmed.replace(/:\d+(?::\d+)?$/, "");
  if (withoutLine.startsWith("~/"))
    return join(HOME_PREFIX, withoutLine.slice(2));
  if (withoutLine.startsWith("/")) return withoutLine;
  return resolve(cwd, withoutLine.replace(/^\.\//, ""));
}

export function findInvalidReportedPaths(
  result: SubagentResult | null,
  cwd: string,
): InvalidReportedPath[] {
  if (!result) return [];
  const invalid: InvalidReportedPath[] = [];
  const check = (field: string, value: string) => {
    const resolved = resolveReportedPath(value, cwd);
    if (resolved && !existsSync(resolved))
      invalid.push({ field, path: compactString(value, "", MAX_FIELD_CHARS) });
  };
  for (const item of result.evidence) {
    if (item.file) check("evidence.file", item.file);
  }
  for (const file of result.filesRead) check("filesRead", file);
  return invalid.slice(0, MAX_EVIDENCE_ITEMS);
}

function resolveSubjectReportedPath(value: string, cwd: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  const withoutLine = trimmed.replace(/:\d+(?::\d+)?$/, "");
  const expanded = expandHomePath(withoutLine.replace(/^\.\//, ""));
  const resolved = resolve(cwd, expanded);
  return resolved === cwd || resolved.startsWith(`${cwd}/`) ? resolved : null;
}

function findUnsupportedSubjectEvidence(
  result: SubagentResult,
  observed: ObservedChildState,
  cwd?: string,
): Evidence[] {
  if (!cwd) return [];
  const resolvedCwd = resolve(cwd);
  const toolUseText = (observed.toolUseTexts ?? []).join("\n");
  if (!toolUseText.trim()) return [];
  const redactedToolUseText = replaceHome(toolUseText);
  const cwdTokens = [resolvedCwd, replaceHome(resolvedCwd)].filter(Boolean);
  const hasSubjectCwdToolUse = cwdTokens.some(
    (token) =>
      token &&
      (toolUseText.includes(token) || redactedToolUseText.includes(token)),
  );
  const unsupported: Evidence[] = [];
  const citedFiles = [
    ...result.filesRead,
    ...result.evidence
      .map((item) => item.file)
      .filter((file): file is string => Boolean(file)),
  ];
  for (const file of [...new Set(citedFiles)]) {
    const resolvedFile = resolveSubjectReportedPath(file, resolvedCwd);
    if (!resolvedFile || resolvedFile === resolvedCwd) continue;
    const relative = resolvedFile.slice(resolvedCwd.length + 1);
    if (!relative || relative.startsWith("..")) continue;
    const exactTokens = [resolvedFile, replaceHome(resolvedFile)];
    const relativeTokens = [relative, `./${relative}`];
    const hasExactFileToolUse = exactTokens.some(
      (token) =>
        token &&
        (toolUseText.includes(token) || redactedToolUseText.includes(token)),
    );
    const hasRelativeFileUnderCwdToolUse =
      hasSubjectCwdToolUse &&
      relativeTokens.some(
        (token) =>
          toolUseText.includes(token) || redactedToolUseText.includes(token),
      );
    if (!hasExactFileToolUse && !hasRelativeFileUnderCwdToolUse) {
      unsupported.push({
        file,
        reason:
          "The child cited a subject-repository file, but observed tool calls did not reference that file or the subject working directory.",
      });
    }
  }
  return unsupported.slice(0, MAX_EVIDENCE_ITEMS);
}

export function findSuspiciousOkResult(
  result: SubagentResult | null,
  observed: ObservedChildState,
  originalTask: string,
  cwd?: string,
): Evidence[] {
  if (!result || result.status !== "ok") return [];
  const reasons: Evidence[] = [];
  for (const reason of observed.toolUseViolations ?? [])
    reasons.push({ reason });
  for (const reason of findUnsupportedSubjectEvidence(result, observed, cwd))
    reasons.push(reason);

  const resultText = [
    result.summary,
    result.finding,
    result.recommendedNextStep,
    ...result.evidence.flatMap((item) => [
      item.reason,
      item.command ?? "",
      item.file ?? "",
      item.symbol ?? "",
    ]),
  ].join("\n");
  const warnings = observed.toolResultWarnings ?? [];
  if (
    warnings.some((warning) => /no matching sections/i.test(warning)) &&
    /No matching sections found|returned\s+`?no`?|does\s+not\s+exist|not\s+present|missing/i.test(
      resultText,
    )
  ) {
    reasons.push({
      reason:
        "The child returned status ok while a tool result reported no matching sections and the final evidence indicates a negative or unmatched check.",
    });
  }
  if (
    warnings.some((warning) => /failed command|missing path/i.test(warning)) &&
    /Exit code|command not found|No such file or directory|failed/i.test(
      resultText,
    )
  ) {
    reasons.push({
      reason:
        "The child returned status ok while citing or relying on a failed tool result.",
    });
  }
  if (
    POSITIVE_EXISTENCE_TASK_PATTERN.test(originalTask) &&
    NEGATIVE_EXISTENCE_RESULT_PATTERN.test(resultText)
  ) {
    reasons.push({
      reason:
        "The child returned status ok even though the task asked to verify an existing directory and the final result says it was missing or not a directory.",
    });
  }
  if (INCOMPLETE_OK_RESULT_PATTERN.test(resultText)) {
    reasons.push({
      reason:
        "The child returned status ok while its final text says the requested subject-matter inspection is incomplete or still needs another tool call.",
    });
  }
  return reasons.slice(0, MAX_EVIDENCE_ITEMS);
}

export function buildNoToolRetryTask(originalTask: string): string {
  return `Your previous sub-agent result was rejected because it returned final JSON without any observed tool calls.

You are already authorized to run read-only inspection. Do not ask for permission. Do not answer that startup reads need to happen first; call the tools to do them. Your very next assistant response must be an actual read-only Context Mode or Code Review Graph tool call, not final JSON, reasoning-only text, planning-only text, or prose that describes a tool you intend to use. If no subject-specific command is required, call Context Mode with a tiny JavaScript or shell check that prints a compact marker, then wait for the tool result. Do not claim a tool was used in toolsUsed or evidence unless you actually made a tool call in this child session. After receiving the tool result, return the required single-line minified JSON object. If a tool call is genuinely impossible, return status "error" with blocker "child_did_not_execute_tools" and explain the concrete tool failure.

Original task:
${originalTask}`;
}

export function buildInvalidFinalRetryTask(originalTask: string): string {
  return `Your previous sub-agent response was rejected because the final assistant message was missing, not parseable JSON, or had the wrong top-level keys for the required sub-agent schema.

Continue the task now. Use any required read-only tools, then return only a single-line minified JSON object. Do not include prose before or after the JSON. The final JSON must use the sub-agent result schema with top-level status, summary, finding, evidence, toolsUsed, filesRead, filesChanged, confidence, blockers, and recommendedNextStep. If the original task requested a different custom JSON shape, do not repeat that shape at the top level; put those requested fields or marker values inside summary, finding, or evidence.reason.

Original task:
${originalTask}`;
}

export function buildSuspiciousOkRetryTask(
  originalTask: string,
  reasons: Evidence[],
): string {
  const details = reasons.map((item) => item.reason).join("\n");
  return `Your previous sub-agent result was rejected because it returned status "ok" while its observed tool usage or final evidence looked inconsistent with the requested check.

Do the check again with absolute paths in every tool argument, including startup file reads. Use \`${HOME_PREFIX}/.pi/agent/...\` for home Pi rule files and the absolute subject-repository path for subject files. Do not use quoted tilde paths such as \`cd '~/repo'\` or \`path: "~/repo/file"\`, and do not pass \`~/.pi/...\` or \`~/development/...\` as a Context Mode path argument.

Your next assistant response must be a tool call that directly inspects the subject file or subject working directory required by the original task. Startup rule-file reads alone are not enough. Do not return final JSON until you have received a successful subject-specific tool result in this retry turn. Do not claim that you read a subject file unless an actual tool call in this retry turn referenced that absolute subject path or ran under the absolute subject cwd.

If a tool result says no matches, failed command, or missing path, do not report status "ok" unless you have a separate successful tool result that directly proves the requested check. Return only a single-line minified JSON object.

Rejection reasons:
${details || "none"}

Original task:
${originalTask}`;
}

export function retryModelWithThinkingOff(model: string | undefined): string | undefined {
  if (!model?.trim()) return model;
  const selector = splitModelSelector(model);
  if (selector.thinkingSuffix) return model;
  if (selector.model !== "gpt-5.3-codex") return model;
  return `${model}:off`;
}

export function buildInvalidPathRetryTask(
  originalTask: string,
  invalidPaths: InvalidReportedPath[],
): string {
  const details = invalidPaths
    .map((item) => `${item.field}: ${item.path}`)
    .join("\n");
  return `Your previous sub-agent result was rejected because it cited file paths that do not exist.

Before final output, run actual read-only tools and verify every path you cite exists. Do not invent paths. Remove any unverified file from evidence and filesRead. If the original task asks whether a path exists and a tool proves it is missing, do not put that missing path in filesRead and do not use it as evidence.file; cite the existence-check command and explain the missing path in reason/finding instead. Return status "error" with blocker "invalid_child_file_evidence" only if tool-based verification is impossible. Return only a single-line minified JSON object.

Invalid cited paths:
${details || "none"}

Original task:
${originalTask}`;
}

function makeError(
  params: Pick<SubagentParams, "agent">,
  summary: string,
  diagnostic: string,
  blockers: string[],
  extra: Partial<SubagentResult> = {},
): SubagentResult {
  return {
    status: "error",
    agent: params.agent,
    summary,
    finding: diagnostic,
    evidence: [],
    toolsUsed: [],
    filesRead: [],
    filesChanged: [],
    confidence: "low",
    blockers,
    recommendedNextStep:
      "Inspect the child session and rerun with a narrower task.",
    ...extra,
  };
}

function logMetadata(record: Record<string, unknown>): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `${JSON.stringify(redactForReturn(record))}\n`);
  } catch {
    // Logging must never break the tool.
  }
}

async function runChildPi(
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    env: NodeJS.ProcessEnv;
  },
): Promise<ChildRunResult> {
  const command = process.env.PI_SUBAGENT_PI_BIN || "pi";
  const state: ObservedChildState = {
    finalText: "",
    currentAssistantText: "",
    inAssistantMessage: false,
    toolsUsed: new Set(),
    parseErrors: 0,
    skippedLargeLines: 0,
    toolUseViolations: [],
    toolResultWarnings: [],
  };
  let stdoutBuffer = "";
  let stdoutBufferBytes = 0;
  let skippingStdoutLine = false;
  let stderrBytes = 0;
  let stderr = "";
  let timedOut = false;
  let outputCapExceeded = false;

  return await new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const killChild = () => {
      if (!child.killed) child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000).unref();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killChild();
    }, options.timeoutMs);
    timeout.unref();

    options.signal?.addEventListener(
      "abort",
      () => {
        killChild();
      },
      { once: true },
    );

    child.stdout?.on("data", (chunk: Buffer) => {
      let remaining = chunk.toString("utf8");
      while (remaining) {
        const newlineIndex = remaining.indexOf("\n");
        const piece =
          newlineIndex === -1 ? remaining : remaining.slice(0, newlineIndex);
        const endedLine = newlineIndex !== -1;
        remaining = endedLine ? remaining.slice(newlineIndex + 1) : "";

        if (skippingStdoutLine) {
          if (endedLine) skippingStdoutLine = false;
          continue;
        }

        const pieceBytes = Buffer.byteLength(piece, "utf8");
        if (stdoutBufferBytes + pieceBytes > MAX_JSON_LINE_BYTES) {
          state.skippedLargeLines += 1;
          stdoutBuffer = "";
          stdoutBufferBytes = 0;
          skippingStdoutLine = !endedLine;
          continue;
        }

        stdoutBuffer += piece;
        stdoutBufferBytes += pieceBytes;
        if (endedLine) {
          observeJsonLine(stdoutBuffer, state);
          stdoutBuffer = "";
          stdoutBufferBytes = 0;
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderr.length < MAX_FIELD_CHARS)
        stderr += chunk
          .toString("utf8")
          .slice(0, MAX_FIELD_CHARS - stderr.length);
      if (stderrBytes > MAX_STDERR_BYTES) {
        outputCapExceeded = true;
        killChild();
      }
    });

    child.on("error", () => {
      clearTimeout(timeout);
      resolvePromise({
        state,
        code: 127,
        signal: null,
        timedOut,
        outputCapExceeded,
        stderr,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (stdoutBuffer.trim()) observeJsonLine(stdoutBuffer, state);
      resolvePromise({
        state,
        code,
        signal,
        timedOut,
        outputCapExceeded,
        stderr,
      });
    });
  });
}

export async function runSubagent(
  params: SubagentParams,
  ctx?: ExtensionContext,
  signal?: AbortSignal,
  onUpdate?: (update: unknown) => void,
): Promise<SubagentResult> {
  const startedAt = Date.now();
  const cwd = resolveCwd(params.cwd, ctx?.cwd ?? process.cwd());
  const mode = params.mode ?? "read";
  const timeoutMs = Math.min(
    Math.max(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS,
  );

  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return makeError(
      params,
      "Invalid sub-agent cwd.",
      `cwd does not exist or is not a directory: ${replaceHome(cwd)}`,
      ["invalid_cwd"],
    );
  }

  const workstream = deriveWorkstream(cwd, params.task, params.workstream);
  const sessionDir = buildSessionDir(workstream, params.agent);
  mkdirSync(sessionDir, { recursive: true });

  let rolePrompt: string;
  try {
    rolePrompt = readRolePrompt(params.agent);
  } catch (error) {
    return makeError(
      params,
      "Missing sub-agent role prompt.",
      error instanceof Error
        ? replaceHome(error.message)
        : "Unknown role prompt error",
      ["missing_role_prompt"],
      { workstream, sessionDir: replaceHome(sessionDir) },
    );
  }

  const requestedModel = selectSubagentModel(params.model, rolePrompt);
  const modelResolution = resolveSubagentModel(requestedModel);
  if (modelResolution && !modelResolution.ok) {
    const durationMs = Date.now() - startedAt;
    return makeError(
      params,
      "Invalid sub-agent model.",
      modelResolution.diagnostic,
      modelResolution.blockers,
      {
        workstream,
        sessionDir: replaceHome(sessionDir),
        durationMs,
        evidence: modelResolution.command
          ? [
              {
                command: modelResolution.command,
                reason:
                  "Pi model list did not contain an exact usable match for the requested sub-agent model.",
              },
            ]
          : [],
        recommendedNextStep: modelResolution.suggestions.length
          ? `Use one of: ${modelResolution.suggestions.join(", ")}.`
          : "Run `pi --list-models <search>` and pass a provider-qualified model id.",
      },
    );
  }

  const resolvedParams = {
    ...params,
    cwd,
    mode,
    timeoutMs,
    model: modelResolution?.model ?? requestedModel,
  };
  const bootstrapPrompt = buildBootstrapPrompt(
    { ...resolvedParams, task: params.task, agent: params.agent },
    rolePrompt,
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PWD: cwd,
    INIT_CWD: cwd,
    PI_SUBAGENT_CHILD: "1",
    PI_SUBAGENT_CWD: cwd,
    PI_SUBAGENT_PARENT_WORKSTREAM: workstream,
    PI_SUBAGENT_ALLOW_RECURSIVE: params.allowRecursive ? "1" : "0",
  };

  let child: ChildRunResult | null = null;
  let parsed: unknown | null = null;
  let normalized: SubagentResult | null = null;
  let metadata = {
    workstream,
    sessionDir: replaceHome(sessionDir),
    durationMs: 0,
    model: resolvedParams.model,
  };
  const cumulativeToolsUsed = new Set<string>();
  const cumulativeToolUseTexts = new Set<string>();

  for (let attempt = 0; attempt <= MAX_RESULT_RETRIES; attempt += 1) {
    const retry = attempt > 0;
    let retryTask = params.task;
    let attemptModel = resolvedParams.model;
    let retryMessage = `Running ${params.agent} sub-agent for ${workstream}...`;
    if (retry) {
      const invalidPaths = findInvalidReportedPaths(normalized, cwd);
      const suspiciousOkReasons = child
        ? findSuspiciousOkResult(normalized, child.state, params.task, cwd)
        : [];
      const observedToolCount = cumulativeToolsUsed.size;
      const invalidFinal = Boolean(
        child && (!child.state.finalText.trim() || !parsed || !normalized),
      );
      const retryBecauseNoTools =
        shouldRetryNoToolResult(normalized, observedToolCount) ||
        (invalidFinal && observedToolCount === 0);
      if (retryBecauseNoTools)
        attemptModel = retryModelWithThinkingOff(resolvedParams.model);
      retryTask = retryBecauseNoTools
        ? buildNoToolRetryTask(params.task)
        : invalidFinal
          ? buildInvalidFinalRetryTask(params.task)
          : suspiciousOkReasons.length
            ? buildSuspiciousOkRetryTask(params.task, suspiciousOkReasons)
            : buildInvalidPathRetryTask(params.task, invalidPaths);
      retryMessage = `Retrying ${params.agent} sub-agent for ${workstream} after rejected result...`;
    }

    const attemptParams = retry
      ? { ...resolvedParams, task: retryTask, reset: false, model: attemptModel }
      : resolvedParams;
    const args = buildPiArgs(attemptParams, sessionDir, bootstrapPrompt);
    onUpdate?.({ content: [{ type: "text", text: retryMessage }] });

    child = await runChildPi(args, { cwd, timeoutMs, signal, env });
    for (const toolName of child.state.toolsUsed)
      cumulativeToolsUsed.add(toolName);
    for (const text of child.state.toolUseTexts ?? [])
      cumulativeToolUseTexts.add(text);
    const observedState: ObservedChildState = {
      ...child.state,
      toolsUsed: new Set(cumulativeToolsUsed),
      toolUseTexts: [...cumulativeToolUseTexts],
    };
    metadata = {
      workstream,
      sessionDir: replaceHome(sessionDir),
      durationMs: Date.now() - startedAt,
      model: attemptParams.model,
    };
    parsed = child.state.finalText.trim()
      ? parseJsonObject(child.state.finalText)
      : null;
    normalized = validateAndNormalize(
      parsed,
      attemptParams,
      observedState,
      metadata,
    );

    if (child.timedOut && normalized) return normalized;
    if (child.timedOut)
      return makeError(
        params,
        "Sub-agent timed out.",
        `Child Pi exceeded ${timeoutMs} ms.`,
        ["timeout"],
        metadata,
      );
    if (child.outputCapExceeded)
      return makeError(
        params,
        "Sub-agent exceeded output cap.",
        "Child Pi emitted too much JSON stream output before finishing.",
        ["output_cap_exceeded"],
        metadata,
      );
    if (child.code !== 0) {
      const stderr = compactString(
        redactForReturn(child.stderr),
        "",
        MAX_FIELD_CHARS,
      );
      const diagnostic = `Child Pi exited with code ${child.code ?? "null"}${child.signal ? ` signal ${child.signal}` : ""}.${stderr ? ` stderr: ${stderr}` : ""}`;
      return makeError(
        params,
        "Sub-agent process failed.",
        diagnostic,
        ["child_process_failed"],
        metadata,
      );
    }

    const invalidPaths =
      normalized?.status === "ok"
        ? findInvalidReportedPaths(normalized, cwd)
        : [];
    const suspiciousOkReasons =
      normalized?.status === "ok"
        ? findSuspiciousOkResult(normalized, observedState, params.task, cwd)
        : [];
    const invalidFinalRetry = Boolean(
      child.state.finalText.trim() && (!parsed || !normalized),
    );
    const noToolRetry =
      cumulativeToolsUsed.size === 0 &&
      (!child.state.finalText.trim() ||
        !parsed ||
        !normalized ||
        shouldRetryNoToolResult(normalized, cumulativeToolsUsed.size));
    const invalidPathRetry = invalidPaths.length > 0;
    const suspiciousOkRetry = suspiciousOkReasons.length > 0;
    if (
      !noToolRetry &&
      !invalidFinalRetry &&
      !invalidPathRetry &&
      !suspiciousOkRetry
    )
      break;
    if (attempt === MAX_RESULT_RETRIES) {
      if (noToolRetry) {
        return makeError(
          params,
          "Sub-agent did not execute tools.",
          "Child returned no usable tool-grounded result after retry.",
          ["child_did_not_execute_tools"],
          {
            ...metadata,
            evidence: [
              {
                reason:
                  "The child result had no observed tool calls and no usable verified final result on the initial attempt and retry.",
              },
            ],
            recommendedNextStep:
              "Rerun with a narrower task or handle the read-only inspection in the parent session.",
          },
        );
      }
      if (invalidFinalRetry) {
        return makeError(
          params,
          "Sub-agent returned invalid final JSON.",
          "Child used tools but still did not return parseable schema-compliant JSON after retry.",
          ["invalid_json"],
          {
            ...metadata,
            recommendedNextStep:
              "Rerun with a narrower task or handle the read-only inspection in the parent session.",
          },
        );
      }
      if (suspiciousOkRetry) {
        return makeError(
          params,
          "Sub-agent returned inconsistent ok result.",
          "Child returned status ok with suspicious tool usage or evidence after retry.",
          ["suspicious_child_evidence"],
          {
            ...metadata,
            evidence: suspiciousOkReasons,
            recommendedNextStep:
              "Rerun with stricter absolute-path wording or verify the check in the parent session before trusting the result.",
          },
        );
      }
      return makeError(
        params,
        "Sub-agent cited invalid file paths.",
        "Child returned ok with file evidence that does not exist after retry.",
        ["invalid_child_file_evidence"],
        {
          ...metadata,
          evidence: invalidPaths.map((item) => ({
            file: item.path,
            reason: `${item.field} did not resolve to an existing path.`,
          })),
          recommendedNextStep:
            "Rerun with a narrower task or verify the reported paths in the parent session before trusting the result.",
        },
      );
    }
  }

  if (!child?.state.finalText.trim()) {
    return makeError(
      params,
      "Sub-agent returned no final text.",
      "No assistant final text was found in the JSON event stream.",
      ["missing_final_text"],
      metadata,
    );
  }
  if (!parsed) {
    return makeError(
      params,
      "Child agent did not return parseable JSON.",
      "Final assistant text was not parseable as JSON.",
      ["invalid_json"],
      metadata,
    );
  }
  if (!normalized) {
    return makeError(
      params,
      "Child agent JSON did not match schema.",
      "Final assistant JSON could not be normalized to the sub-agent result schema.",
      ["invalid_schema"],
      metadata,
    );
  }

  return normalized;
}

function registerSubagentTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "subagent_run",
    label: "Sub-agent Run",
    description:
      "Run a scoped Pi child agent in an isolated persistent session and return only compact structured findings.",
    promptSnippet:
      "Delegate scoped investigation, review, testing, documentation research, or consistency checks to a Pi sub-agent.",
    promptGuidelines: [
      "Use subagent_run when a scoped task would otherwise require broad searches, test output, logs, or documentation research that should not enter the parent context.",
      'subagent_run defaults to read-only mode; pass mode: "write" only when file edits are explicitly authorized and parent review will follow.',
      "When setting model, prefer a provider-qualified id from `pi --list-models <search>` such as `openai-codex/gpt-5.3-codex`; the runner validates and normalizes exact short ids before launch.",
      "Do not use GPT-5.3-Codex-Spark for child agents; subagent_run rejects Spark models.",
    ],
    parameters: Type.Object({
      agent: StringEnum(AGENTS),
      task: Type.String({
        description: "Scoped task for the child agent. Do not include secrets.",
      }),
      cwd: Type.Optional(
        Type.String({
          description:
            "Working directory for the child Pi process. Defaults to current cwd.",
        }),
      ),
      workstream: Type.Optional(
        Type.String({
          description: "Stable workstream slug for session reuse.",
        }),
      ),
      mode: Type.Optional(StringEnum(MODES)),
      timeoutMs: Type.Optional(
        Type.Number({ minimum: 1_000, maximum: MAX_TIMEOUT_MS }),
      ),
      model: Type.Optional(
        Type.String({
          description:
            "Optional Pi model id for the child process. Prefer provider-qualified ids from `pi --list-models <search>`, for example `openai-codex/gpt-5.3-codex`. Exact short ids are validated and normalized when unambiguous. GPT-5.3-Codex-Spark is banned for subagent_run.",
        }),
      ),
      reset: Type.Optional(
        Type.Boolean({
          description:
            "Create a new session in the same isolated directory instead of continuing.",
        }),
      ),
      allowRecursive: Type.Optional(
        Type.Boolean({
          description:
            "Allow the child process to use sub-agent tools recursively.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await runSubagent(
        params as SubagentParams,
        ctx,
        signal,
        onUpdate,
      );
      const safeResult = redactForReturn(result) as SubagentResult;
      const loggedCwd = resolveCwd(
        (params as SubagentParams).cwd,
        ctx?.cwd ?? process.cwd(),
      );
      logMetadata({
        timestamp: new Date().toISOString(),
        agent: safeResult.agent,
        workstream: safeResult.workstream,
        cwd: replaceHome(loggedCwd),
        mode: params.mode ?? "read",
        timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        model: safeResult.model ?? params.model ?? null,
        sessionDir: safeResult.sessionDir,
        status: safeResult.status,
        toolsUsed: safeResult.toolsUsed,
        durationMs: safeResult.durationMs,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(safeResult, null, 2) }],
        details: safeResult,
      };
    },
  });
}

export default function (pi: ExtensionAPI): void {
  if (
    process.env.PI_SUBAGENT_CHILD === "1" &&
    process.env.PI_SUBAGENT_ALLOW_RECURSIVE !== "1"
  ) {
    return;
  }
  registerSubagentTool(pi);
}
