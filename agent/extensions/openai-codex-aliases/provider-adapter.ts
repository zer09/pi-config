import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type Provider,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { CodexAlias } from "./config";
import { CANONICAL_OPENAI_CODEX_PROVIDER_ID } from "./provider-id";

const FOREIGN_OPENAI_CODEX_PROVIDER_ID = "openai-codex-foreign";
type CodexApi = "openai-codex-responses";

function mapAssistantProvider(message: AssistantMessage, provider: string): AssistantMessage {
	return { ...message, provider };
}

function mapEventProvider(event: AssistantMessageEvent, provider: string): AssistantMessageEvent {
	if (event.type === "done") {
		return { ...event, message: mapAssistantProvider(event.message, provider) };
	}
	if (event.type === "error") {
		return { ...event, error: mapAssistantProvider(event.error, provider) };
	}
	return { ...event, partial: mapAssistantProvider(event.partial, provider) };
}

function createTerminalError(model: Model<CodexApi>, aborted: boolean): AssistantMessageEvent {
	const stopReason = aborted ? "aborted" : "error";
	return {
		type: "error",
		reason: stopReason,
		error: {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason,
			errorMessage: aborted ? "Request was aborted" : "OpenAI Codex alias stream failed unexpectedly",
			timestamp: Date.now(),
		},
	};
}

function mapModelToCanonical(model: Model<CodexApi>): Model<CodexApi> {
	return { ...model, provider: CANONICAL_OPENAI_CODEX_PROVIDER_ID };
}

function mapContextToCanonical(context: Context, aliasProviderId: string): Context {
	return {
		...context,
		messages: context.messages.map((message) => {
			if (message.role !== "assistant") return message;
			if (message.provider === aliasProviderId) {
				return mapAssistantProvider(message, CANONICAL_OPENAI_CODEX_PROVIDER_ID);
			}
			if (message.provider === CANONICAL_OPENAI_CODEX_PROVIDER_ID) {
				return mapAssistantProvider(message, FOREIGN_OPENAI_CODEX_PROVIDER_ID);
			}
			return message;
		}),
	};
}

function adaptStream(
	aliasModel: Model<CodexApi>,
	startSourceStream: () => AssistantMessageEventStream,
	isAborted: () => boolean,
): AssistantMessageEventStream {
	const outward = createAssistantMessageEventStream();

	void (async () => {
		let ended = false;
		const end = () => {
			if (ended) return;
			ended = true;
			outward.end();
		};

		try {
			const sourceStream = startSourceStream();
			for await (const event of sourceStream) {
				outward.push(mapEventProvider(event, aliasModel.provider));
				if (event.type === "done" || event.type === "error") {
					end();
					return;
				}
			}
			throw new Error("OpenAI Codex source stream ended without a terminal event");
		} catch {
			outward.push(createTerminalError(aliasModel, isAborted()));
			end();
		}
	})();

	return outward;
}

export function createOpenAICodexSourceProvider(): Provider<CodexApi> {
	const sourceProvider = builtinProviders().find(
		(provider) => provider.id === CANONICAL_OPENAI_CODEX_PROVIDER_ID,
	);
	if (!sourceProvider) {
		throw new Error("Pi's built-in OpenAI Codex provider is unavailable");
	}
	return sourceProvider as Provider<CodexApi>;
}

export function createOpenAICodexAliasProvider(
	alias: CodexAlias,
	sourceProvider: Provider<CodexApi> = createOpenAICodexSourceProvider(),
): Provider<CodexApi> {
	if (typeof sourceProvider.stream !== "function" || typeof sourceProvider.streamSimple !== "function") {
		throw new Error("OpenAI Codex source provider does not provide the required stream methods");
	}
	if (!sourceProvider.auth.oauth) {
		throw new Error("OpenAI Codex source provider does not provide OAuth authentication");
	}

	const models = sourceProvider.getModels().map((model) => ({ ...model, provider: alias.id }));
	const oauth = sourceProvider.auth.oauth;
	const auth = {
		...(sourceProvider.auth.apiKey ? { apiKey: { ...sourceProvider.auth.apiKey } } : {}),
		oauth: {
			...oauth,
			name: `${alias.name} (ChatGPT Plus/Pro)`,
		},
	};

	return {
		id: alias.id,
		name: alias.name,
		baseUrl: sourceProvider.baseUrl,
		headers: sourceProvider.headers ? { ...sourceProvider.headers } : undefined,
		auth,
		getModels: () => models,
		stream(model, context, options) {
			const canonicalModel = mapModelToCanonical(model);
			const canonicalContext = mapContextToCanonical(context, alias.id);
			return adaptStream(
				model,
				() => sourceProvider.stream(canonicalModel, canonicalContext, options),
				() => options?.signal?.aborted === true,
			);
		},
		streamSimple(model, context, options) {
			const canonicalModel = mapModelToCanonical(model);
			const canonicalContext = mapContextToCanonical(context, alias.id);
			return adaptStream(
				model,
				() => sourceProvider.streamSimple(canonicalModel, canonicalContext, options),
				() => options?.signal?.aborted === true,
			);
		},
	};
}
