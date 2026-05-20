import * as fs from "node:fs";
import * as path from "node:path";

import { getAgentRoot } from "./paths.ts";
import { THINKING_LEVELS, type AgentConfig, type DiscoveredAgents, type FrontmatterParseResult, type ThinkingLevel } from "./types.ts";

function stripOptionalQuotes(value: string): string {
	const trimmed = value.trim();
	const len = trimmed.length;
	if (len >= 2) {
		const first = trimmed[0];
		const last = trimmed[len - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) return trimmed.slice(1, -1);
	}
	return trimmed;
}

export function parseFrontmatter(content: string): FrontmatterParseResult {
	if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return { frontmatter: {}, body: content };
	const newline = content.startsWith("---\r\n") ? "\r\n" : "\n";
	const closing = content.indexOf(`${newline}---`, 4);
	if (closing === -1) return { frontmatter: {}, body: content };

	const raw = content.slice(4, closing);
	const bodyStart = closing + newline.length + 3;
	const body = content.slice(content.startsWith(newline, bodyStart) ? bodyStart + newline.length : bodyStart);
	const frontmatter: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const index = trimmed.indexOf(":");
		if (index <= 0) continue;
		frontmatter[trimmed.slice(0, index).trim()] = stripOptionalQuotes(trimmed.slice(index + 1));
	}
	return { frontmatter, body };
}

function parseThinking(value: string | undefined, filePath: string): ThinkingLevel | undefined {
	if (!value || value === "default") return undefined;
	if (!(THINKING_LEVELS as readonly string[]).includes(value)) {
		throw new Error(`${filePath}: invalid thinking '${value}'`);
	}
	return value as ThinkingLevel;
}

function parseSystemPromptMode(value: string | undefined, filePath: string): "append" | "replace" {
	if (!value || value === "append") return "append";
	if (value === "replace") return "replace";
	throw new Error(`${filePath}: invalid systemPromptMode '${value}'`);
}

export function parseAgentFile(filePath: string, content: string): AgentConfig {
	const parsed = parseFrontmatter(content);
	const name = parsed.frontmatter.name || path.basename(filePath, path.extname(filePath));
	if (!name.trim()) throw new Error(`${filePath}: missing agent name`);
	return {
		name,
		description: parsed.frontmatter.description,
		model: parsed.frontmatter.model && parsed.frontmatter.model !== "default" ? parsed.frontmatter.model : undefined,
		thinking: parseThinking(parsed.frontmatter.thinking, filePath),
		systemPromptMode: parseSystemPromptMode(parsed.frontmatter.systemPromptMode, filePath),
		systemPrompt: parsed.body.trim(),
		filePath,
	};
}

export async function discoverAgents(agentRoot = getAgentRoot()): Promise<DiscoveredAgents> {
	const agentsDir = path.join(agentRoot, "agents");
	const agents: AgentConfig[] = [];
	let entries: string[] = [];
	try {
		entries = await fs.promises.readdir(agentsDir);
	} catch (error: any) {
		if (error?.code !== "ENOENT") throw error;
	}
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".md")) continue;
		const filePath = path.join(agentsDir, entry);
		const stat = await fs.promises.stat(filePath);
		if (!stat.isFile()) continue;
		agents.push(parseAgentFile(filePath, await fs.promises.readFile(filePath, "utf8")));
	}
	const byName = new Map<string, AgentConfig>();
	for (const agent of agents) {
		if (byName.has(agent.name)) throw new Error(`Duplicate delegate agent name '${agent.name}'`);
		byName.set(agent.name, agent);
	}
	return { agents, agentsDir };
}
