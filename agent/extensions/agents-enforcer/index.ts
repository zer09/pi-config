import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TARGET_PROVIDERS = new Set(["cursor", "claude-bridge"]);
const LOG = join(homedir(), ".pi", "agent", "agents-enforcer.log");

const REMINDER = `Before doing any task, follow ~/.pi/agent/AGENTS.md Session Startup rules. First read skills/context-watcher/SKILL.md, then read rules/, then use Context Watcher command routing.`;

const SYSTEM_REMINDER = `

# Mandatory startup reminder

${REMINDER}
`;

function log(message: string) {
  try {
    appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // ignore logging failures
  }
}

function isTargetProvider(ctx: any): boolean {
  const provider = ctx.model?.provider;
  return !!provider && TARGET_PROVIDERS.has(provider);
}

export default function (pi: ExtensionAPI) {
  log("loaded");

  // Hard enforcement path: make the reminder part of the visible user turn for
  // providers that are known to underweight or bridge around Pi's AGENTS context.
  pi.on("input", async (event, ctx) => {
    if (!isTargetProvider(ctx)) return { action: "continue" };
    if (event.source === "extension") return { action: "continue" };
    if (event.text.startsWith("/")) return { action: "continue" };
    if (event.text.includes(REMINDER)) return { action: "continue" };

    log(`input transform provider=${ctx.model?.provider ?? "none"} model=${ctx.model?.id ?? "none"}`);
    return {
      action: "transform",
      text: `${REMINDER}\n\nUser task:\n${event.text}`,
      images: event.images,
    };
  });

  // Soft enforcement path: also append to the Pi system prompt for providers
  // that consume it normally. Cursor receives this through OpenAI messages.
  pi.on("before_agent_start", async (event, ctx) => {
    if (!isTargetProvider(ctx)) return;
    const current = event.systemPrompt ?? "";
    if (current.includes("# Mandatory startup reminder")) return;

    log(`before_agent_start applied provider=${ctx.model?.provider ?? "none"} model=${ctx.model?.id ?? "none"}`);
    return { systemPrompt: `${current}${SYSTEM_REMINDER}` };
  });
}
