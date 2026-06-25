/**
 * Shared type definitions for the theme-overrides extension.
 *
 * This module contains the structural contracts used by configuration loading,
 * palette validation, system appearance detection, and Pi theme construction.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent"

/**
 * A color value accepted by Pi themes.
 *
 * Strings may be hex colors, variable names, or the empty string for the
 * terminal default color. Numbers represent xterm 256-color palette indexes.
 */
export type ColorValue = string | number

/**
 * Terminal color mode supported by Pi's Theme implementation.
 */
export type ColorMode = "truecolor" | "256color"

/**
 * The built-in Pi theme names this extension overrides.
 */
export type ThemeKind = "dark" | "light"

/**
 * Operating-system categories used for appearance detection.
 */
export type DetectedOS = "Linux" | "Darwin" | "Windows_NT" | "WSL" | "OrbStack" | "unsupported"

/**
 * Pi theme tokens that are rendered as background colors.
 */
export type ThemeBackgroundToken =
  | "selectedBg"
  | "userMessageBg"
  | "customMessageBg"
  | "toolPendingBg"
  | "toolSuccessBg"
  | "toolErrorBg"

/**
 * Any required token accepted in an override palette.
 */
export type ThemeToken = ThemeColor | ThemeBackgroundToken

/**
 * JSON shape of a theme palette consumed by this extension.
 */
export interface ThemeJson {
  /** Display name from the theme file. */
  readonly name: string
  /** Optional reusable variable map referenced by values in {@link colors}. */
  readonly vars?: Readonly<Record<string, ColorValue>>
  /** Required foreground/background color tokens. */
  readonly colors: Readonly<Record<string, ColorValue>>
  /** Optional HTML export colors passed through by Pi theme JSON files. */
  readonly export?: {
    readonly pageBg?: ColorValue
    readonly cardBg?: ColorValue
    readonly infoBg?: ColorValue
  }
}

/**
 * User-editable configuration loaded from config.default.json and optional user config.
 */
export interface ThemeOverridesConfig {
  /** Whether automatic theme overriding is enabled. */
  readonly enabled?: boolean
  /** Theme used when system appearance detection fails. */
  readonly fallbackTheme?: ThemeKind
  /** Polling cadence for re-checking system appearance. */
  readonly pollIntervalMs?: number
  /** Timeout for each system appearance query. */
  readonly queryTimeoutMs?: number
  /** Optional palette paths keyed by built-in theme kind. */
  readonly themes?: Partial<Record<ThemeKind, string>>
}

/**
 * Normalized configuration used internally after defaults are applied.
 */
export interface ResolvedConfig {
  /** Whether automatic theme overriding is enabled. */
  readonly enabled: boolean
  /** Theme used when system appearance detection fails. */
  readonly fallbackTheme: ThemeKind
  /** Polling cadence for re-checking system appearance. */
  readonly pollIntervalMs: number
  /** Timeout for each system appearance query. */
  readonly queryTimeoutMs: number
  /** Absolute palette paths keyed by built-in theme kind. */
  readonly themes: Readonly<Record<ThemeKind, string>>
}

/**
 * Constructor signature for Pi's runtime Theme class.
 *
 * The extension intentionally obtains this constructor from the active Pi UI
 * theme so the created instance satisfies Pi's internal instanceof checks.
 */
export type ThemeConstructor = new (
  fgColors: Record<ThemeColor, ColorValue>,
  bgColors: Record<string, ColorValue>,
  mode: ColorMode,
  options?: { name?: string; sourcePath?: string },
) => Theme

/**
 * Snapshot of the currently active Pi theme relevant to override decisions.
 */
export interface CurrentThemeInfo {
  /** Theme name reported by Pi, if available. */
  readonly name?: string
  /** Source file path reported by Pi, if available. */
  readonly sourcePath?: string
  /** Current terminal color mode. */
  readonly mode: ColorMode
}

/**
 * Captured output from a system command executed through Pi.
 */
export interface CommandOutput {
  /** Standard output captured by Pi. */
  readonly stdout: string
  /** Standard error captured by Pi. */
  readonly stderr: string
  /** Process exit code reported by Pi. */
  readonly code: number
}

/**
 * Options controlling command execution for appearance probes.
 */
export interface CommandOutputOptions {
  /** When true, non-zero exit codes still return captured output. */
  readonly allowNonZero?: boolean
  /** Optional timeout in milliseconds passed to Pi's exec helper. */
  readonly timeout?: number
}
