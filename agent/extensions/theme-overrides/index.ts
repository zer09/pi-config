// Override Pi's built-in dark/light appearances without registering new selector themes.

import { existsSync, readFileSync } from "node:fs"
import { platform, release } from "node:os"
import { join } from "node:path"
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

type ThemeConstructor = new (
  fgColors: Record<ThemeColor, ColorValue>,
  bgColors: Record<string, ColorValue>,
  mode: ColorMode,
  options?: { name?: string; sourcePath?: string },
) => Theme

const SETTINGS_PATH = join(getAgentDir(), "settings.json")
const FALLBACK_THEME: ThemeKind = "dark"
const APPLY_INTERVAL_MS = 3_000
const APPLY_RETRY_DELAYS_MS = [50, 250, 1_000]
const QUERY_TIMEOUT_MS = 1_500

const INLINE_SOURCE_PATHS: Record<ThemeKind, string> = {
  dark: "inline:theme-overrides/dark",
  light: "inline:theme-overrides/light",
}

const PALETTES: Record<ThemeKind, ThemeJson> = {
  dark: {
    name: "dark",
    vars: {
      cyan: "#00d7ff",
      blue: "#5f87ff",
      green: "#b5bd68",
      red: "#cc6666",
      yellow: "#ffff00",
      text: "#d4d4d4",
      gray: "#808080",
      dimGray: "#666666",
      darkGray: "#505050",
      accent: "#8abeb7",
      selectedBg: "#3a3a4a",
      userMsgBg: "#343541",
      toolPendingBg: "#282832",
      toolSuccessBg: "#283228",
      toolErrorBg: "#3c2828",
      customMsgBg: "#2d2838",
    },
    colors: {
      accent: "accent",
      border: "blue",
      borderAccent: "cyan",
      borderMuted: "darkGray",
      success: "green",
      error: "red",
      warning: "yellow",
      muted: "gray",
      dim: "dimGray",
      text: "text",
      thinkingText: "gray",

      selectedBg: "selectedBg",
      userMessageBg: "userMsgBg",
      userMessageText: "text",
      customMessageBg: "customMsgBg",
      customMessageText: "text",
      customMessageLabel: "#9575cd",
      toolPendingBg: "toolPendingBg",
      toolSuccessBg: "toolSuccessBg",
      toolErrorBg: "toolErrorBg",
      toolTitle: "text",
      toolOutput: "gray",

      mdHeading: "#f0c674",
      mdLink: "#81a2be",
      mdLinkUrl: "dimGray",
      mdCode: "accent",
      mdCodeBlock: "green",
      mdCodeBlockBorder: "gray",
      mdQuote: "gray",
      mdQuoteBorder: "gray",
      mdHr: "gray",
      mdListBullet: "accent",

      toolDiffAdded: "green",
      toolDiffRemoved: "red",
      toolDiffContext: "gray",

      syntaxComment: "#6A9955",
      syntaxKeyword: "#569CD6",
      syntaxFunction: "#DCDCAA",
      syntaxVariable: "#9CDCFE",
      syntaxString: "#CE9178",
      syntaxNumber: "#B5CEA8",
      syntaxType: "#4EC9B0",
      syntaxOperator: "#D4D4D4",
      syntaxPunctuation: "#D4D4D4",

      thinkingOff: "#6c7086",
      thinkingMinimal: "#7f849c",
      thinkingLow: "#89b4fa",
      thinkingMedium: "#f9e2af",
      thinkingHigh: "#cba6f7",
      thinkingXhigh: "#f38ba8",

      bashMode: "green",
    },
    export: {
      pageBg: "#18181e",
      cardBg: "#1e1e24",
      infoBg: "#3c3728",
    },
  },
  light: {
    name: "light",
    vars: {
      teal: "#5a8080",
      blue: "#547da7",
      green: "#588458",
      red: "#aa5555",
      yellow: "#9a7326",
      text: "#1f2328",
      mediumGray: "#6c6c6c",
      dimGray: "#767676",
      lightGray: "#b0b0b0",
      selectedBg: "#d0d0e0",
      userMsgBg: "#e8e8e8",
      toolPendingBg: "#e8e8f0",
      toolSuccessBg: "#e8f0e8",
      toolErrorBg: "#f0e8e8",
      customMsgBg: "#ede7f6",
    },
    colors: {
      accent: "teal",
      border: "blue",
      borderAccent: "teal",
      borderMuted: "lightGray",
      success: "green",
      error: "red",
      warning: "yellow",
      muted: "mediumGray",
      dim: "dimGray",
      text: "text",
      thinkingText: "mediumGray",

      selectedBg: "selectedBg",
      userMessageBg: "userMsgBg",
      userMessageText: "text",
      customMessageBg: "customMsgBg",
      customMessageText: "text",
      customMessageLabel: "#7e57c2",
      toolPendingBg: "toolPendingBg",
      toolSuccessBg: "toolSuccessBg",
      toolErrorBg: "toolErrorBg",
      toolTitle: "text",
      toolOutput: "mediumGray",

      mdHeading: "yellow",
      mdLink: "blue",
      mdLinkUrl: "dimGray",
      mdCode: "teal",
      mdCodeBlock: "green",
      mdCodeBlockBorder: "mediumGray",
      mdQuote: "mediumGray",
      mdQuoteBorder: "mediumGray",
      mdHr: "mediumGray",
      mdListBullet: "green",

      toolDiffAdded: "green",
      toolDiffRemoved: "red",
      toolDiffContext: "mediumGray",

      syntaxComment: "#008000",
      syntaxKeyword: "#0000FF",
      syntaxFunction: "#795E26",
      syntaxVariable: "#001080",
      syntaxString: "#A31515",
      syntaxNumber: "#098658",
      syntaxType: "#267F99",
      syntaxOperator: "#000000",
      syntaxPunctuation: "#000000",

      thinkingOff: "#9ca0b0",
      thinkingMinimal: "#8c8fa1",
      thinkingLow: "#1e66f5",
      thinkingMedium: "#df8e1d",
      thinkingHigh: "#8839ef",
      thinkingXhigh: "#d20f39",

      bashMode: "green",
    },
    export: {
      pageBg: "#f8f8f8",
      cardBg: "#ffffff",
      infoBg: "#fffae6",
    },
  },
}

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

function getPalette(kind: ThemeKind): ThemeJson {
  const palette = PALETTES[kind]
  const missing = REQUIRED_TOKENS.filter((token) => !isValidColorValue(palette.colors[token]))
  if (missing.length > 0) {
    throw new Error(`Invalid ${kind} palette; missing colors: ${missing.join(", ")}`)
  }
  return palette
}

function buildOverrideTheme(ctx: ExtensionContext, kind: ThemeKind, mode: ColorMode): Theme {
  const palette = getPalette(kind)
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
    { name: kind, sourcePath: INLINE_SOURCE_PATHS[kind] },
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

function isThemeOverrideAllowed(ctx: ExtensionContext): boolean {
  const configured = readConfiguredTheme()
  if (configured && configured !== "dark" && configured !== "light") return false

  const current = currentThemeInfo(ctx)
  const overrideSources = new Set(Object.values(INLINE_SOURCE_PATHS))

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
    const result = await pi.exec(command, args, { timeout: options.timeout ?? QUERY_TIMEOUT_MS })
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

async function detectWindowsAppearance(pi: ExtensionAPI): Promise<ThemeKind | undefined> {
  const result = await execOutput(
    pi,
    getWindowsRegCommand(),
    ["Query", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
  )
  if (!result) return undefined

  const output = `${result.stdout}\n${result.stderr}`
  if (!/AppsUseLightTheme/i.test(output)) return undefined
  return /0x1\b/i.test(output) ? "light" : "dark"
}

async function detectLinuxAppearance(pi: ExtensionAPI): Promise<ThemeKind | undefined> {
  const result = await execOutput(pi, "dbus-send", [
    "--session",
    "--print-reply=literal",
    "--reply-timeout=1000",
    "--dest=org.freedesktop.portal.Desktop",
    "/org/freedesktop/portal/desktop",
    "org.freedesktop.portal.Settings.Read",
    "string:org.freedesktop.appearance",
    "string:color-scheme",
  ])
  if (!result || result.stderr.trim() !== "") return undefined

  // xdg-desktop-portal color-scheme: 0 = no preference, 1 = dark, 2 = light.
  if (/uint32\s+1\b/.test(result.stdout)) return "dark"
  if (/uint32\s+[02]\b/.test(result.stdout)) return "light"
  return undefined
}

async function detectDarwinAppearance(pi: ExtensionAPI, viaOrbStack = false): Promise<ThemeKind | undefined> {
  const command = viaOrbStack ? "mac" : "defaults"
  const args = viaOrbStack ? ["defaults", "read", "-g", "AppleInterfaceStyle"] : ["read", "-g", "AppleInterfaceStyle"]
  const result = await execOutput(pi, command, args, { allowNonZero: true })
  if (!result) return undefined

  return result.stdout.trim() === "Dark" ? "dark" : "light"
}

async function detectSystemAppearance(pi: ExtensionAPI): Promise<ThemeKind> {
  const detectedOS = detectOS()
  const detected =
    detectedOS === "WSL" || detectedOS === "Windows_NT"
      ? await detectWindowsAppearance(pi)
      : detectedOS === "Linux"
        ? await detectLinuxAppearance(pi)
        : detectedOS === "Darwin"
          ? await detectDarwinAppearance(pi)
          : detectedOS === "OrbStack"
            ? await detectDarwinAppearance(pi, true)
            : undefined

  return detected ?? FALLBACK_THEME
}

async function applyOverride(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") return
  if (!isThemeOverrideAllowed(ctx)) return

  const kind = await detectSystemAppearance(pi)
  if (!isThemeOverrideAllowed(ctx)) return

  const current = currentThemeInfo(ctx)
  if (current.sourcePath === INLINE_SOURCE_PATHS[kind]) return

  ctx.ui.setTheme(buildOverrideTheme(ctx, kind, current.mode))
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

    void safeApply(ctx, activeGeneration)

    clearRetryTimers()
    retryTimers = APPLY_RETRY_DELAYS_MS.map((delay) => setTimeout(() => void safeApply(ctx, activeGeneration), delay))

    if (interval) clearInterval(interval)
    interval = setInterval(() => void safeApply(ctx, activeGeneration), APPLY_INTERVAL_MS)
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
