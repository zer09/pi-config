import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionContextLike } from "./types.js";

export type ResolveProjectDirOptions = {
  env?: Record<string, string | undefined>;
  pwd?: string;
  ctx?: ExtensionContextLike;
  cwd?: string;
  home?: string;
};

function normalizePathCandidate(candidate: string | undefined): string | undefined {
  if (!candidate || candidate.trim().length === 0) return undefined;
  return resolve(candidate.replace(/^@/, ""));
}

export function isUnderPiConfig(path: string | undefined, home = homedir()): boolean {
  const candidate = normalizePathCandidate(path);
  if (!candidate) return true;
  const piConfigDir = resolve(join(home, ".pi"));
  return candidate === piConfigDir || candidate.startsWith(piConfigDir + "/") || candidate.startsWith(piConfigDir + "\\");
}

export function resolveProjectDir(options: ResolveProjectDirOptions = {}): string {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const candidates = [
    env.PI_WORKSPACE_DIR,
    env.PI_PROJECT_DIR,
    options.ctx?.cwd,
    options.pwd ?? env.PWD,
    options.cwd ?? process.cwd(),
  ];

  for (const candidate of candidates) {
    const resolved = normalizePathCandidate(candidate);
    if (resolved && !isUnderPiConfig(resolved, home)) return resolved;
  }

  return resolve(home);
}

export function resolveUserPath(path: string, projectDir: string): string {
  const normalized = path.replace(/^@/, "");
  return isAbsolute(normalized) ? resolve(normalized) : resolve(projectDir, normalized);
}
