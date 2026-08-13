export const CANONICAL_OPENAI_CODEX_PROVIDER_ID = "openai-codex";
export const OPENAI_CODEX_ALIAS_PREFIX = `${CANONICAL_OPENAI_CODEX_PROVIDER_ID}-`;

const OPENAI_CODEX_ALIAS_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_OPENAI_CODEX_ALIAS_SLUG_LENGTH = 32;

export function getOpenAICodexAliasSlug(providerId: string): string | undefined {
	if (!providerId.startsWith(OPENAI_CODEX_ALIAS_PREFIX)) return undefined;

	const slug = providerId.slice(OPENAI_CODEX_ALIAS_PREFIX.length);
	if (slug.length > MAX_OPENAI_CODEX_ALIAS_SLUG_LENGTH) return undefined;
	return OPENAI_CODEX_ALIAS_SLUG_PATTERN.test(slug) ? slug : undefined;
}

export function isOpenAICodexProviderId(providerId: string): boolean {
	return providerId === CANONICAL_OPENAI_CODEX_PROVIDER_ID || getOpenAICodexAliasSlug(providerId) !== undefined;
}
