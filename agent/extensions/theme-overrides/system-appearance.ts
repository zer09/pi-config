/**
 * Operating-system and system appearance detection.
 *
 * This module contains the platform-specific probes used to map the host system
 * appearance to Pi's `dark` or `light` theme selectors.
 */

import { platform, release } from "node:os"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { QUERY_TIMEOUT_MS } from "./constants.ts"
import { execOutput, getWindowsRegCommand } from "./system-commands.ts"
import type { DetectedOS, ThemeKind } from "./types.ts"

/**
 * Detect the host OS category relevant to appearance querying.
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
 */
export async function detectWindowsAppearance(
  pi: ExtensionAPI,
  queryTimeoutMs: number,
  allowWindowsInteropPath = false,
  signal?: AbortSignal,
): Promise<ThemeKind | undefined> {
  const result = await execOutput(
    pi,
    getWindowsRegCommand(allowWindowsInteropPath),
    ["Query", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
    { signal, timeout: queryTimeoutMs },
  )
  if (!result) return undefined

  const output = `${result.stdout}\n${result.stderr}`
  if (!/AppsUseLightTheme/i.test(output)) return undefined
  return /0x1\b/i.test(output) ? "light" : "dark"
}

/**
 * Detect Linux desktop appearance through xdg-desktop-portal.
 */
export async function detectLinuxAppearance(
  pi: ExtensionAPI,
  queryTimeoutMs: number,
  signal?: AbortSignal,
): Promise<ThemeKind | undefined> {
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
    { signal, timeout: queryTimeoutMs },
  )
  if (!result || result.stderr.trim() !== "") return undefined

  // xdg-desktop-portal color-scheme: 0 = no preference, 1 = dark, 2 = light.
  if (/uint32\s+1\b/.test(result.stdout)) return "dark"
  if (/uint32\s+[02]\b/.test(result.stdout)) return "light"
  return undefined
}

/**
 * Detect macOS appearance using defaults, optionally through OrbStack's mac shim.
 */
export async function detectDarwinAppearance(
  pi: ExtensionAPI,
  queryTimeoutMs: number,
  viaOrbStack = false,
  signal?: AbortSignal,
): Promise<ThemeKind | undefined> {
  const command = viaOrbStack ? "mac" : "defaults"
  const args = viaOrbStack ? ["defaults", "read", "-g", "AppleInterfaceStyle"] : ["read", "-g", "AppleInterfaceStyle"]
  const result = await execOutput(pi, command, args, { allowNonZero: true, signal, timeout: queryTimeoutMs })
  if (!result) return undefined

  return result.stdout.trim() === "Dark" ? "dark" : "light"
}

/**
 * Detect the current system appearance.
 *
 * Undefined means no reliable signal was available; callers should leave Pi's
 * current/default theme alone.
 */
export async function detectSystemAppearance(pi: ExtensionAPI, signal?: AbortSignal): Promise<ThemeKind | undefined> {
  switch (detectOS()) {
    case "WSL":
      return detectWindowsAppearance(pi, QUERY_TIMEOUT_MS, true, signal)

    case "Windows_NT":
      return detectWindowsAppearance(pi, QUERY_TIMEOUT_MS, false, signal)

    case "Linux":
      return detectLinuxAppearance(pi, QUERY_TIMEOUT_MS, signal)

    case "Darwin":
      return detectDarwinAppearance(pi, QUERY_TIMEOUT_MS, false, signal)

    case "OrbStack":
      return detectDarwinAppearance(pi, QUERY_TIMEOUT_MS, true, signal)

    case "unsupported":
      return undefined
  }
}
