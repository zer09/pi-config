/**
 * Theme token classification for override palette validation and construction.
 *
 * Pi stores foreground and background theme colors separately. This module owns
 * the required token list and the foreground/background split used by the theme
 * builder.
 */

import type { ThemeBackgroundToken, ThemeToken } from "./types.ts"

/**
 * Tokens that must be passed to Pi's Theme constructor as background colors.
 */
export const BG_TOKENS: ReadonlySet<string> = new Set([
  "selectedBg",
  "userMessageBg",
  "customMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
])

/**
 * All required color tokens for a complete Pi theme palette.
 */
export const REQUIRED_TOKENS: readonly ThemeToken[] = [
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

/**
 * Determine whether a required theme token belongs in the background palette.
 *
 * @param token - Required theme token from an override palette.
 * @returns True when the token is a Pi background token.
 */
export function isBackgroundToken(token: ThemeToken): token is ThemeBackgroundToken {
  return BG_TOKENS.has(token)
}
