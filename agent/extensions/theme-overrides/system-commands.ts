/**
 * System command helpers for appearance detection probes.
 *
 * This module wraps Pi's exec API with the original fail-open behavior and owns
 * Windows registry command discovery for native Windows and WSL environments.
 */

import { existsSync } from "node:fs"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import type { CommandOutput, CommandOutputOptions } from "./types.ts"

/**
 * Execute a command and return captured output when it completes successfully.
 *
 * By default, killed commands and non-zero exit codes are treated as unavailable
 * detection results rather than hard failures.
 *
 * @param pi - Pi extension API used to execute commands.
 * @param command - Executable name or path.
 * @param args - Command arguments.
 * @param options - Optional timeout and non-zero exit-code handling.
 * @returns Captured command output, or undefined when the command fails.
 */
export async function execOutput(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  options: CommandOutputOptions = {},
): Promise<CommandOutput | undefined> {
  try {
    const result = await pi.exec(command, args, { timeout: options.timeout })
    if (result.killed) return undefined
    if (!options.allowNonZero && result.code !== 0) return undefined
    return { stdout: result.stdout, stderr: result.stderr, code: result.code }
  } catch {
    return undefined
  }
}

/**
 * Locate the Windows registry executable from WSL-friendly candidate paths.
 *
 * @returns The first existing reg.exe candidate, or "reg.exe" for PATH lookup.
 */
export function getWindowsRegCommand(): string {
  const candidates = [
    "/mnt/c/Windows/System32/reg.exe",
    "/mnt/c/WINDOWS/system32/reg.exe",
    "/mnt/c/Windows/system32/reg.exe",
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? "reg.exe"
}
