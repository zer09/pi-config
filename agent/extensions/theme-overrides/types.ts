/**
 * Shared type definitions for the theme-overrides extension.
 */

/** The Pi theme names this extension auto-switches between. */
export type ThemeKind = "dark" | "light"

/** Operating-system categories used for appearance detection. */
export type DetectedOS = "Linux" | "Darwin" | "Windows_NT" | "WSL" | "OrbStack" | "unsupported"

/** Snapshot of the currently active Pi theme relevant to override decisions. */
export interface CurrentThemeInfo {
  /** Theme name reported by Pi, if available. */
  readonly name?: string
  /** Source file path reported by Pi, if available. */
  readonly sourcePath?: string
}

/** Captured output from a system command executed through Pi. */
export interface CommandOutput {
  /** Standard output captured by Pi. */
  readonly stdout: string
  /** Standard error captured by Pi. */
  readonly stderr: string
  /** Process exit code reported by Pi. */
  readonly code: number
}

/** Options controlling command execution for appearance probes. */
export interface CommandOutputOptions {
  /** When true, non-zero exit codes still return captured output. */
  readonly allowNonZero?: boolean
  /** Optional timeout in milliseconds passed to Pi's exec helper. */
  readonly timeout?: number
}
