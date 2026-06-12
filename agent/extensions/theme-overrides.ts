// Override Pi's built-in dark/light appearances without registering new selector themes.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent"

type ColorValue = string | number
type ColorMode = "truecolor" | "256color"
type ThemeKind = "dark" | "light"

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
const APPLY_INTERVAL_MS = 1_000
const APPLY_RETRY_DELAYS_MS = [50, 250, 1_000]

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

function desiredThemeKind(ctx: ExtensionContext): ThemeKind | undefined {
  const configured = readConfiguredTheme()
  if (configured === "dark" || configured === "light") return configured
  if (configured) return undefined

  const current = currentThemeInfo(ctx)
  return current.name === "dark" || current.name === "light" ? current.name : undefined
}

function applyOverride(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return

  const kind = desiredThemeKind(ctx)
  if (!kind) return

  const current = currentThemeInfo(ctx)
  const overrideSources = new Set(Object.values(INLINE_SOURCE_PATHS))

  // If the user is previewing/selecting a non-dark/light theme, do not fight the preview.
  if (
    current.name &&
    current.name !== "dark" &&
    current.name !== "light" &&
    !overrideSources.has(current.sourcePath ?? "")
  ) {
    return
  }

  if (current.sourcePath === INLINE_SOURCE_PATHS[kind]) return

  ctx.ui.setTheme(buildOverrideTheme(ctx, kind, current.mode))
}

export default function (pi: ExtensionAPI) {
  let interval: ReturnType<typeof setInterval> | undefined
  let retryTimers: Array<ReturnType<typeof setTimeout>> = []
  let warned = false

  const safeApply = (ctx: ExtensionContext) => {
    try {
      applyOverride(ctx)
    } catch (error) {
      if (!warned) {
        warned = true
        console.warn("[theme-overrides] failed to apply built-in theme override", error)
      }
    }
  }

  const clearRetryTimers = () => {
    for (const timer of retryTimers) clearTimeout(timer)
    retryTimers = []
  }

  pi.on("session_start", (_event, ctx) => {
    safeApply(ctx)

    clearRetryTimers()
    retryTimers = APPLY_RETRY_DELAYS_MS.map((delay) => setTimeout(() => safeApply(ctx), delay))

    if (interval) clearInterval(interval)
    interval = setInterval(() => safeApply(ctx), APPLY_INTERVAL_MS)
  })

  pi.on("session_shutdown", () => {
    clearRetryTimers()
    if (interval) {
      clearInterval(interval)
      interval = undefined
    }
  })
}
