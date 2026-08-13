import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OPENAI_CODEX_ALIAS_PREFIX } from "./provider-id";

export type CodexAlias = {
	readonly slug: string;
	readonly id: string;
	readonly name: string;
};

const ALIAS_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_ALIAS_SLUG_LENGTH = 32;
const CONFIG_URL = new URL("./aliases.json", import.meta.url);

function configError(filePath: string, message: string): Error {
	return new Error(`Invalid OpenAI Codex alias configuration at ${filePath}: ${message}`);
}

export function validateOpenAICodexAliasConfig(document: unknown, filePath: string): readonly CodexAlias[] {
	if (typeof document !== "object" || document === null || Array.isArray(document)) {
		throw configError(filePath, "the document must be an object");
	}

	const documentKeys = Object.keys(document);
	if (documentKeys.length !== 1 || documentKeys[0] !== "aliases") {
		throw configError(filePath, 'the document must contain only an "aliases" field');
	}

	const aliases = (document as { aliases?: unknown }).aliases;
	if (!Array.isArray(aliases)) {
		throw configError(filePath, '"aliases" must be an array');
	}

	const slugs = new Set<string>();
	const providerIds = new Set<string>();
	const normalized = aliases.map((value, index): CodexAlias => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw configError(filePath, `aliases[${index}] must be an object`);
		}

		const keys = Object.keys(value).sort();
		if (keys.length !== 2 || keys[0] !== "name" || keys[1] !== "slug") {
			throw configError(filePath, `aliases[${index}] must contain only non-empty "slug" and "name" fields`);
		}

		const { slug, name } = value as { slug?: unknown; name?: unknown };
		if (typeof slug !== "string" || slug.length === 0) {
			throw configError(filePath, `aliases[${index}].slug must be a non-empty string`);
		}
		if (slug.length > MAX_ALIAS_SLUG_LENGTH || !ALIAS_SLUG_PATTERN.test(slug)) {
			throw configError(
				filePath,
				`aliases[${index}].slug must match ${ALIAS_SLUG_PATTERN.source} and contain at most ${MAX_ALIAS_SLUG_LENGTH} characters`,
			);
		}
		if (typeof name !== "string" || name.trim().length === 0) {
			throw configError(filePath, `aliases[${index}].name must be a non-empty string`);
		}
		if (slugs.has(slug)) {
			throw configError(filePath, `aliases[${index}].slug duplicates "${slug}"`);
		}

		const id = `${OPENAI_CODEX_ALIAS_PREFIX}${slug}`;
		if (providerIds.has(id)) {
			throw configError(filePath, `aliases[${index}] derives duplicate provider ID "${id}"`);
		}

		slugs.add(slug);
		providerIds.add(id);
		return Object.freeze({ slug, id, name: name.trim() });
	});

	return Object.freeze(normalized);
}

export function loadOpenAICodexAliases(configUrl: URL = CONFIG_URL): readonly CodexAlias[] {
	const filePath = fileURLToPath(configUrl);
	let raw: string;
	try {
		raw = readFileSync(configUrl, "utf8");
	} catch {
		throw new Error(`Failed to read OpenAI Codex alias configuration at ${filePath}`);
	}

	let document: unknown;
	try {
		document = JSON.parse(raw);
	} catch {
		throw new Error(`Failed to parse OpenAI Codex alias configuration at ${filePath}: invalid JSON`);
	}

	return validateOpenAICodexAliasConfig(document, filePath);
}
