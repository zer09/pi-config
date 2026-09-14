/**
 * Long-lived Windows appearance watcher for WSL.
 *
 * Repeated short-lived Windows interop commands can leave Windows-side WSL
 * relay workers spinning after their pipes close. This watcher crosses the WSL
 * boundary once, then reads the registry inside one PowerShell process.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import type { Readable } from "node:stream"
import type { ThemeKind } from "./types.ts"

const WINDOWS_POWERSHELL_PATHS = [
  "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  "/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe",
] as const

export interface WindowsAppearanceWatcherOptions {
  readonly signal: AbortSignal
  readonly onAppearance: (appearance: ThemeKind) => void
  readonly onError?: (error: Error) => void
  readonly pollIntervalMs: number
}

export interface WindowsAppearanceProcess {
  readonly stdout: Readable
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: "error", listener: (error: Error) => void): this
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

export type WindowsAppearanceProcessSpawner = (
  command: string,
  args: readonly string[],
) => WindowsAppearanceProcess

/** Build the script run inside the one persistent Windows process. */
export function buildWindowsAppearanceWatcherScript(pollIntervalMs: number): string {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250) {
    throw new Error("Windows appearance poll interval must be an integer of at least 250 ms")
  }

  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$lastTheme = ''",
    "while ($true) {",
    "  $value = [Microsoft.Win32.Registry]::GetValue('HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'AppsUseLightTheme', $null)",
    "  if ($null -ne $value) {",
    "    $theme = if ([int]$value -eq 1) { 'light' } else { 'dark' }",
    "    if ($theme -ne $lastTheme) {",
    "      [Console]::Out.WriteLine($theme)",
    "      [Console]::Out.Flush()",
    "      $lastTheme = $theme",
    "    }",
    "  }",
    `  Start-Sleep -Milliseconds ${pollIntervalMs}`,
    "}",
  ].join("\n")
}

function getWindowsPowerShellCommand(): string {
  return WINDOWS_POWERSHELL_PATHS.find((candidate) => existsSync(candidate)) ?? "powershell.exe"
}

function spawnWindowsAppearanceProcess(command: string, args: readonly string[]): WindowsAppearanceProcess {
  return spawn(command, [...args], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })
}

/**
 * Start one session-scoped watcher and return an idempotent stop function.
 */
export function startWindowsAppearanceWatcher(
  options: WindowsAppearanceWatcherOptions,
  spawnProcess: WindowsAppearanceProcessSpawner = spawnWindowsAppearanceProcess,
): () => void {
  if (options.signal.aborted) return () => undefined

  const script = buildWindowsAppearanceWatcherScript(options.pollIntervalMs)
  const encodedScript = Buffer.from(script, "utf16le").toString("base64")
  let child: WindowsAppearanceProcess

  try {
    child = spawnProcess(getWindowsPowerShellCommand(), [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedScript,
    ])
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error(String(error)))
    return () => undefined
  }

  let stopped = false
  let reportedFailure = false
  let pendingOutput = ""

  const reportFailure = (error: Error): void => {
    if (reportedFailure) return
    reportedFailure = true
    options.onError?.(error)
  }

  const handleOutput = (chunk: Buffer | string): void => {
    if (stopped) return
    pendingOutput += chunk.toString()

    let newlineIndex = pendingOutput.indexOf("\n")
    while (newlineIndex >= 0) {
      const line = pendingOutput.slice(0, newlineIndex).trim().toLowerCase()
      pendingOutput = pendingOutput.slice(newlineIndex + 1)
      if (line === "dark" || line === "light") options.onAppearance(line)
      newlineIndex = pendingOutput.indexOf("\n")
    }

    // The helper emits only one-word records. Bound malformed output defensively.
    if (pendingOutput.length > 256) pendingOutput = pendingOutput.slice(-256)
  }

  const cleanup = (): void => {
    options.signal.removeEventListener("abort", stop)
    child.stdout.off("data", handleOutput)
  }

  const stop = (): void => {
    if (stopped) return
    stopped = true
    cleanup()
    child.kill()
  }

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", handleOutput)
  child.once("error", (error) => {
    if (stopped) return
    stopped = true
    cleanup()
    reportFailure(error)
  })
  child.once("exit", (code, signal) => {
    if (stopped) return
    stopped = true
    cleanup()
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`
    reportFailure(new Error(`Windows appearance watcher stopped unexpectedly (${reason})`))
  })
  options.signal.addEventListener("abort", stop, { once: true })
  if (options.signal.aborted) stop()

  return stop
}
