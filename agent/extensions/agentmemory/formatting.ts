import {
  containsSecretLikeContent,
  isSecurityEnabled,
  redactSecretLikeText,
  redactSecretLikeValue,
  sanitizeTextForDisplay,
} from "./security.ts";
import type {
  AssistantMessage,
  McpPromptGetResponse,
  McpPromptsResponse,
  McpResourceReadResponse,
  McpResourcesResponse,
  McpToolResponse,
  SmartSearchResult,
  TextBlock,
  ToolParams,
} from "./types.ts";

export function getText(content: unknown): string {
  if (typeof content === "string") return content;
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [] as string[];
      const block = part as TextBlock;
      if ((block.type === undefined || block.type === "text") && typeof block.text === "string") return [block.text];
      return [] as string[];
    })
    .join("\n")
    .trim();
}

export function getLastAssistantText(messages: unknown[]): string {
  for (const msg of [...messages].reverse()) {
    if (!msg || typeof msg !== "object") continue;
    const assistant = msg as AssistantMessage;
    if (assistant.role !== "assistant") continue;
    const text = getText(assistant.content);
    if (text) return text;
  }
  return "";
}

export function securityEnabled(): boolean {
  return isSecurityEnabled(process.env);
}

export function containsBlockedSecret(value: unknown): boolean {
  return securityEnabled() && containsSecretLikeContent(value);
}

export function protectText(text: string): string {
  return securityEnabled() ? redactSecretLikeText(text) : text;
}

export function protectDisplayText(text: string): string {
  return securityEnabled() ? sanitizeTextForDisplay(text) : text;
}

export function protectValue(value: unknown): unknown {
  return securityEnabled() ? redactSecretLikeValue(value) : value;
}

export function sanitizeForLookup(value: unknown): unknown {
  return protectValue(value);
}

export function cleanArgs(params: ToolParams): ToolParams {
  const args: ToolParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    args[key] = sanitizeForLookup(value);
  }
  return args;
}

export function formatSearchResults(results: SmartSearchResult[]): string {
  if (!results.length) return "No relevant memories found.";
  return results
    .slice(0, 5)
    .map((result, index) => {
      const obs = result.observation ?? result;
      const title = protectDisplayText(obs.title?.trim() || `Memory ${index + 1}`);
      const narrative = protectDisplayText(obs.narrative?.trim() || "");
      const type = protectDisplayText(obs.type?.trim() || "memory");
      const score = result.combinedScore ?? result.score;
      const scoreText = typeof score === "number" ? ` [score=${score.toFixed(3)}]` : "";
      return `- ${title} (${type})${scoreText}${narrative ? `: ${narrative}` : ""}`;
    })
    .join("\n");
}

export function formatMcpResult(result: McpToolResponse): string {
  const text = getText(result.content);
  if (text) return protectDisplayText(text);
  if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
  return formatJsonResult(result);
}

export function formatJsonResult(value: unknown): string {
  return protectDisplayText(JSON.stringify(protectValue(value), null, 2));
}

export function formatMcpResources(result: McpResourcesResponse): string {
  const resources = Array.isArray(result.resources) ? result.resources : [];
  if (!resources.length) {
    if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
    return formatJsonResult(result);
  }
  return resources
    .map((resource) => {
      const name = protectDisplayText(resource.name?.trim() || "Unnamed resource");
      const uri = protectDisplayText(resource.uri?.trim() || "UNKNOWN");
      const description = protectDisplayText(resource.description?.trim() || "No description");
      const mimeType = protectDisplayText(resource.mimeType?.trim() || "unknown MIME type");
      return `- ${name} (${uri}, ${mimeType}): ${description}`;
    })
    .join("\n");
}

export function formatMcpResourceRead(result: McpResourceReadResponse): string {
  const contents = Array.isArray(result.contents) ? result.contents : [];
  const text = contents
    .map((content) => typeof content?.text === "string" ? content.text : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (text) return protectDisplayText(text);
  if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
  return formatJsonResult(result);
}

export function formatMcpPrompts(result: McpPromptsResponse): string {
  const prompts = Array.isArray(result.prompts) ? result.prompts : [];
  if (!prompts.length) {
    if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
    return formatJsonResult(result);
  }
  return prompts
    .map((prompt) => {
      const name = protectDisplayText(prompt.name?.trim() || "Unnamed prompt");
      const description = protectDisplayText(prompt.description?.trim() || "No description");
      const args = Array.isArray(prompt.arguments) && prompt.arguments.length
        ? prompt.arguments.map((arg) => `${protectDisplayText(arg.name?.trim() || "argument")}${arg.required ? " required" : " optional"}`).join(", ")
        : "no arguments";
      return `- ${name}: ${description} (args: ${args})`;
    })
    .join("\n");
}

export function formatMcpPromptGet(result: McpPromptGetResponse): string {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const text = messages
    .map((message) => getText(message.content))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (text) return protectDisplayText(text);
  if (typeof result.error === "string" && result.error.trim()) return protectDisplayText(result.error.trim());
  return formatJsonResult(result);
}
