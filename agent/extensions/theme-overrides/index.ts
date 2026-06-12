// Override Pi's built-in dark/light appearances without registering new selector themes.

import { existsSync, readFileSync } from "node:fs"
import { platform, release } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent"

type ColorValue = string | number
type ColorMode = "truecolor" | "256color"
type ThemeKind = "dark" | "light"
type DetectedOS = "Linux" | "Darwin" | "Windows_NT" | "WSL" | "OrbStack" | "unsupported"

type ThemeJson = {
  name: string
  vars?: Record<string, ColorValue>
  colors: Record<string, ColorValue>
  export?: {
    pageBg?: ColorValue
    cardBg?: ColorValue
    infoBg?: ColorValue
  }
}

type ThemeOverridesConfig = {
  enabled?: boolean
  fallbackTheme?: ThemeKind
  pollIntervalMs?: number
  queryTimeoutMs?: number
  themes?: Partial<Record<ThemeKind, string>>
}

type ResolvedConfig = {
  enabled: boolean
  fallbackTheme: ThemeKind
  pollIntervalMs: number
  queryTimeoutMs: number
  themes: Record<ThemeKind, string>
}

type ThemeConstructor = new (
  fgColors: Record<ThemeColor, ColorValue>,
  bgColors: Record<string, ColorValue>,
  mode: ColorMode,
  options?: { name?: string; sourcePath?: string },
) => Theme

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(EXTENSION_DIR, "config.json")
const SETTINGS_PATH = join(getAgentDir(), "settings.json")

const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  fallbackTheme: "dark",
  pollIntervalMs: 3_000,
  queryTimeoutMs: 1_500,
  themes: {
    dark: "./themes/dark.json",
    light: "./themes/light.json",
  },
}

const APPLY_RETRY_DELAYS_MS = [50, 250, 1_000]

const BG_TOKENS = new Set([
  "selectedBg",
  "userMessageBg",
  "customMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
])

const REQUIRED_TOKENS = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "bashMode",
]

function isThemeKind(value: unknown): value is ThemeKind {
  return value === "dark" || value === "light"
}

function resolveExtensionPath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : join(EXTENSION_DIR, pathValue)
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function loadConfig(): ResolvedConfig {
  let userConfig: ThemeOverridesConfig = {}

  if (existsSync(CONFIG_PATH)) {
    userConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ThemeOverridesConfig
  }

  const fallbackTheme = isThemeKind(userConfig.fallbackTheme) ? userConfig.fallbackTheme : DEFAULT_CONFIG.fallbackTheme

  return {
    enabled: typeof userConfig.enabled === "boolean" ? userConfig.enabled : DEFAULT_CONFIG.enabled,
    fallbackTheme,
    pollIntervalMs: normalizePositiveInteger(userConfig.pollIntervalMs, DEFAULT_CONFIG.pollIntervalMs),
    queryTimeoutMs: normalizePositiveInteger(userConfig.queryTimeoutMs, DEFAULT_CONFIG.queryTimeoutMs),
    themes: {
      dark: resolveExtensionPath(userConfig.themes?.dark ?? DEFAULT_CONFIG.themes.dark),
      light: resolveExtensionPath(userConfig.themes?.light ?? DEFAULT_CONFIG.themes.light),
    },
  }
}

function isValidColorValue(value: unknown): value is ColorValue {
  return typeof value === "string" || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255)
}

function resolveVar(value: ColorValue, vars: Record<string, ColorValue>, seen = new Set<string>()): ColorValue {
  if (typeof value === "number" || value === "" || value.startsWith("#")) return value
  if (seen.has(value)) throw new Error(`Circular theme variable reference: ${value}`)
  const next = vars[value]
  if (!isValidColorValue(next)) throw new Error(`Missing theme variable: ${value}`)
  seen.add(value)
  return resolveVar(next, vars, seen)
}

function loadPalette(kind: ThemeKind, config: ResolvedConfig): ThemeJson {
  const themePath = config.themes[kind]
  const palette = JSON.parse(readFileSync(themePath, "utf8")) as ThemeJson

  if (!palette || typeof palette !== "object" || !palette.colors || typeof palette.colors !== "object") {
    throw new Error(`Invalid ${kind} theme file: ${themePath}`)
  }

  const missing = REQUIRED_TOKENS.filter((token) => !isValidColorValue(palette.colors[token]))
  if (missing.length > 0) {
    throw new Error(`Invalid ${kind} theme file ${themePath}; missing colors: ${missing.join(", ")}`)
  }

  return palette
}

function buildOverrideTheme(ctx: ExtensionContext, kind: ThemeKind, mode: ColorMode, config: ResolvedConfig): Theme {
  const palette = loadPalette(kind, config)
  const vars = palette.vars ?? {}
  const fgColors: Partial<Record<ThemeColor, ColorValue>> = {}
  const bgColors: Record<string, ColorValue> = {}

  for (const token of REQUIRED_TOKENS) {
    const resolved = resolveVar(palette.colors[token], vars)
    if (BG_TOKENS.has(token)) {
      bgColors[token] = resolved
    } else {
      fgColors[token as ThemeColor] = resolved
    }
  }

  // Use Pi's own Theme constructor instance so ctx.ui.setTheme(theme) passes
  // the internal instanceof Theme check even if extension loading uses another module loader.
  const baseTheme = ctx.ui.getTheme(kind) ?? ctx.ui.theme
  const ThemeCtor = baseTheme.constructor as ThemeConstructor

  return new ThemeCtor(
    fgColors as Record<ThemeColor, ColorValue>,
    bgColors as Record<string, ColorValue>,
    mode,
    { name: kind, sourcePath: config.themes[kind] },
  )
}

function readConfiguredTheme(): string | undefined {
  try {
    const json = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as { theme?: unknown }
    return typeof json.theme === "string" ? json.theme : undefined
  } catch {
    return undefined
  }
}

function currentThemeInfo(ctx: ExtensionContext): {
  name?: string
  sourcePath?: string
  mode: ColorMode
} {
  try {
    const mode = ctx.ui.theme.getColorMode() as ColorMode
    return {
      name: ctx.ui.theme.name,
      sourcePath: ctx.ui.theme.sourcePath,
      mode: mode === "256color" ? "256color" : "truecolor",
    }
  } catch {
    return { mode: "truecolor" }
  }
}

function isThemeOverrideAllowed(ctx: ExtensionContext, config: ResolvedConfig): boolean {
  const configured = readConfiguredTheme()
  if (configured && configured !== "dark" && configured !== "light") return false

  const current = currentThemeInfo(ctx)
  const overrideSources = new Set(Object.values(config.themes))

  // If the user is previewing/selecting a non-dark/light theme, do not fight the preview.
  if (
    current.name &&
    current.name !== "dark" &&
    current.name !== "light" &&
    !overrideSources.has(current.sourcePath ?? "")
  ) {
    return false
  }

  return true
}

function detectOS(): DetectedOS {
  const osPlatform = platform()
  const osRelease = release()

  if (/microsoft|wsl/i.test(osRelease)) return "WSL"
  if (/orbstack/i.test(osRelease)) return "OrbStack"
  if (osPlatform === "darwin") return "Darwin"
  if (osPlatform === "win32") return "Windows_NT"
  if (osPlatform === "linux") return "Linux"
  return "unsupported"
}

async function execOutput(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  options: { allowNonZero?: boolean; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number } | undefined> {
  try {
    const result = await pi.exec(command, args, { timeout: options.timeout })
    if (result.killed) return undefined
    if (!options.allowNonZero && result.code !== 0) return undefined
    return { stdout: result.stdout, stderr: result.stderr, code: result.code }
  } catch {
    return undefined
  }
}

function getWindowsRegCommand(): string {
  const candidates = [
    "/mnt/c/Windows/System32/reg.exe",
    "/mnt/c/WINDOWS/system32/reg.exe",
    "/mnt/c/Windows/system32/reg.exe",
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? "reg.exe"
}

async function detectWindowsAppearance(pi: ExtensionAPI, queryTimeoutMs: number): Promise<ThemeKind | undefined> {
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

async function detectLinuxAppearance(pi: ExtensionAPI, queryTimeoutMs: number): Promise<ThemeKind | undefined> {
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

async function detectDarwinAppearance(
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

async function detectSystemAppearance(pi: ExtensionAPI, config: ResolvedConfig): Promise<ThemeKind> {
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

async function applyOverride(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const config = loadConfig()

  if (!config.enabled || ctx.mode !== "tui") return
  if (!isThemeOverrideAllowed(ctx, config)) return

  const kind = await detectSystemAppearance(pi, config)
  if (!isThemeOverrideAllowed(ctx, config)) return

  const current = currentThemeInfo(ctx)
  if (current.sourcePath === config.themes[kind]) return

  ctx.ui.setTheme(buildOverrideTheme(ctx, kind, current.mode, config))
}

function readPollIntervalMs(): number {
  try {
    return loadConfig().pollIntervalMs
  } catch {
    return DEFAULT_CONFIG.pollIntervalMs
  }
}

export default function (pi: ExtensionAPI) {
  let interval: ReturnType<typeof setInterval> | undefined
  let retryTimers: Array<ReturnType<typeof setTimeout>> = []
  let warned = false
  let applying = false
  let generation = 0

  const safeApply = async (ctx: ExtensionContext, activeGeneration: number) => {
    if (applying || activeGeneration !== generation) return

    applying = true
    try {
      await applyOverride(pi, ctx)
    } catch (error) {
      if (!warned) {
        warned = true
        console.warn("[theme-overrides] failed to apply built-in theme override", error)
      }
    } finally {
      applying = false
    }
  }

  const clearRetryTimers = () => {
    for (const timer of retryTimers) clearTimeout(timer)
    retryTimers = []
  }

  pi.on("session_start", (_event, ctx) => {
    generation += 1
    const activeGeneration = generation
    const pollIntervalMs = readPollIntervalMs()

    void safeApply(ctx, activeGeneration)

    clearRetryTimers()
    retryTimers = APPLY_RETRY_DELAYS_MS.map((delay) => setTimeout(() => void safeApply(ctx, activeGeneration), delay))

    if (interval) clearInterval(interval)
    interval = setInterval(() => void safeApply(ctx, activeGeneration), pollIntervalMs)
  })

  pi.on("session_shutdown", () => {
    generation += 1
    clearRetryTimers()
    if (interval) {
      clearInterval(interval)
      interval = undefined
    }
  })
}
