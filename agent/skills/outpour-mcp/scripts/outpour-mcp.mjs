#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_ENDPOINT = "https://mcp.outpour.app/mcp";
export const PROTOCOL_VERSION = "2025-03-26";
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_CATALOG_PAGES = 100;
export const USAGE = `Usage:
  outpour-mcp.mjs list [--json]
  outpour-mcp.mjs describe <tool-name>
  outpour-mcp.mjs call <tool-name> [<json>|@<file>|-] [--allow-write]

Environment:
  OUTPOUR_API_KEY   Required manual bearer key
  OUTPOUR_MCP_URL   Optional; must equal https://mcp.outpour.app/mcp when set`;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Malformed JSON in MCP response.");
  }
}

function validateEnvelope(payload, expectedId, { eventStream = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.jsonrpc !== "2.0") {
    throw new Error("Invalid JSON-RPC 2.0 envelope.");
  }
  const hasResult = Object.hasOwn(payload, "result");
  const hasError = Object.hasOwn(payload, "error");
  if (Object.hasOwn(payload, "method")) {
    if (eventStream && typeof payload.method === "string" && payload.method &&
        !Object.hasOwn(payload, "id") && !hasResult && !hasError &&
        (payload.params === undefined || (payload.params !== null && typeof payload.params === "object"))) {
      return undefined;
    }
    throw new Error("Unexpected or malformed JSON-RPC notification.");
  }
  if (!Object.hasOwn(payload, "id") ||
      (typeof payload.id !== "number" && typeof payload.id !== "string") || hasResult === hasError) {
    throw new Error("Invalid JSON-RPC response: expected an ID and exactly one result or error.");
  }
  if (hasError && (!payload.error || typeof payload.error !== "object" || Array.isArray(payload.error) ||
      !Number.isInteger(payload.error.code) || typeof payload.error.message !== "string")) {
    throw new Error("Invalid JSON-RPC error object.");
  }
  if (payload.id !== expectedId) {
    if (eventStream) return undefined;
    throw new Error("MCP response ID does not match the request.");
  }
  return payload;
}

function parseSseEvent(event, expectedId) {
  const data = event.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return undefined;
  return validateEnvelope(parseJson(data), expectedId, { eventStream: true });
}

export function parseResponseBody(text, contentType, expectedId) {
  if (contentType.toLowerCase().includes("text/event-stream")) {
    const events = text.split(/\r?\n\r?\n/);
    events.pop(); // A partial event is not a response, even when the server closes the stream.
    for (const event of events) {
      const payload = parseSseEvent(event, expectedId);
      if (payload !== undefined) return payload;
    }
    throw new Error("MCP event stream ended without a matching response.");
  }
  if (!text.trim()) throw new Error("The MCP server returned an empty response.");
  return validateEnvelope(parseJson(text), expectedId);
}

function validateEndpoint(endpoint) {
  if (endpoint === undefined || endpoint === "") return DEFAULT_ENDPOINT;
  if (endpoint !== DEFAULT_ENDPOINT) {
    throw new Error(`OUTPOUR_MCP_URL must be exactly ${DEFAULT_ENDPOINT}; alternate endpoints are not allowed.`);
  }
  return endpoint;
}

export function createClient({ apiKey, endpoint, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > REQUEST_TIMEOUT_MS) {
    throw new Error(`MCP request timeout must be between 1 and ${REQUEST_TIMEOUT_MS} ms.`);
  }
  return {
    apiKey,
    endpoint: validateEndpoint(endpoint),
    fetchImpl,
    timeoutMs,
    requestId: 0,
    sessionId: undefined,
    initialized: false,
  };
}

export async function send(method, params, { notification = false, client } = {}) {
  if (!client) throw new Error("MCP client is not configured.");
  const endpoint = validateEndpoint(client.endpoint);

  const message = { jsonrpc: "2.0", method };
  if (!notification) message.id = ++client.requestId;
  if (params !== undefined) message.params = params;

  const headers = {
    Authorization: `Bearer ${client.apiKey}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (client.sessionId) headers["Mcp-Session-Id"] = client.sessionId;
  if (client.initialized) headers["MCP-Protocol-Version"] = PROTOCOL_VERSION;

  const controller = new AbortController();
  const timeoutMs = client.timeoutMs || REQUEST_TIMEOUT_MS;
  let timer;
  let reader;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`MCP request deadline exceeded after ${timeoutMs} ms.`));
      controller.abort();
    }, timeoutMs);
  });
  const withinDeadline = (operation) => Promise.race([operation, deadline]);

  try {
    let response;
    try {
      response = await withinDeadline(client.fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers,
        body: JSON.stringify(message),
      }));
    } catch (error) {
      if (controller.signal.aborted) throw error;
      // Fetch errors can contain request headers. Do not echo them.
      throw new Error("MCP fetch failed; redirects are not allowed.");
    }

    client.sessionId ||= response.headers.get("mcp-session-id") || undefined;
    const contentType = response.headers.get("content-type") || "";
    const eventStream = response.ok && !notification && contentType.toLowerCase().includes("text/event-stream");
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    let payload;
    reader = response.body?.getReader();
    while (reader) {
      let chunk;
      try {
        chunk = await withinDeadline(reader.read());
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error(`Could not read MCP response (${response.status}).`);
      }
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new Error(`MCP response (${response.status}) exceeds the ${MAX_RESPONSE_BYTES}-byte limit.`);
      }
      text += decoder.decode(chunk.value, { stream: true });
      if (eventStream) {
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(text))) {
          const event = text.slice(0, boundary.index);
          text = text.slice(boundary.index + boundary[0].length);
          try {
            payload = parseSseEvent(event, message.id);
          } catch (error) {
            throw new Error(`Could not parse MCP response (${response.status}): ${error.message}`);
          }
          if (payload !== undefined) break;
        }
        // Do not wait for EOF: MCP servers may leave the stream open for notifications.
        if (payload !== undefined) break;
      }
    }
    text += decoder.decode();

    if (!response.ok) {
      let detail = text || response.statusText;
      try {
        const error = JSON.parse(text)?.error;
        if (typeof error?.message === "string") detail = error.message;
      } catch {
        // Non-JSON HTTP error bodies can still explain the failure.
      }
      throw new Error(`MCP request failed (${response.status}): ${detail}`);
    }
    if (notification) {
      if (text.trim()) throw new Error(`Unexpected MCP response to a notification (${response.status}).`);
      return undefined;
    }
    if (payload === undefined) {
      try {
        payload = parseResponseBody(text, contentType, message.id);
      } catch (error) {
        throw new Error(`Could not parse MCP response (${response.status}): ${error.message}`);
      }
    }
    if (Object.hasOwn(payload, "error")) {
      throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`);
    }
    return payload.result;
  } catch (error) {
    controller.abort();
    throw new Error(sanitizeOutput(errorMessage(error), client.apiKey));
  } finally {
    clearTimeout(timer);
    // A stream may stay open or have a read pending after the deadline.
    // Start cancellation without waiting for the server to acknowledge it.
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export async function initialize(client) {
  const result = await send(
    "initialize",
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "pi-outpour-skill", version: "1.0.0" },
    },
    { client },
  );
  if (result?.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported or missing MCP protocolVersion; expected ${PROTOCOL_VERSION}.`);
  }
  client.initialized = true;
  await send("notifications/initialized", undefined, { notification: true, client });
}

export async function getTools(client) {
  const tools = [];
  const names = new Set();
  const cursors = new Set();
  let cursor;
  // Follow only the tool catalog, never pagination inside ministry records or tool arguments.
  for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
    const params = cursor === undefined ? {} : { cursor };
    const result = await send("tools/list", params, { client });
    if (!result || typeof result !== "object" || Array.isArray(result) || !Array.isArray(result.tools)) {
      throw new Error("Malformed MCP tool catalog: expected a tools array.");
    }
    for (const tool of result.tools) {
      if (!tool || typeof tool !== "object" || Array.isArray(tool) ||
          typeof tool.name !== "string" || !tool.name || /[\s\u0000-\u001f\u007f]/u.test(tool.name)) {
        throw new Error("Malformed MCP tool catalog: invalid tool name.");
      }
      if (tool.annotations !== undefined && (!tool.annotations || typeof tool.annotations !== "object" ||
          Array.isArray(tool.annotations))) {
        throw new Error("Malformed MCP tool catalog: invalid tool annotations.");
      }
      if (names.has(tool.name)) throw new Error("Malformed MCP tool catalog: duplicate tool name.");
      names.add(tool.name);
      tools.push(tool);
    }
    if (!Object.hasOwn(result, "nextCursor")) return tools;
    if (typeof result.nextCursor !== "string" || !result.nextCursor) {
      throw new Error("Malformed MCP tool catalog: nextCursor must be a nonempty string.");
    }
    if (cursors.has(result.nextCursor)) throw new Error("MCP tool catalog repeated a pagination cursor.");
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error(`MCP tool catalog exceeds the ${MAX_CATALOG_PAGES}-page limit.`);
}

export function parseArguments(spec, { stdin } = {}) {
  if (spec === undefined) return {};

  let source = spec;
  if (spec === "-") source = stdin === undefined ? fs.readFileSync(0, "utf8") : stdin;
  else if (spec.startsWith("@")) source = fs.readFileSync(spec.slice(1), "utf8");

  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid tool arguments JSON: ${error.message}`);
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return value;
}

export function parseCommand(args, { stdin } = {}) {
  const argv = [...args];
  const command = argv.shift();

  if (!command) return { command: "help", exitCode: 2 };
  if (command === "help" || command === "--help" || command === "-h") {
    if (argv.length) throw new Error("help does not accept arguments.");
    return { command: "help", exitCode: 0 };
  }

  if (command === "list") {
    if (!argv.length) return { command: "list", json: false };
    if (argv.length === 1 && argv[0] === "--json") {
      return { command: "list", json: true };
    }
    throw new Error("list accepts only the optional --json flag.");
  }

  if (command === "describe") {
    if (!argv[0]) throw new Error("describe requires a tool name.");
    if (argv.length !== 1 || argv[0].startsWith("-")) {
      throw new Error("describe expects exactly one tool name.");
    }
    return { command: "describe", name: argv[0] };
  }

  if (command === "call") {
    if (!argv[0] || argv[0].startsWith("-")) {
      throw new Error("call requires a tool name.");
    }

    const name = argv.shift();
    let argsSpec;
    let allowWrite = false;
    for (const [index, token] of argv.entries()) {
      if (token === "--allow-write") {
        if (allowWrite || argv.slice(index + 1).includes("--allow-write")) {
          throw new Error("call does not allow duplicate --allow-write flags.");
        }
        if (index !== argv.length - 1) {
          throw new Error("--allow-write must be the final call option.");
        }
        allowWrite = true;
        continue;
      }
      if (token !== "-" && token.startsWith("-")) {
        throw new Error(`Unknown call flag: ${token}`);
      }
      if (argsSpec !== undefined) {
        throw new Error("call accepts at most one argument source.");
      }
      argsSpec = token;
    }

    return {
      command: "call",
      name,
      arguments: parseArguments(argsSpec, { stdin }),
      allowWrite,
    };
  }

  throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
}

function stringifyValue(value) {
  const json = JSON.stringify(value, null, 2);
  return json === undefined ? String(value) : json;
}

function resultErrorText(result) {
  const details = [];
  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (item?.type === "text" && item.text) details.push(String(item.text));
    }
  }
  if (result?.structuredContent !== undefined) {
    details.push(stringifyValue(result.structuredContent));
  }
  return details.length ? details.join("\n") : "The tool returned an error.";
}

export function formatToolResult(result) {
  if (result?.isError === true) {
    throw new Error(`Tool call failed: ${resultErrorText(result)}`);
  }

  if (result?.structuredContent !== undefined) {
    return stringifyValue(result.structuredContent);
  }

  const content = result?.content;
  if (Array.isArray(content) && content.length === 1 && content[0]?.type === "text") {
    const text = content[0].text || "";
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  return stringifyValue(result);
}

export function printToolResult(result, write = console.log) {
  write(formatToolResult(result));
}

export function sanitizeOutput(value, secret) {
  const text = String(value);
  if (!secret) return text;

  // Plain text can contain raw credentials or repeatedly escaped credentials.
  const spellings = new Set([secret]);
  let spelling = secret;
  while (spelling.length <= text.length) {
    const escaped = JSON.stringify(spelling).slice(1, -1);
    if (escaped === spelling || escaped.length > text.length || spellings.has(escaped)) break;
    spellings.add(escaped);
    spelling = escaped;
  }

  const candidates = [...spellings].sort((left, right) => right.length - left.length);
  const redactPlain = (source) => candidates.reduce(
    (output, candidate) => output.split(candidate).join("[REDACTED]"), source,
  );

  function redactJson(source) {
    if (!/^\s*["{[]/.test(source)) return undefined;
    try {
      JSON.parse(source);
    } catch {
      return undefined;
    }

    // Decode only validated JSON strings, then restore each serialization layer.
    return source.replace(/"(?:\\[\s\S]|[^"\\])*"/g, (token) => {
      const decoded = JSON.parse(token);
      const redacted = redact(decoded);
      return redacted === decoded ? token : JSON.stringify(redacted);
    });
  }

  function redact(source) {
    if (source === secret) return "[REDACTED]";
    const json = redactJson(source);
    if (json !== undefined) return json;

    // Keep credentials whole at both edges of each JSON section, including escaped spellings.
    const splitsCredential = (boundary) => candidates.some((candidate) => {
      const index = source.lastIndexOf(candidate, boundary - 1);
      return index >= 0 && index < boundary && index + candidate.length > boundary;
    });

    // Find a section's end without treating quoted or escaped brackets as boundaries.
    const findSectionEnd = (sectionStart) => {
      const closing = [];
      let quoted = false;
      let escaped = false;
      for (let index = sectionStart; index < source.length; index++) {
        const character = source[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
        } else if (character === '"') {
          quoted = true;
        } else if (character === "{" || character === "[") {
          closing.push(character === "{" ? "}" : "]");
        } else if (character === "}" || character === "]") {
          if (closing.pop() !== character) break;
        }
        if (!quoted && !closing.length) return index + 1;
      }
      return undefined;
    };

    // A malformed prose quote can end on a character that also starts a complete JSON section.
    // Resolve that overlap before accepting the prose quote, or the real section is skipped.
    const hasOverlappingJson = (sectionStart, sectionEnd) => {
      if (source[sectionStart] !== '"') return false;
      for (let nestedStart = sectionStart + 1; nestedStart < sectionEnd; nestedStart++) {
        if (source[nestedStart] !== "{" && source[nestedStart] !== "[" && source[nestedStart] !== '"') {
          continue;
        }
        const nestedEnd = findSectionEnd(nestedStart);
        if (nestedEnd === undefined || splitsCredential(nestedStart) || splitsCredential(nestedEnd)) {
          continue;
        }
        try {
          JSON.parse(source.slice(nestedStart, nestedEnd));
          return true;
        } catch {
          // This delimiter was not a complete JSON candidate.
        }
      }
      return false;
    };

    let output = "";
    let plainStart = 0;
    for (let start = 0; start < source.length; start++) {
      if (source[start] !== "{" && source[start] !== "[" && source[start] !== '"') continue;
      if (splitsCredential(start)) continue;

      const end = findSectionEnd(start);
      if (end === undefined || splitsCredential(end)) continue;
      const section = source.slice(start, end);
      // Validate before decoding, and replace whole credentials before looking inside their JSON.
      const container = section === secret ? "[REDACTED]" : redactJson(section);
      if (container === undefined) continue;
      if (container === section && hasOverlappingJson(start, end)) continue;
      output += redactPlain(source.slice(plainStart, start)) + container;
      plainStart = end;
      start = end - 1;
    }

    return output + redactPlain(source.slice(plainStart));
  }

  return redact(text);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdin,
  stdout = (value) => console.log(value),
  stderr = (value) => console.error(value),
} = {}) {
  const secret = env.OUTPOUR_API_KEY;
  const writeStdout = (value) => stdout(sanitizeOutput(value, secret));
  const writeStderr = (value) => stderr(sanitizeOutput(value, secret));

  let parsed;
  try {
    parsed = parseCommand(argv, { stdin });
  } catch (error) {
    writeStderr(errorMessage(error));
    return 1;
  }

  if (parsed.command === "help") {
    writeStdout(USAGE);
    return parsed.exitCode;
  }

  const apiKey = env.OUTPOUR_API_KEY;
  if (!apiKey) {
    writeStderr("OUTPOUR_API_KEY is not set.");
    return 2;
  }

  try {
    const client = createClient({
      apiKey,
      endpoint: env.OUTPOUR_MCP_URL,
      fetchImpl,
    });
    await initialize(client);

    if (parsed.command === "list") {
      const tools = await getTools(client);
      if (parsed.json) {
        writeStdout(JSON.stringify(tools, null, 2));
      } else {
        for (const tool of tools) {
          const access = tool.annotations?.readOnlyHint === true ? "read" : "write";
          writeStdout(`${tool.name}\t${access}\t${tool.description || ""}`);
        }
      }
    } else if (parsed.command === "describe") {
      const tools = await getTools(client);
      const tool = tools.find((candidate) => candidate.name === parsed.name);
      if (!tool) throw new Error(`Unknown Outpour tool: ${parsed.name}`);
      writeStdout(JSON.stringify(tool, null, 2));
    } else if (parsed.command === "call") {
      const tools = await getTools(client);
      const tool = tools.find((candidate) => candidate.name === parsed.name);
      if (!tool) throw new Error(`Unknown Outpour tool: ${parsed.name}`);
      if (tool.annotations?.readOnlyHint !== true && !parsed.allowWrite) {
        throw new Error(
          `${parsed.name} is a write tool. Use --allow-write only after the user explicitly requests this exact mutation.`,
        );
      }

      const result = await send(
        "tools/call",
        {
          name: parsed.name,
          arguments: parsed.arguments,
        },
        { client },
      );
      printToolResult(result, writeStdout);
    }
  } catch (error) {
    writeStderr(errorMessage(error));
    return 1;
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
