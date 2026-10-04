/**
 * Fastlane Pi extension.
 *
 * This extension toggles Codex Fast mode for eligible OAuth-backed Codex models
 * by injecting `service_tier: "priority"` and publishing a minimal active-state
 * event consumed by the footer.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isOpenAICodexProviderId } from "../openai-codex-aliases/provider-id";
import {
	FASTLANE_RPC_STATUS_KEY,
	FASTLANE_STATE_EVENT,
	FAST_SERVICE_TIER,
	OPENAI_CODEX_API_ID,
	SUPPORTED_OPENAI_CODEX_MODELS,
} from "./constants";
import type { Eligibility, PayloadRecord, SessionState } from "./types";

function isPayloadRecord(payload: unknown): payload is PayloadRecord {
	return typeof payload === "object" && payload !== null && !Array.isArray(payload);
}

function getEligibility(ctx: ExtensionContext): Eligibility {
	const model = ctx.model;
	if (!model) {
		return { eligible: false, modelKey: "no-model", reason: "no model is selected" };
	}

	const key = `${model.provider}/${model.id}`;
	if (!isOpenAICodexProviderId(model.provider)) {
		return {
			eligible: false,
			modelKey: key,
			reason: `current provider is ${model.provider}, not a valid OpenAI Codex provider`,
		};
	}

	if (model.api !== OPENAI_CODEX_API_ID) {
		return {
			eligible: false,
			modelKey: key,
			reason: `current API is ${model.api}, not ${OPENAI_CODEX_API_ID}`,
		};
	}

	if (!SUPPORTED_OPENAI_CODEX_MODELS.has(model.id)) {
		return {
			eligible: false,
			modelKey: key,
			reason: "model does not advertise the priority/Fast service tier in the official Codex catalog",
		};
	}

	if (!ctx.modelRegistry.isUsingOAuth(model)) {
		return {
			eligible: false,
			modelKey: key,
			reason: "ChatGPT OAuth auth is required; API-key auth is intentionally not used",
		};
	}

	return { eligible: true, modelKey: key };
}

function refreshEnablement(ctx: ExtensionContext, state: SessionState): void {
	if (state.startupRequested && !state.manualOverride) {
		// Keep CLI intent across route and auth changes until the user toggles it.
		state.enabled = getEligibility(ctx).eligible;
	} else if (state.enabled && !getEligibility(ctx).eligible) {
		state.enabled = false;
	}
}

function publishState(pi: ExtensionAPI, state: SessionState, ctx: ExtensionContext): void {
	pi.events.emit(FASTLANE_STATE_EVENT, { active: state.enabled });
	if (state.startupRequested && ctx.mode === "rpc") {
		ctx.ui.setStatus(FASTLANE_RPC_STATUS_KEY, state.enabled ? "enabled" : "inactive");
	}
}

function injectFastServiceTier(
	payload: unknown,
	ctx: ExtensionContext,
	state: SessionState,
): PayloadRecord | undefined {
	refreshEnablement(ctx, state);
	if (!state.enabled) return undefined;
	if (!isPayloadRecord(payload)) return undefined;
	if (payload.model !== ctx.model?.id) return undefined;
	if ("service_tier" in payload) return undefined;

	return {
		...payload,
		service_tier: FAST_SERVICE_TIER,
	};
}

export default function fastlaneExtension(pi: ExtensionAPI): void {
	const states = new WeakMap<object, SessionState>();

	pi.registerFlag("fastlane", {
		description: "Start with Fastlane priority service tier for eligible models",
		type: "boolean",
		default: false,
	});

	function getState(ctx: ExtensionContext): SessionState {
		let state = states.get(ctx.sessionManager);
		if (!state) {
			state = { enabled: false, startupRequested: false, manualOverride: false };
			states.set(ctx.sessionManager, state);
		}
		return state;
	}

	pi.on("session_start", (_event, ctx) => {
		const state: SessionState = {
			enabled: false,
			startupRequested: pi.getFlag("fastlane") === true,
			manualOverride: false,
		};
		states.set(ctx.sessionManager, state);
		refreshEnablement(ctx, state);
		publishState(pi, state, ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		const state = getState(ctx);
		refreshEnablement(ctx, state);
		publishState(pi, state, ctx);
	});

	pi.on("before_provider_request", (event, ctx) => {
		const state = getState(ctx);
		const nextPayload = injectFastServiceTier(event.payload, ctx, state);
		publishState(pi, state, ctx);
		return nextPayload;
	});

	pi.registerCommand("fastlane", {
		description: "Toggle Fastlane priority service tier for eligible models",
		getArgumentCompletions: () => null,
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action) {
				ctx.ui.notify("Usage: /fastlane", "warning");
				return;
			}

			const state = getState(ctx);
			// An explicit toggle takes control from the sticky startup request.
			state.manualOverride = true;
			const eligibility = getEligibility(ctx);
			if (state.enabled && eligibility.eligible) {
				state.enabled = false;
				publishState(pi, state, ctx);
				ctx.ui.notify("Fastlane disabled.", "info");
				return;
			}

			if (!eligibility.eligible) {
				state.enabled = false;
				publishState(pi, state, ctx);
				ctx.ui.notify(
					`Fastlane cannot be enabled for ${eligibility.modelKey}: ${eligibility.reason ?? "model is not eligible"}.`,
					"warning",
				);
				return;
			}

			state.enabled = true;
			publishState(pi, state, ctx);
			ctx.ui.notify("Fastlane enabled.", "info");
		},
	});
}
