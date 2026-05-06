import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LOG_DIR = join(homedir(), ".pi", "logs");
const LOG = join(LOG_DIR, "agents-enforcer.log");

const REMINDER = `Before doing any task, follow ~/.pi/agent/AGENTS.md Session Startup rules. First read ~/.pi/agent/skills/context-watcher/SKILL.md, then read rules/, then use Context Watcher command routing.`;

const SYSTEM_REMINDER = `\n\n# Mandatory startup reminder\n\n${REMINDER}\n`;

// Patterns that are FORBIDDEN in direct bash per context-watcher SKILL.md.
// These are blocked at the hook level so the model cannot bypass them.
const BLOCKED_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bcurl\s/,
    reason:
      "curl is FORBIDDEN in direct bash. Use ctx_fetch_and_index or ctx_execute with fetch() instead.",
  },
  {
    pattern: /\bwget\s/,
    reason:
      "wget is FORBIDDEN in direct bash. Use ctx_fetch_and_index or ctx_execute with fetch() instead.",
  },
  {
    pattern: /\bnode\s+-e\s+.*\bfetch\s*\(/,
    reason:
      "Inline HTTP via node -e is FORBIDDEN. Use ctx_execute(language: 'javascript', code: '...') instead.",
  },
  {
    pattern: /\bpython[3]?\s+-c\s+.*\brequests\.get\s*\(/,
    reason:
      "Inline HTTP via python -c is FORBIDDEN. Use ctx_execute(language: 'python', code: '...') instead.",
  },
  {
    pattern: /\bpython[3]?\s+-c\s+.*\burllib\.request/,
    reason:
      "Inline HTTP via python -c is FORBIDDEN. Use ctx_execute(language: 'python', code: '...') instead.",
  },
];

// Secret key names that should never be echoed.
const SECRET_KEY_PATTERNS =
  /\b(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|BEARER|PRIVATE_KEY)\b/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function log(message: string): void {
  try {
    appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // ignore logging failures
  }
}

function getProviderModel(ctx: any): { provider: string; model: string } {
  return {
    provider: ctx.model?.provider ?? "unknown",
    model: ctx.model?.id ?? "unknown",
  };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (_pi: ExtensionAPI) {
  // Temporarily disabled.
  return;

  ensureLogDir();

  // Track the last provider/model that received the visible reminder.
  // This resets on session changes and also re-injects after /model switches.
  let lastRemindedModelKey: string | undefined;

  log("loaded");

  // -------------------------------------------------------------------------
  // Session lifecycle: reset reminder flag on new/forked/navigated sessions
  // -------------------------------------------------------------------------

  pi.on("session_start", async (_event, _ctx) => {
    lastRemindedModelKey = undefined;
    log("session_start: reminder model key reset");
  });

  // -------------------------------------------------------------------------
  // Input transform: prepend startup reminder on the first normal user message
  // for the current provider/model. If the user switches models with /model,
  // the next normal message gets the reminder again.
  // -------------------------------------------------------------------------

  pi.on("input", async (event, ctx) => {
    // Skip extension-sourced and slash-command messages.
    if (event.source === "extension") return { action: "continue" };
    if (event.text.startsWith("/")) return { action: "continue" };
    // Skip if the reminder text is already present (defensive).
    if (event.text.includes(REMINDER)) return { action: "continue" };

    const { provider, model } = getProviderModel(ctx);
    const modelKey = `${provider}/${model}`;
    if (lastRemindedModelKey === modelKey) return { action: "continue" };

    lastRemindedModelKey = modelKey;
    log(`input: reminder injected provider=${provider} model=${model}`);

    return {
      action: "transform",
      text: `${REMINDER}\n\nUser task:\n${event.text}`,
      images: event.images,
    };
  });

  // -------------------------------------------------------------------------
  // System prompt: append mandatory reminder for ALL providers.
  // This is the soft path -- even if a model ignores user-turn injection,
  // the system prompt version may stick.
  // -------------------------------------------------------------------------

  pi.on("before_agent_start", async (event, ctx) => {
    const current = event.systemPrompt ?? "";
    // Don't double-append
    if (current.includes("# Mandatory startup reminder")) return;

    const { provider, model } = getProviderModel(ctx);
    log(`before_agent_start: system prompt appended provider=${provider} model=${model}`);

    return { systemPrompt: `${current}${SYSTEM_REMINDER}` };
  });

  // -------------------------------------------------------------------------
  // Tool call gate: block FORBIDDEN bash commands and secret leaks.
  // This is hard enforcement -- the model cannot bypass it.
  // -------------------------------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const cmd = event.input.command ?? "";
    const { provider, model } = getProviderModel(ctx);

    // Check BLOCKED patterns (curl, wget, inline HTTP)
    for (const { pattern, reason } of BLOCKED_BASH_PATTERNS) {
      if (pattern.test(cmd)) {
        log(
          `tool_call: BLOCKED command="${cmd.slice(0, 120)}" reason="${reason}" provider=${provider} model=${model}`
        );
        return { block: true, reason };
      }
    }

    // Check for secret exposure (echo $API_KEY, printenv SECRET, etc.)
    // Match patterns like: echo $VAR, echo ${VAR}, printf $VAR
    const echoSecretMatch = cmd.match(
      /\b(?:echo|printf)\b.*\$\{?([A-Z_]+)\}?/
    );
    if (echoSecretMatch) {
      const varName = echoSecretMatch[1];
      if (SECRET_KEY_PATTERNS.test(varName)) {
        const reason = `Blocked: command would expose secret $${varName}. Reference secrets by variable name only, never echo their values.`;
        log(
          `tool_call: BLOCKED secret exposure var=${varName} provider=${provider} model=${model}`
        );
        return { block: true, reason };
      }
    }
  });
}
