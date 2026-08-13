import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadOpenAICodexAliases, type CodexAlias } from "./config";
import { createOpenAICodexAliasProvider, createOpenAICodexSourceProvider } from "./provider-adapter";

type CodexProvider = Provider<"openai-codex-responses">;
type ProviderRegistrar = Pick<ExtensionAPI, "registerProvider">;

export function registerOpenAICodexAliases(
	pi: ProviderRegistrar,
	aliases: readonly CodexAlias[],
	sourceProvider: CodexProvider = createOpenAICodexSourceProvider(),
): readonly CodexProvider[] {
	const providers = aliases.map((alias) => createOpenAICodexAliasProvider(alias, sourceProvider));
	for (const provider of providers) pi.registerProvider(provider);
	return providers;
}

export default function openAICodexAliasesExtension(pi: ExtensionAPI): void {
	const aliases = loadOpenAICodexAliases();
	registerOpenAICodexAliases(pi, aliases);
}
