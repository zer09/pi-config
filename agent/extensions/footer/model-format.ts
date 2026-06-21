/**
 * Provider-aware model-name formatting for footer.
 *
 * The footer removes dated model suffixes and applies compact provider-specific
 * labels. Full footer layouts still use compact model labels.
 */

import type { FooterProfile } from "./types";

/**
 * Format a model identifier for the active footer profile.
 *
 * @param provider - Current provider id from Pi.
 * @param id - Current model id from Pi.
 * @param profile - Desired display density, capped at compact.
 * @returns A full or compact model label, or `no-model` when no model is selected.
 */
export function formatModelName(
	provider: string | undefined,
	id: string | undefined,
	profile: FooterProfile = "full",
): string {
	if (!id) return "no-model";
	const base = id.includes("/") ? (id.split("/").pop() ?? id) : id;
	const model = base.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
	return formatCompactModelName(provider, model, profile === "minimal" ? "minimal" : "compact");
}

function formatCompactModelName(
	provider: string | undefined,
	model: string,
	profile: Exclude<FooterProfile, "full">,
): string {
	if (provider === "openai-codex" && model.startsWith("gpt-")) {
		return profile === "minimal" ? model : `codex/${model}`;
	}

	if (provider === "anthropic") {
		if (model.startsWith("claude-sonnet-")) return model.replace(/^claude-/, "");
		if (model.startsWith("claude-opus-")) return model.replace(/^claude-/, "");
	}

	if ((provider === "google" || provider === "google-gemini") && model.startsWith("gemini-") && model.includes("flash")) {
		return model.replace(/^gemini-/, "").replace(/^(\d+(?:\.\d+)?(?:-[a-z]+)?)-flash/, "flash-$1");
	}

	if (profile === "minimal") return model;

	if (provider === "minimax" || provider === "opencode-go") return model;
	return provider ? `${provider}/${model}` : model;
}
