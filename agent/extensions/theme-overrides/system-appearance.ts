/**
 * Operating-system and system appearance detection.
 *
 * This module contains the platform-specific probes used to map the host system
 * appearance to Pi's built-in "dark" or "light" theme selectors.
 */

import { platform, release } from "node:os"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { execOutput, getWindowsRegCommand } from "./system-commands.ts"
import type { DetectedOS, ResolvedConfig, ThemeKind } from "./types.ts"

/**
 * Detect the host OS category relevant to appearance querying.
 *
 * @returns A normalized OS category used by system appearance detection.
 */
export function detectOS(): DetectedOS {
  const osPlatform = platform()
  const osRelease = release()

  if (/microsoft|wsl/i.test(osRelease)) return "WSL"
  if (/orbstack/i.test(osRelease)) return "OrbStack"
  if (osPlatform === "darwin") return "Darwin"
  if (osPlatform === "win32") return "Windows_NT"
  if (osPlatform === "linux") return "Linux"
  return "unsupported"
}

/**
 * Detect Windows app appearance from the registry.
 *
 * @param pi - Pi extension API used to execute the registry command.
 * @param queryTimeoutMs - Timeout for the registry query.
 * @returns Detected theme kind, or undefined when detection fails.
 */
export async function detectWindowsAppearance(
  pi: ExtensionAPI,
  queryTimeoutMs: number,
): Promise<ThemeKind | undefined> {
  const result = await execOutput(
    pi,
    getWindowsRegCommand(),
    ["Query", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
    { timeout: queryTimeoutMs },
  )
  if (!result) return undefined

  const output = `${result.stdout}\n${result.stderr}`
  if (!/AppsUseLightTheme/i.test(output)) return undefined
  return /0x1\b/i.test(output) ? "light" : "dark"
}

/**
 * Detect Linux desktop appearance through xdg-desktop-portal.
 *
 * @param pi - Pi extension API used to execute dbus-send.
 * @param queryTimeoutMs - Timeout for the DBus query.
 * @returns Detected theme kind, or undefined when detection fails.
 */
export async function detectLinuxAppearance(pi: ExtensionAPI, queryTimeoutMs: number): Promise<ThemeKind | undefined> {
  const result = await execOutput(
    pi,
    "dbus-send",
    [
      "--session",
      "--print-reply=literal",
      "--reply-timeout=1000",
      "--dest=org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop",
      "org.freedesktop.portal.Settings.Read",
      "string:org.freedesktop.appearance",
      "string:color-scheme",
    ],
    { timeout: queryTimeoutMs },
  )
  if (!result || result.stderr.trim() !== "") return undefined

  // xdg-desktop-portal color-scheme: 0 = no preference, 1 = dark, 2 = light.
  if (/uint32\s+1\b/.test(result.stdout)) return "dark"
  if (/uint32\s+[02]\b/.test(result.stdout)) return "light"
  return undefined
}

/**
 * Detect macOS appearance using defaults, optionally through OrbStack's mac shim.
 *
 * @param pi - Pi extension API used to execute the query command.
 * @param queryTimeoutMs - Timeout for the appearance query.
 * @param viaOrbStack - Whether to query the macOS host through OrbStack.
 * @returns Detected theme kind, or undefined when command execution fails.
 */
export async function detectDarwinAppearance(
  pi: ExtensionAPI,
  queryTimeoutMs: number,
  viaOrbStack = false,
): Promise<ThemeKind | undefined> {
  const command = viaOrbStack ? "mac" : "defaults"
  const args = viaOrbStack ? ["defaults", "read", "-g", "AppleInterfaceStyle"] : ["read", "-g", "AppleInterfaceStyle"]
  const result = await execOutput(pi, command, args, { allowNonZero: true, timeout: queryTimeoutMs })
  if (!result) return undefined

  return result.stdout.trim() === "Dark" ? "dark" : "light"
}

/**
 * Detect the current system appearance with configured fallback behavior.
 *
 * @param pi - Pi extension API used to execute platform-specific probes.
 * @param config - Resolved extension configuration.
 * @returns Detected theme kind, or config.fallbackTheme when detection fails.
 */
export async function detectSystemAppearance(pi: ExtensionAPI, config: ResolvedConfig): Promise<ThemeKind> {
  let detected: ThemeKind | undefined

  switch (detectOS()) {
    case "WSL":
    case "Windows_NT":
      detected = await detectWindowsAppearance(pi, config.queryTimeoutMs)
      break

    case "Linux":
      detected = await detectLinuxAppearance(pi, config.queryTimeoutMs)
      break

    case "Darwin":
      detected = await detectDarwinAppearance(pi, config.queryTimeoutMs)
      break

    case "OrbStack":
      detected = await detectDarwinAppearance(pi, config.queryTimeoutMs, true)
      break

    case "unsupported":
      break
  }

  return detected ?? config.fallbackTheme
}
