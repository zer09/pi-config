#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_UPSTREAM = "/home/gc/development/agentmemory";

export function resolveUpstreamRoot(args = process.argv.slice(2)) {
  const index = args.indexOf("--upstream");
  if (index !== -1 && args[index + 1]) return resolve(args[index + 1]);
  return resolve(process.env.AGENTMEMORY_UPSTREAM || DEFAULT_UPSTREAM);
}

export function extractUpstreamTools(upstreamRoot = resolveUpstreamRoot()) {
  const registryPath = join(upstreamRoot, "src/mcp/tools-registry.ts");
  const serverPath = join(upstreamRoot, "src/mcp/server.ts");
  const standalonePath = join(upstreamRoot, "src/mcp/standalone.ts");
  const cliPath = join(upstreamRoot, "src/cli.ts");
  const readmePath = join(upstreamRoot, "README.md");

  const registryText = readRequired(registryPath);
  const groups = parseRegistry(registryText);
  const tools = groups.flatMap((group) => group.tools.map((tool) => ({ ...tool, group: group.name })));
  const serverCases = extractCases(readOptional(serverPath)).filter((name) => name.startsWith("memory_"));
  const standaloneCases = extractCases(readOptional(standalonePath)).filter((name) => name.startsWith("memory_"));

  return {
    upstreamRoot,
    registryPath,
    registryCount: tools.length,
    serverCaseCount: serverCases.length,
    standaloneCaseCount: standaloneCases.length,
    serverMissingCases: tools.map((tool) => tool.name).filter((name) => !serverCases.includes(name)),
    serverExtraCases: serverCases.filter((name) => !tools.some((tool) => tool.name === name)),
    groups,
    tools,
    docsCountMentions: extractCountMentions({
      "README.md": readOptional(readmePath),
      "src/cli.ts": readOptional(cliPath),
    }),
  };
}

function readRequired(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing required file: ${filePath}`);
  return readFileSync(filePath, "utf8");
}

function readOptional(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function parseRegistry(text) {
  const groups = [];
  const groupRegex = /export\s+const\s+([A-Z0-9_]+)_TOOLS\s*:[\s\S]*?=\s*\[/g;
  let match;
  while ((match = groupRegex.exec(text))) {
    const groupName = match[1];
    const arrayStart = groupRegex.lastIndex - 1;
    const arrayEnd = findMatching(text, arrayStart, "[", "]");
    if (arrayEnd === -1) throw new Error(`Unable to parse ${groupName}_TOOLS array`);
    const body = text.slice(arrayStart + 1, arrayEnd);
    const tools = extractTopLevelObjectBlocks(body).map(parseToolBlock).filter(Boolean);
    groups.push({ name: groupName, count: tools.length, tools });
    groupRegex.lastIndex = arrayEnd + 1;
  }
  return groups;
}

function parseToolBlock(block) {
  const name = parseStringLiterals(readValueExpression(block, "name"))[0];
  if (!name) return null;
  const description = parseStringLiterals(readValueExpression(block, "description")).join("");
  const schemaExpression = readValueExpression(block, "inputSchema");
  const propertiesExpression = readValueExpression(schemaExpression, "properties");
  const propertyEntries = extractObjectEntries(propertiesExpression);
  const properties = Object.fromEntries(propertyEntries.map(({ key, value }) => [
    key,
    {
      type: parseStringLiterals(readValueExpression(value, "type"))[0] || "unknown",
      description: parseStringLiterals(readValueExpression(value, "description")).join(""),
    },
  ]));
  const required = parseStringLiterals(readValueExpression(schemaExpression, "required"));
  return {
    name,
    description,
    required,
    properties,
    propertyNames: Object.keys(properties).sort(),
  };
}

function extractCases(text) {
  return unique([...text.matchAll(/case\s+["']([^"']+)["']\s*:/g)].map((match) => match[1])).sort();
}

function extractCountMentions(files) {
  const mentions = [];
  for (const [file, text] of Object.entries(files)) {
    for (const match of text.matchAll(/\b(\d{1,3})\s+(?:MCP\s+)?tools?\b/gi)) {
      mentions.push({ file, count: Number(match[1]), text: match[0] });
    }
  }
  return mentions;
}

function extractTopLevelObjectBlocks(text) {
  const blocks = [];
  for (let i = 0; i < text.length; i += 1) {
    i = skipIgnorable(text, i);
    if (text[i] !== "{") continue;
    const end = findMatching(text, i, "{", "}");
    if (end === -1) throw new Error("Unmatched object in registry array");
    blocks.push(text.slice(i, end + 1));
    i = end;
  }
  return blocks;
}

function extractObjectEntries(objectExpression) {
  const text = stripOuter(objectExpression.trim(), "{", "}");
  const entries = [];
  let i = 0;
  while (i < text.length) {
    i = skipIgnorable(text, i);
    if (text[i] === ",") {
      i += 1;
      continue;
    }
    const keyResult = readObjectKey(text, i);
    if (!keyResult) break;
    i = skipIgnorable(text, keyResult.end);
    if (text[i] !== ":") {
      i += 1;
      continue;
    }
    i = skipIgnorable(text, i + 1);
    const valueStart = i;
    const valueEnd = findExpressionEnd(text, valueStart);
    entries.push({ key: keyResult.key, value: text.slice(valueStart, valueEnd).trim() });
    i = valueEnd + 1;
  }
  return entries;
}

function readObjectKey(text, start) {
  const quote = text[start];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = findStringEnd(text, start);
    return { key: decodeStringLiteral(text.slice(start, end + 1)), end: end + 1 };
  }
  const match = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(text.slice(start));
  if (!match) return null;
  return { key: match[0], end: start + match[0].length };
}

function readValueExpression(text, key) {
  if (!text) return "";
  const match = new RegExp(`\\b${escapeRegExp(key)}\\s*:`).exec(text);
  if (!match) return "";
  const start = match.index + match[0].length;
  const valueStart = skipIgnorable(text, start);
  const valueEnd = findExpressionEnd(text, valueStart);
  return text.slice(valueStart, valueEnd).trim();
}

function findExpressionEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' || char === "'" || char === "`") {
      i = findStringEnd(text, i);
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i + 2);
      if (i === -1) return text.length;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") {
      if (depth === 0) return i;
      depth -= 1;
    }
    if (char === "," && depth === 0) return i;
  }
  return text.length;
}

function findMatching(text, start, open, close) {
  if (text[start] !== open) return -1;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' || char === "'" || char === "`") {
      i = findStringEnd(text, i);
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i + 2);
      if (i === -1) return -1;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findStringEnd(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return text.length - 1;
}

function parseStringLiterals(expression) {
  const values = [];
  for (let i = 0; i < expression.length; i += 1) {
    const quote = expression[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    const end = findStringEnd(expression, i);
    values.push(decodeStringLiteral(expression.slice(i, end + 1)));
    i = end;
  }
  return values;
}

function decodeStringLiteral(literal) {
  const quote = literal[0];
  if (quote === '"') {
    try {
      return JSON.parse(literal);
    } catch {
      return literal.slice(1, -1);
    }
  }
  return literal.slice(1, -1).replace(/\\([\\'"`nrt])/g, (_match, escaped) => {
    switch (escaped) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      default: return escaped;
    }
  });
}

function skipIgnorable(text, start) {
  let i = start;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i += 1;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    return i;
  }
  return i;
}

function stripOuter(text, open, close) {
  const trimmed = text.trim();
  return trimmed.startsWith(open) && trimmed.endsWith(close) ? trimmed.slice(1, -1) : trimmed;
}

function unique(values) {
  return Array.from(new Set(values));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const upstreamRoot = resolveUpstreamRoot();
  const summary = extractUpstreamTools(upstreamRoot);
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
