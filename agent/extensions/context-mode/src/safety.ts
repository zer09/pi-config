import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyError";
  }
}

function stripHeredocContent(command: string): string {
  return command.replace(/<<-?\s*["']?(\w+)["']?[\s\S]*?\n\s*\1/g, "");
}

export function stripQuotedContent(command: string): string {
  return stripHeredocContent(command)
    .replace(/'[^']*'/g, "''")
    .replace(/"[^\"]*"/g, '""');
}

function unwrapLeadingEnvAssignments(command: string): string {
  let remaining = command.trimStart();
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/.test(remaining)) {
    remaining = remaining.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/, "");
  }
  return remaining;
}

function stripQuoteMarks(command: string): string {
  return command.replace(/["']/g, "");
}

export function commandForSafety(command: string): string {
  let normalized = stripQuotedContent(command).trim();
  normalized = unwrapLeadingEnvAssignments(normalized);
  if (/^rtk(?:\s|$)/.test(normalized)) {
    normalized = normalized.replace(/^rtk\s+/, "").trimStart();
  }
  return normalized;
}

function commandForRawSafety(command: string): string {
  let normalized = unwrapLeadingEnvAssignments(command.trim());
  if (/^rtk(?:\s|$)/.test(normalized)) {
    normalized = normalized.replace(/^rtk\s+/, "").trimStart();
  }
  return normalized;
}

function commandSafetyVariants(command: string): string[] {
  const variants = [commandForSafety(command), commandForSafety(stripQuoteMarks(command))];
  return [...new Set(variants)];
}

function rawCommandSafetyVariants(command: string): string[] {
  const variants = [commandForRawSafety(command), commandForRawSafety(stripQuoteMarks(command))];
  return [...new Set(variants)];
}

type DenyRule = { pattern: RegExp; reason: string };

type ShellToken = { kind: "word" | "separator"; value: string };

const SHELL_COMMANDS = new Set(["sh", "bash", "zsh", "csh", "dash"]);
const COMMAND_WRAPPERS = new Set(["sudo", "doas", "nohup", "time", "nice", "env", "ionice", "xargs", "command"]);

function isEnvAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function optionName(value: string): string {
  const equals = value.indexOf("=");
  return equals >= 0 ? value.slice(0, equals) : value;
}

function shellTokens(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let word = "";
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  const flushWord = () => {
    if (word.length > 0) tokens.push({ kind: "word", value: word });
    word = "";
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    const next = command[i + 1];

    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (char === "\\" && !inSingleQuotes && next !== undefined && (!inDoubleQuotes || /[$`"\\\n]/.test(next))) {
      if (next !== "\n") word += next;
      i++;
    } else if (!inSingleQuotes && !inDoubleQuotes && /\s/.test(char)) {
      flushWord();
    } else if (!inSingleQuotes && !inDoubleQuotes && /[;&|()`<>]/.test(char)) {
      flushWord();
      tokens.push({ kind: "separator", value: char });
    } else {
      word += char;
    }
  }
  flushWord();
  return tokens;
}

function argsAfter(tokens: ShellToken[], index: number): string[] {
  const args: string[] = [];
  for (let i = index + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (token.kind === "separator") break;
    args.push(token.value);
  }
  return args;
}

function skipLeadingOptions(tokens: ShellToken[], index: number, end: number, valueOptions: Set<string>): number {
  let i = index;
  while (i < end && tokens[i]?.kind === "word") {
    const value = tokens[i]!.value;
    if (value === "--") return i + 1;
    if (!value.startsWith("-") || value === "-") break;
    i++;
    if (!value.includes("=") && valueOptions.has(optionName(value))) i++;
  }
  return i;
}

function skipWrapper(tokens: ShellToken[], index: number, end: number): number {
  const wrapper = tokens[index]?.value;
  let i = index + 1;

  if (wrapper === "sudo") {
    i = skipLeadingOptions(tokens, i, end, new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-T", "--command-timeout", "-D", "--chdir"]));
  } else if (wrapper === "doas") {
    i = skipLeadingOptions(tokens, i, end, new Set(["-u", "-C"]));
  } else if (wrapper === "time") {
    i = skipLeadingOptions(tokens, i, end, new Set(["-f", "--format", "-o", "--output"]));
  } else if (wrapper === "nice") {
    i = skipLeadingOptions(tokens, i, end, new Set(["-n", "--adjustment"]));
  } else if (wrapper === "env") {
    i = skipLeadingOptions(tokens, i, end, new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string", "--argv0"]));
    while (tokens[i]?.kind === "word" && isEnvAssignment(tokens[i]!.value)) i++;
  } else if (wrapper === "ionice") {
    i = skipLeadingOptions(tokens, i, end, new Set(["-c", "--class", "-n", "--classdata", "-p", "--pid", "-P", "--pgid"]));
  } else if (wrapper === "xargs") {
    i = skipLeadingOptions(tokens, i, end, new Set(["-a", "--arg-file", "-d", "--delimiter", "-E", "--eof", "-I", "--replace", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"]));
  } else if (wrapper === "command") {
    while (i < end && tokens[i]?.kind === "word") {
      const value = tokens[i]!.value;
      if (value === "--") return i + 1;
      if (!value.startsWith("-") || value === "-") break;
      if (/[vV]/.test(value.slice(1))) return end;
      i++;
    }
  }

  return i;
}

function unwrapCommandIndex(tokens: ShellToken[], start: number, end: number): number {
  let i = start;
  for (let guard = 0; guard < 20; guard++) {
    while (tokens[i]?.kind === "word" && isEnvAssignment(tokens[i]!.value)) i++;
    const value = tokens[i]?.value;
    if (!value || i >= end) return end;
    if (value === "rtk") {
      i++;
      continue;
    }
    if (COMMAND_WRAPPERS.has(value)) {
      i = skipWrapper(tokens, i, end);
      continue;
    }
    return i;
  }
  return i;
}

function commandIndexes(tokens: ShellToken[]): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < tokens.length;) {
    while (tokens[i]?.kind === "separator") i++;
    const start = i;
    while (i < tokens.length && tokens[i]?.kind !== "separator") i++;
    const end = i;
    const commandIndex = unwrapCommandIndex(tokens, start, end);
    if (commandIndex < end && tokens[commandIndex]?.kind === "word") indexes.push(commandIndex);
  }
  return indexes;
}

function hasRmDeny(command: string): boolean {
  const tokens = shellTokens(command);
  for (const i of commandIndexes(tokens)) {
    if (tokens[i]?.value !== "rm") continue;
    for (const arg of argsAfter(tokens, i)) {
      if (arg === "--") break;
      if (arg === "--recursive" || arg.startsWith("--recursive=")) return true;
      if (arg === "--force" || arg.startsWith("--force=")) return true;
      if (arg.startsWith("--")) continue;
      if (arg.startsWith("-") && /[rRf]/.test(arg.slice(1))) return true;
    }
  }
  return false;
}

function hasRecursiveChmodChownDeny(command: string): boolean {
  const tokens = shellTokens(command);
  for (const i of commandIndexes(tokens)) {
    const token = tokens[i];
    if (!token || (token.value !== "chmod" && token.value !== "chown")) continue;
    for (const arg of argsAfter(tokens, i)) {
      if (arg === "--") break;
      if (arg === "--recursive" || arg.startsWith("--recursive=")) return true;
      if (arg.startsWith("--")) continue;
      if (arg.startsWith("-") && arg.slice(1).includes("R")) return true;
    }
  }
  return false;
}

function isBroadMvSource(arg: string): boolean {
  if ([".", "..", "/", "~", "$HOME", "${HOME}"].includes(arg)) return true;
  if (/^\.\.\//.test(arg)) return true;
  if (/^~\//.test(arg)) return true;
  if (/^\$HOME\//.test(arg) || /^\$\{HOME\}\//.test(arg)) return true;
  return /^\/(?:etc|home|root|usr|bin|sbin|lib|lib64|opt|var|boot|dev|proc|sys|run|private)(?:\/|$)/i.test(arg);
}

function mvSourceArgs(args: string[]): string[] {
  const sources: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      sources.push(...args.slice(i + 1));
      break;
    }
    if (arg === "-t" || arg === "--target-directory") {
      i++;
      continue;
    }
    if (arg.startsWith("--target-directory=")) continue;
    if (arg.startsWith("-")) continue;
    sources.push(arg);
  }
  return sources.length > 1 ? sources.slice(0, -1) : sources;
}

function hasBroadMvDeny(command: string): boolean {
  const tokens = shellTokens(command);
  for (const i of commandIndexes(tokens)) {
    if (tokens[i]?.value !== "mv") continue;
    if (mvSourceArgs(argsAfter(tokens, i)).some(isBroadMvSource)) return true;
  }
  return false;
}

function hasEmbeddedShellDeny(command: string): boolean {
  const tokens = shellTokens(command);
  for (const i of commandIndexes(tokens)) {
    const commandName = tokens[i]?.value;
    if (commandName === "eval") return true;
    if (!commandName || !SHELL_COMMANDS.has(commandName)) continue;
    for (const arg of argsAfter(tokens, i)) {
      if (arg === "--") break;
      if (arg.startsWith("-") && arg.slice(1).includes("c")) return true;
    }
  }
  return false;
}

function hasShellHeredocDeny(command: string): boolean {
  const tokens = shellTokens(command);
  for (const i of commandIndexes(tokens)) {
    const commandName = tokens[i]?.value;
    if (!commandName || !SHELL_COMMANDS.has(commandName)) continue;
    if (argsAfter(tokens, i).some((arg) => arg.startsWith("<<"))) return true;
  }
  return false;
}

function hasPipeToShellDeny(command: string): boolean {
  const tokens = shellTokens(commandForRawSafety(stripHeredocContent(command)));
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.kind !== "separator" || tokens[i]?.value !== "|") continue;
    let end = i + 1;
    while (end < tokens.length && tokens[end]?.kind !== "separator") end++;
    const commandIndex = unwrapCommandIndex(tokens, i + 1, end);
    const commandName = tokens[commandIndex]?.value;
    if (commandName && SHELL_COMMANDS.has(commandName)) return true;
  }
  return false;
}

function isSensitiveRedirectionTarget(target: string): boolean {
  return /(?:^|\/)(?:\.env(?:\.[^/\s]*)?|\.git\/config|[^/\s]+\.(?:pem|key))$/i.test(target);
}

function hasSensitiveRedirectionDeny(command: string): boolean {
  const tokens = shellTokens(commandForRawSafety(stripHeredocContent(command)));
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.kind !== "separator" || tokens[i]?.value !== ">") continue;
    if (tokens[i + 1]?.kind === "separator" && tokens[i + 1]?.value === ">") i++;
    const target = tokens[i + 1];
    if (target?.kind === "word" && isSensitiveRedirectionTarget(target.value)) return true;
  }
  return false;
}

function stripCliGlobalOptions(args: string[], valueOptions: Set<string>): string[] {
  let i = 0;
  while (i < args.length) {
    const value = args[i]!;
    if (value === "--") return args.slice(i + 1);
    if (!value.startsWith("-") || value === "-") break;
    i++;
    if (!value.includes("=") && valueOptions.has(optionName(value))) i++;
  }
  return args.slice(i);
}

const GIT_GLOBAL_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"]);
const GH_GLOBAL_VALUE_OPTIONS = new Set(["-R", "--repo", "--hostname", "--config"]);
const KUBECTL_GLOBAL_VALUE_OPTIONS = new Set(["--context", "--namespace", "-n", "--kubeconfig", "--server", "--user", "--cluster", "--as", "--token", "--request-timeout"]);
const TERRAFORM_GLOBAL_VALUE_OPTIONS = new Set(["-chdir"]);
const CLOUD_GLOBAL_VALUE_OPTIONS = new Set(["--project", "--context", "--site", "--org", "--cwd", "--config", "--token"]);
const DOCKER_GLOBAL_VALUE_OPTIONS = new Set(["--context", "--config", "-H", "--host", "--log-level", "--tlscacert", "--tlscert", "--tlskey"]);
const PACKAGE_GLOBAL_VALUE_OPTIONS = new Set(["--workspace", "-w", "--prefix", "--registry", "--userconfig", "--filter", "-F", "--cwd", "-C", "--dir"]);
const RUNNER_VALUE_OPTIONS = new Set(["--package", "-p", "--cache", "--userconfig", "--registry", "--workspace", "-w", "--cwd", "-C", "--dir", "--filter", "-F"]);

function hasMutatingGhApi(args: string[]): boolean {
  const mutatingMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    let method: string | undefined;
    if (arg === "-X" || arg === "--method") method = args[++i];
    else if (arg.startsWith("-X") && arg.length > 2) method = arg.slice(2);
    else if (arg.startsWith("--method=")) method = arg.slice("--method=".length);
    if (method && mutatingMethods.has(method.toUpperCase())) return true;
  }
  return false;
}

function getRunnerCommandDenyReason(args: string[]): string | null {
  const rest = stripCliGlobalOptions(args, RUNNER_VALUE_OPTIONS);
  const commandName = rest[0];
  if (!commandName) return null;

  if (commandName === "semantic-release") return "release automation is blocked";
  if (commandName === "changeset" && stripCliGlobalOptions(rest.slice(1), new Set())[0] === "publish") return "package publish commands are blocked";
  if (["vercel", "netlify", "firebase", "flyctl"].includes(commandName)) {
    const commandRest = stripCliGlobalOptions(rest.slice(1), CLOUD_GLOBAL_VALUE_OPTIONS);
    if (["deploy", "release"].includes(commandRest[0] ?? "")) return "deployment commands are blocked";
  }
  if (["npm", "pnpm", "yarn"].includes(commandName)) {
    const commandRest = stripCliGlobalOptions(rest.slice(1), PACKAGE_GLOBAL_VALUE_OPTIONS);
    if (commandRest[0] === "publish") return "package publish commands are blocked";
    if (commandName === "yarn" && commandRest[0] === "npm" && commandRest[1] === "publish") return "package publish commands are blocked";
  }
  return null;
}

function getMutatingCliDenyReason(command: string): string | null {
  const tokens = shellTokens(command);
  for (const i of commandIndexes(tokens)) {
    const commandName = tokens[i]?.value;
    if (!commandName) continue;
    const args = argsAfter(tokens, i);

    if (commandName === "git") {
      const rest = stripCliGlobalOptions(args, GIT_GLOBAL_VALUE_OPTIONS);
      const subcommand = rest[0];
      if (subcommand === "push") return "git push mutates a hosted repository";
      if (subcommand === "reset" && rest.includes("--hard")) return "git reset --hard is destructive";
      if (subcommand === "clean" && rest.slice(1).some((arg) => arg.startsWith("-") && /[fd]/.test(arg.slice(1)))) return "git clean -fd is destructive";
      if (subcommand === "checkout" && rest.some((arg, index) => arg === "--" && rest[index + 1] === ".")) return "git checkout -- . discards changes";
    } else if (commandName === "gh") {
      const rest = stripCliGlobalOptions(args, GH_GLOBAL_VALUE_OPTIONS);
      if (rest[0] === "api" && hasMutatingGhApi(rest.slice(1))) return "mutating gh api methods are blocked";
      if (rest[0] === "pr" && stripCliGlobalOptions(rest.slice(1), GH_GLOBAL_VALUE_OPTIONS)[0] === "merge") return "gh pr merge mutates a hosted repository";
      if (rest[0] === "issue" && stripCliGlobalOptions(rest.slice(1), GH_GLOBAL_VALUE_OPTIONS)[0] === "edit") return "gh issue edit mutates a hosted issue";
      if (rest[0] === "release" && ["create", "delete", "upload"].includes(stripCliGlobalOptions(rest.slice(1), GH_GLOBAL_VALUE_OPTIONS)[0] ?? "")) return "gh release mutation is blocked";
    } else if (commandName === "kubectl") {
      const rest = stripCliGlobalOptions(args, KUBECTL_GLOBAL_VALUE_OPTIONS);
      if (["apply", "delete", "patch", "scale"].includes(rest[0] ?? "")) return "mutating kubectl command is blocked";
    } else if (commandName === "terraform") {
      const rest = stripCliGlobalOptions(args, TERRAFORM_GLOBAL_VALUE_OPTIONS);
      if (["apply", "destroy"].includes(rest[0] ?? "")) return "mutating terraform command is blocked";
    } else if (["npm", "pnpm", "yarn"].includes(commandName)) {
      const rest = stripCliGlobalOptions(args, PACKAGE_GLOBAL_VALUE_OPTIONS);
      if (rest[0] === "publish") return "package publish commands are blocked";
      if (commandName === "yarn" && rest[0] === "npm" && rest[1] === "publish") return "package publish commands are blocked";
      if ((commandName === "npm" && ["exec", "x"].includes(rest[0] ?? "")) || (["pnpm", "yarn"].includes(commandName) && rest[0] === "dlx")) {
        const runnerReason = getRunnerCommandDenyReason(rest.slice(1));
        if (runnerReason) return runnerReason;
      }
    } else if (commandName === "npx") {
      const runnerReason = getRunnerCommandDenyReason(args);
      if (runnerReason) return runnerReason;
    } else if (commandName === "changeset") {
      const rest = stripCliGlobalOptions(args, new Set());
      if (rest[0] === "publish") return "package publish commands are blocked";
    } else if (commandName === "semantic-release") {
      return "release automation is blocked";
    } else if (["vercel", "netlify", "firebase", "flyctl"].includes(commandName)) {
      const rest = stripCliGlobalOptions(args, CLOUD_GLOBAL_VALUE_OPTIONS);
      if (["deploy", "release"].includes(rest[0] ?? "")) return "deployment commands are blocked";
    } else if (commandName === "gcloud") {
      const rest = stripCliGlobalOptions(args, CLOUD_GLOBAL_VALUE_OPTIONS);
      if (rest.includes("deploy")) return "deployment commands are blocked";
    } else if (commandName === "docker") {
      const rest = stripCliGlobalOptions(args, DOCKER_GLOBAL_VALUE_OPTIONS);
      if (rest[0] === "push") return "docker push mutates a registry";
    }
  }
  return null;
}

const RAW_COMMAND_DENY_RULES: DenyRule[] = [
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*(?:ba|z|c|da)?sh\b[^\n;&|()`]*<<-?/i, reason: "shell heredoc execution is blocked" },
];

const COMMAND_DENY_RULES: DenyRule[] = [
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*(?:eval|(?:ba|z|c|da)?sh\s+-c)\b/i, reason: "embedded shell execution is blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*git\s+push\b/i, reason: "git push mutates a hosted repository" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*git\s+reset\s+--hard\b/i, reason: "git reset --hard is destructive" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*git\s+clean\s+-[^\s]*[fd][^\s]*\b/i, reason: "git clean -fd is destructive" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*git\s+checkout\s+--\s+\.(?:\s|$)/i, reason: "git checkout -- . discards changes" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*gh\s+api\b[^\n]*(?:\s-X\s*|\s--method[=\s]+)(?:POST|PATCH|PUT|DELETE)\b/i, reason: "mutating gh api methods are blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*gh\s+pr\s+merge\b/i, reason: "gh pr merge mutates a hosted repository" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*gh\s+issue\s+edit\b/i, reason: "gh issue edit mutates a hosted issue" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*gh\s+release\s+(?:create|delete|upload)\b/i, reason: "gh release mutation is blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*kubectl\s+(?:apply|delete|patch|scale)\b/i, reason: "mutating kubectl command is blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*terraform\s+(?:apply|destroy)\b/i, reason: "mutating terraform command is blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*(?:npm|pnpm|yarn)\s+publish\b/i, reason: "package publish commands are blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*changeset\s+publish\b/i, reason: "package publish commands are blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*semantic-release\b/i, reason: "release automation is blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*(?:vercel|netlify|firebase|flyctl)\s+(?:deploy|release)\b/i, reason: "deployment commands are blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*gcloud\b[^\n]*\bdeploy\b/i, reason: "deployment commands are blocked" },
  { pattern: /(?:^|(?<!\\)[;&|()`])\s*docker\s+push\b/i, reason: "docker push mutates a registry" },
];

export function getCommandDenyReason(command: string): string | null {
  if (hasPipeToShellDeny(command)) return "pipe to shell execution is blocked";
  if (hasSensitiveRedirectionDeny(command)) return "redirection to sensitive files is blocked";

  for (const candidate of rawCommandSafetyVariants(command)) {
    if (hasShellHeredocDeny(candidate)) return "shell heredoc execution is blocked";
    for (const rule of RAW_COMMAND_DENY_RULES) {
      if (rule.pattern.test(candidate)) return rule.reason;
    }
  }

  for (const candidate of commandSafetyVariants(command)) {
    if (hasRmDeny(candidate)) return "rm recursive/force is destructive";
    if (hasRecursiveChmodChownDeny(candidate)) return "recursive chmod/chown is destructive";
    if (hasBroadMvDeny(candidate)) return "broad mv operations are destructive";
    if (hasEmbeddedShellDeny(candidate)) return "embedded shell execution is blocked";
    const cliReason = getMutatingCliDenyReason(candidate);
    if (cliReason) return cliReason;
    for (const rule of COMMAND_DENY_RULES) {
      if (rule.pattern.test(candidate)) return rule.reason;
    }
  }
  return null;
}

export function assertSafeBatchCommand(command: string): void {
  const reason = getCommandDenyReason(command);
  if (reason) throw new SafetyError(`Blocked ctx_batch_execute command: ${reason}. Command: ${command}`);
}

const SENSITIVE_BASENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".netrc",
  ".npmrc",
  ".pypirc",
]);

function slash(path: string): string {
  return path.split(sep).join("/");
}

function pathVariants(path: string): string[] {
  const lexical = resolve(path.replace(/^@/, ""));
  try {
    const real = realpathSync(lexical);
    return real === lexical ? [lexical] : [lexical, real];
  } catch {
    return [lexical];
  }
}

function getSinglePathDenyReason(absolute: string, home: string): string | null {
  const base = basename(absolute);
  const lowerBase = base.toLowerCase();
  const lowerPath = slash(absolute).toLowerCase();
  const homeRelative = slash(relative(home, absolute)).toLowerCase();

  if (lowerBase === ".env" || lowerBase.startsWith(".env.")) return ".env files are blocked";
  if (SENSITIVE_BASENAMES.has(lowerBase)) return "credential/private-key files are blocked";
  if (lowerBase.endsWith(".pem") || lowerBase.endsWith(".key")) return "private key files are blocked";
  if (/(^|\/)\.git\/config$/.test(lowerPath)) return ".git/config is blocked";

  const sensitiveConfigPaths = [
    ".aws/credentials",
    ".docker/config.json",
    ".config/gh/hosts.yml",
    ".config/gcloud/application_default_credentials.json",
    ".config/hub",
  ];
  if (sensitiveConfigPaths.some((sensitive) => homeRelative === sensitive || homeRelative.endsWith(`/${sensitive}`))) {
    return "credential files under common config directories are blocked";
  }

  return null;
}

export function getPathDenyReason(path: string, options: { home?: string } = {}): string | null {
  const home = resolve(options.home ?? homedir());
  for (const variant of pathVariants(path)) {
    const reason = getSinglePathDenyReason(variant, home);
    if (reason) return reason;
  }
  return null;
}

function hasSensitiveDirectorySegment(absolute: string, home: string): boolean {
  const normalized = slash(absolute).toLowerCase();
  const homeRelative = slash(relative(home, absolute)).toLowerCase();
  if (/(^|\/)\.git(?:\/|$)/.test(normalized)) return true;
  if (/(^|\/)\.ssh(?:\/|$)/.test(normalized)) return true;
  return [".aws", ".config/gh", ".config/gcloud", ".docker"].some(
    (sensitive) => homeRelative === sensitive || homeRelative.startsWith(`${sensitive}/`) || homeRelative.endsWith(`/${sensitive}`),
  );
}

export function getWorkingDirectoryDenyReason(path: string, options: { home?: string } = {}): string | null {
  const home = resolve(options.home ?? homedir());
  for (const variant of pathVariants(path)) {
    const pathReason = getSinglePathDenyReason(variant, home);
    if (pathReason) return pathReason;
    if (hasSensitiveDirectorySegment(variant, home)) return "sensitive working directories are blocked";
  }
  return null;
}

export function assertSafeFilePath(path: string): void {
  const reason = getPathDenyReason(path);
  if (reason) throw new SafetyError(`Blocked ctx_execute_file path: ${reason}. Path: ${path}`);
}

export function assertSafeWorkingDirectory(path: string): void {
  const reason = getWorkingDirectoryDenyReason(path);
  if (reason) throw new SafetyError(`Blocked ctx_batch_execute cwd: ${reason}. Path: ${path}`);
}
