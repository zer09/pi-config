import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	FASTLANE_STATE_EVENT,
	FAST_SERVICE_TIER,
	OPENAI_CODEX_API_ID,
	OPENAI_CODEX_PROVIDER_ID,
	SUPPORTED_OPENAI_CODEX_MODELS,
} from "./constants";
import { loadConfig } from "./config";
import type { Eligibility, FastlaneStateEvent, PayloadRecord, SessionState } from "./types";

function isPayloadRecord(payload: unknown): payload is PayloadRecord {
	return typeof payload === "object" && payload !== null && !Array.isArray(payload);
}

function modelKey(ctx: ExtensionContext): string {
	const model = ctx.model;
	return model ? `${model.provider}/${model.id}` : "no-model";
}

function isFastlaneEnabled(state: SessionState): boolean {
	if (state.override === "on") return true;
	if (state.override === "off") return false;
	return state.config.enabled;
}

function describeMode(state: SessionState): string {
	if (state.override === "on") return "on (session override)";
	if (state.override === "off") return "off (session override)";
	return state.config.enabled ? "on (config default)" : "off (config default)";
}

function getEligibility(ctx: ExtensionContext): Eligibility {
	const model = ctx.model;
	if (!model) {
		return { eligible: false, modelKey: "no-model", reason: "no model is selected" };
	}

	const key = `${model.provider}/${model.id}`;
	if (model.provider !== OPENAI_CODEX_PROVIDER_ID) {
		return {
			eligible: false,
			modelKey: key,
			reason: `current provider is ${model.provider}, not ${OPENAI_CODEX_PROVIDER_ID}`,
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
			reason: "Fastlane initially supports only gpt-5.4 and gpt-5.5",
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

function createStateEvent(ctx: ExtensionContext, state: SessionState): FastlaneStateEvent {
	const enabled = isFastlaneEnabled(state);
	const eligibility = getEligibility(ctx);
	return {
		active: enabled && eligibility.eligible,
		eligible: eligibility.eligible,
		mode: describeMode(state),
		modelKey: eligibility.modelKey,
		reason: eligibility.reason,
		thinkingGlyphCount: state.config.thinkingGlyphCount,
		lastInjectedAt: state.lastInjectedAt,
		lastInjectedModel: state.lastInjectedModel,
	};
}

function publishState(pi: ExtensionAPI, ctx: ExtensionContext, state: SessionState): void {
	pi.events.emit(FASTLANE_STATE_EVENT, createStateEvent(ctx, state));
}

function getStatusMessage(ctx: ExtensionContext, state: SessionState): string {
	const event = createStateEvent(ctx, state);
	const injected = state.lastInjectedAt
		? ` Last injected for ${state.lastInjectedModel ?? "unknown model"} ${Math.max(0, Math.round((Date.now() - state.lastInjectedAt) / 1000))}s ago.`
		: "";

	if (event.active) {
		return `Fastlane is ${event.mode} and active for ${event.modelKey}; requests will use service_tier=${FAST_SERVICE_TIER}; thinking glyphs=${event.thinkingGlyphCount}.${injected}`;
	}

	if (isFastlaneEnabled(state)) {
		return `Fastlane is ${event.mode}, but inactive for ${event.modelKey}: ${event.reason}.${injected}`;
	}

	return `Fastlane is ${event.mode}. Current model: ${event.modelKey}.${injected}`;
}

function injectFastServiceTier(
	payload: unknown,
	ctx: ExtensionContext,
	state: SessionState,
): PayloadRecord | undefined {
	if (!isFastlaneEnabled(state)) return undefined;
	if (!getEligibility(ctx).eligible) return undefined;
	if (!isPayloadRecord(payload)) return undefined;
	if (payload.model !== ctx.model?.id) return undefined;
	if ("service_tier" in payload) return undefined;

	state.lastInjectedAt = Date.now();
	state.lastInjectedModel = modelKey(ctx);
	return {
		...payload,
		service_tier: FAST_SERVICE_TIER,
	};
}

export default function fastlaneExtension(pi: ExtensionAPI): void {
	const states = new WeakMap<object, SessionState>();

	function getState(ctx: ExtensionContext): SessionState {
		let state = states.get(ctx.sessionManager);
		if (!state) {
			state = {
				config: loadConfig(),
				override: "auto",
			};
			states.set(ctx.sessionManager, state);
		}
		return state;
	}

	pi.on("session_start", (_event, ctx) => {
		const state: SessionState = {
			config: loadConfig(),
			override: "auto",
		};
		states.set(ctx.sessionManager, state);
		publishState(pi, ctx, state);
	});

	pi.on("model_select", (_event, ctx) => {
		publishState(pi, ctx, getState(ctx));
	});

	pi.on("before_provider_request", (event, ctx) => {
		const state = getState(ctx);
		const nextPayload = injectFastServiceTier(event.payload, ctx, state);
		publishState(pi, ctx, state);
		return nextPayload;
	});

	pi.registerCommand("fastlane", {
		description: "Toggle Fastlane priority service tier for eligible models",
		getArgumentCompletions: () => null,
		handler: async (args, ctx) => {
			const state = getState(ctx);
			const action = args.trim().toLowerCase();

			if (!action) {
				state.override = isFastlaneEnabled(state) ? "off" : "on";
				publishState(pi, ctx, state);
				ctx.ui.notify(getStatusMessage(ctx, state), "info");
				return;
			}

			if (action === "status") {
				publishState(pi, ctx, state);
				ctx.ui.notify(getStatusMessage(ctx, state), "info");
				return;
			}

			ctx.ui.notify("Usage: /fastlane [status]", "warning");
		},
	});
}
