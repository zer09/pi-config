import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DELEGATE_ROLES, THINKING_LEVELS } from "./types.ts";
import type { DelegateRole, PiRoute, RoutingOverride, ThinkingLevel } from "./types.ts";

/**
 * Extension-owned versioned routing configuration. `routing.json` next to this
 * module is the single authority for model, provider, and thinking policy.
 * It is deliberately not coupled to `agent/settings.json`, enabled models,
 * `models.json`, or `models-store.json`: a missing or invalid file fails
 * closed with no compiled-route fallback.
 */

export const ROUTING_CONFIG_VERSION = 1;

export interface ProviderCapability {
  readonly thinking: readonly ThinkingLevel[];
  readonly default: ThinkingLevel;
}

export interface ModelCapability {
  readonly providers: Readonly<Record<string, ProviderCapability>>;
}

export interface RoutingTier {
  readonly model: string;
  readonly thinking: ThinkingLevel;
  readonly providers?: readonly string[];
}

export type OverridePolicy = "allowed" | "rejected";

export interface RoutingProfile {
  readonly overridePolicy: OverridePolicy;
  readonly tiers: readonly RoutingTier[];
}

export interface OracleSafety {
  /** Every model reachable through the Oracle profile's tiers; a parent running any member skips the oracle. */
  readonly selfReviewModelIds: readonly string[];
}

export interface RoutingConfig {
  readonly version: number;
  readonly thinkingLevels: readonly ThinkingLevel[];
  readonly disabledProviders: readonly string[];
  readonly models: Readonly<Record<string, ModelCapability>>;
  readonly profiles: Readonly<Record<string, RoutingProfile>>;
  readonly roles: Readonly<Record<DelegateRole, { readonly profile: string }>>;
  readonly oracleSafety: OracleSafety;
}

export interface RouteSelectionOptions {
  /** Injected randomness so tests pin random primaries without flakiness. */
  readonly random?: () => number;
}

const OVERRIDE_POLICIES: readonly OverridePolicy[] = ["allowed", "rejected"];

function fail(message: string): never {
  throw new Error(`delegated-pi-loop routing config invalid: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Identifier check: rejects empty and whitespace-only strings. Accepted
 * values are never normalized, so identifiers keep their exact configured
 * form in derived routes.
 */
function nonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueStrings(
  value: unknown,
  label: string,
  { allowEmpty = false, identifiers = false }: { allowEmpty?: boolean; identifiers?: boolean } = {},
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (!nonEmptyString(entry) || (identifiers && !nonBlankString(entry))) {
      fail(`${label} entries must be non-empty${identifiers ? ", non-whitespace-only" : ""} strings`);
    }
    if (seen.has(entry)) fail(`${label} contains duplicate entry "${entry}"`);
    seen.add(entry);
  }
  return [...seen];
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${label} has unknown key "${key}"`);
  }
}

function parseThinkingLevels(value: unknown): ThinkingLevel[] {
  const levels = uniqueStrings(value, "thinkingLevels");
  for (const level of levels) {
    if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
      fail(`thinking level "${level}" is not a known Pi thinking level`);
    }
  }
  return levels as ThinkingLevel[];
}

function parseProviderCapability(value: unknown, model: string, provider: string, scale: readonly string[]): ProviderCapability {
  if (!isRecord(value)) fail(`models.${model}.providers.${provider} must be an object`);
  exactKeys(value, ["thinking", "default"], `models.${model}.providers.${provider}`);
  const thinking = uniqueStrings(value.thinking, `models.${model}.providers.${provider}.thinking`);
  for (const level of thinking) {
    if (!scale.includes(level)) fail(`models.${model}.providers.${provider} lists unknown thinking level "${level}"`);
  }
  if (!nonEmptyString(value.default) || !thinking.includes(value.default)) {
    fail(`models.${model}.providers.${provider}.default must be one of its supported thinking levels`);
  }
  return { thinking: thinking as ThinkingLevel[], default: value.default as ThinkingLevel };
}

function parseTier(value: unknown, profile: string, index: number, config: {
  scale: readonly string[];
  models: Readonly<Record<string, ModelCapability>>;
}): RoutingTier {
  const label = `profiles.${profile}.tiers[${index}]`;
  if (!isRecord(value)) fail(`${label} must be an object`);
  exactKeys(value, ["model", "thinking", "providers"], label);
  if (!nonBlankString(value.model)) fail(`${label}.model must not be empty or whitespace-only`);
  const capability = config.models[value.model];
  if (capability === undefined) fail(`${label}.model "${value.model}" has no capability record`);
  if (!nonEmptyString(value.thinking) || !config.scale.includes(value.thinking)) {
    fail(`${label}.thinking must be a configured thinking level`);
  }
  const thinking = value.thinking as ThinkingLevel;
  let providers: string[] | undefined;
  if (value.providers !== undefined) {
    providers = uniqueStrings(value.providers, `${label}.providers`, { identifiers: true });
    for (const provider of providers) {
      const providerCapability = capability.providers[provider];
      if (providerCapability === undefined) {
        fail(`${label} allowlists provider "${provider}" without a capability record for model "${value.model}"`);
      }
      if (!providerCapability.thinking.includes(thinking)) {
        fail(`${label} allowlists provider "${provider}" which does not support "${value.model}" at thinking "${thinking}"`);
      }
    }
  }
  return providers === undefined ? { model: value.model, thinking } : { model: value.model, thinking, providers };
}

function parseProfile(value: unknown, name: string, config: {
  scale: readonly string[];
  models: Readonly<Record<string, ModelCapability>>;
}): RoutingProfile {
  if (!isRecord(value)) fail(`profiles.${name} must be an object`);
  exactKeys(value, ["overridePolicy", "tiers"], `profiles.${name}`);
  let overridePolicy: OverridePolicy = "allowed";
  if (value.overridePolicy !== undefined) {
    if (!OVERRIDE_POLICIES.includes(value.overridePolicy as OverridePolicy)) {
      fail(`profiles.${name}.overridePolicy must be one of ${OVERRIDE_POLICIES.join(", ")}`);
    }
    overridePolicy = value.overridePolicy as OverridePolicy;
  }
  if (!Array.isArray(value.tiers) || value.tiers.length === 0) fail(`profiles.${name}.tiers must be a non-empty array`);
  const tiers = value.tiers.map((tier, index) => parseTier(tier, name, index, config));
  return { overridePolicy, tiers };
}

/** Strictly validates and normalizes one parsed routing config document. */
export function validateRoutingConfig(value: unknown): RoutingConfig {
  if (!isRecord(value)) fail("document must be a JSON object");
  exactKeys(value, ["version", "thinkingLevels", "disabledProviders", "models", "profiles", "roles", "oracleSafety"], "document");
  if (value.version !== ROUTING_CONFIG_VERSION) fail(`version must be exactly ${ROUTING_CONFIG_VERSION}`);
  const thinkingLevels = parseThinkingLevels(value.thinkingLevels);
  const scale = [...thinkingLevels];
  const disabledProviders = value.disabledProviders === undefined
    ? []
    : uniqueStrings(value.disabledProviders, "disabledProviders", { allowEmpty: true, identifiers: true });

  if (!isRecord(value.models) || Object.keys(value.models).length === 0) fail("models must be a non-empty object");
  const models: Record<string, ModelCapability> = {};
  for (const [model, modelValue] of Object.entries(value.models)) {
    // An empty or whitespace-only identifier key would otherwise seed
    // capability-derived routes with a blank model or provider name.
    if (!nonBlankString(model)) fail("models keys must not be empty or whitespace-only");
    if (!isRecord(modelValue)) fail(`models.${model} must be an object`);
    exactKeys(modelValue, ["providers"], `models.${model}`);
    if (!isRecord(modelValue.providers) || Object.keys(modelValue.providers).length === 0) {
      fail(`models.${model}.providers must be a non-empty object`);
    }
    const providers: Record<string, ProviderCapability> = {};
    for (const [provider, providerValue] of Object.entries(modelValue.providers)) {
      if (!nonBlankString(provider)) fail(`models.${model}.providers keys must not be empty or whitespace-only`);
      providers[provider] = parseProviderCapability(providerValue, model, provider, scale);
    }
    models[model] = { providers };
  }

  if (!isRecord(value.profiles) || Object.keys(value.profiles).length === 0) fail("profiles must be a non-empty object");
  const profiles: Record<string, RoutingProfile> = {};
  for (const [name, profileValue] of Object.entries(value.profiles)) {
    if (!nonBlankString(name)) fail("profiles keys must not be empty or whitespace-only");
    profiles[name] = parseProfile(profileValue, name, { scale, models });
  }

  if (!isRecord(value.roles)) fail("roles must be an object");
  const roleNames = Object.keys(value.roles).sort();
  const expectedRoles = [...DELEGATE_ROLES].sort();
  if (roleNames.length !== expectedRoles.length || roleNames.some((role, index) => role !== expectedRoles[index])) {
    fail("roles must map exactly every delegate role and no extra role");
  }
  const roles = {} as Record<DelegateRole, { readonly profile: string }>;
  for (const role of DELEGATE_ROLES) {
    const roleValue = value.roles[role];
    if (!isRecord(roleValue)) fail(`roles.${role} must be an object`);
    exactKeys(roleValue, ["profile"], `roles.${role}`);
    if (!nonBlankString(roleValue.profile)) fail(`roles.${role}.profile must not be empty or whitespace-only`);
    if (profiles[roleValue.profile] === undefined) {
      fail(`roles.${role}.profile "${String(roleValue.profile)}" is not a configured profile`);
    }
    roles[role] = { profile: roleValue.profile };
  }

  if (!isRecord(value.oracleSafety)) fail("oracleSafety must be an object");
  exactKeys(value.oracleSafety, ["selfReviewModelIds"], "oracleSafety");
  const selfReviewModelIds = uniqueStrings(
    value.oracleSafety.selfReviewModelIds,
    "oracleSafety.selfReviewModelIds",
    { identifiers: true },
  );
  const oracleProfile = profiles[roles.oracle.profile]!;
  // The oracle invariant must be explicit: a missing policy defaults to
  // "allowed", and an allowed policy would let the oracle role be rerouted.
  if (oracleProfile.overridePolicy !== "rejected") {
    fail(`profiles.${roles.oracle.profile}.overridePolicy must be "rejected" for the oracle role`);
  }
  // The self-review set must cover every model reachable through the
  // configured Oracle profile, not only the first tier: a parent running
  // any tier model must skip the oracle instead of reviewing its own work.
  const oracleTierModels = [...new Set(oracleProfile.tiers.map((tier) => tier.model))].sort();
  const declaredModels = [...selfReviewModelIds].sort();
  if (
    oracleTierModels.length !== declaredModels.length
    || oracleTierModels.some((model, index) => model !== declaredModels[index])
  ) {
    fail(
      `oracleSafety.selfReviewModelIds must be exactly every model in the oracle profile's tiers: ${
        oracleTierModels.map((model) => `"${model}"`).join(", ")
      }`,
    );
  }

  const oracleSafety: OracleSafety = { selfReviewModelIds };

  // A disabled provider must never silently empty a configured tier: disabling
  // a provider that a tier depends on requires updating that tier explicitly.
  for (const [name, profile] of Object.entries(profiles)) {
    profile.tiers.forEach((tier, index) => {
      const eligible = eligibleProviders({ disabledProviders, models }, tier);
      if (eligible.length === 0) {
        fail(`profiles.${name}.tiers[${index}] has no eligible provider after disabledProviders`);
      }
    });
  }

  return { version: value.version, thinkingLevels, disabledProviders, models, profiles, roles, oracleSafety };
}

function eligibleProviders(
  config: Pick<RoutingConfig, "disabledProviders" | "models">,
  tier: RoutingTier,
  pinnedProvider?: string,
  excluded?: ReadonlySet<string>,
): string[] {
  const capability = config.models[tier.model]!.providers;
  return Object.keys(capability).filter((provider) => {
    if (!capability[provider]!.thinking.includes(tier.thinking)) return false;
    if (tier.providers !== undefined && !tier.providers.includes(provider)) return false;
    if (config.disabledProviders.includes(provider)) return false;
    if (excluded?.has(provider)) return false;
    if (pinnedProvider !== undefined && provider !== pinnedProvider) return false;
    return true;
  });
}

function randomPrimary(eligible: readonly string[], random?: () => number): string {
  // Clamp keeps a misbehaving random source inside the eligible set.
  const value = random?.() ?? Math.random();
  const index = Math.max(0, Math.min(eligible.length - 1, Math.floor(value * eligible.length)));
  return eligible[index]!;
}

interface RouteSelection {
  readonly random?: () => number;
  readonly pinnedProvider?: string;
  readonly excluded: ReadonlySet<string>;
}

interface ProviderEntry {
  readonly provider: string;
  readonly thinking: ThinkingLevel;
}

function poolRoutes(model: string, entries: readonly ProviderEntry[], selection: RouteSelection): PiRoute[] {
  if (entries.length === 0) return [];
  const providers = entries.map((entry) => entry.provider);
  // One random primary spreads load across providers; single-provider
  // pools stay deterministic without consuming a draw.
  const primary = providers.length === 1 ? providers[0]! : randomPrimary(providers, selection.random);
  const thinkingOf = new Map(entries.map((entry) => [entry.provider, entry.thinking] as const));
  return [
    primary,
    ...providers.filter((provider) => provider !== primary),
  ].map((provider) => ({ kind: "pi" as const, provider, model, thinking: thinkingOf.get(provider)! }));
}

function tierRoutes(config: RoutingConfig, tier: RoutingTier, selection: RouteSelection): PiRoute[] {
  const eligible = eligibleProviders(config, tier, selection.pinnedProvider, selection.excluded);
  return poolRoutes(
    tier.model,
    eligible.map((provider) => ({ provider, thinking: tier.thinking })),
    selection,
  );
}

function modelPoolRoutes(config: RoutingConfig, model: string, selection: RouteSelection): PiRoute[] {
  // A model-only override treats every capable provider as one logical
  // pool: disabled and excluded providers drop out first, then the shared
  // single/random primary selection orders one chain in which each
  // provider runs at its own configured default thinking level.
  const capability = config.models[model]!.providers;
  const entries = Object.keys(capability)
    .filter((provider) => !config.disabledProviders.includes(provider) && !selection.excluded.has(provider))
    .map((provider) => ({ provider, thinking: capability[provider]!.default }));
  return poolRoutes(model, entries, selection);
}

function validateOverrideShape(override: RoutingOverride): void {
  if (override.reason.trim().length === 0) {
    throw new Error("routingOverride requires a non-empty reason");
  }
  const operative = override.provider !== undefined
    || override.model !== undefined
    || override.thinking !== undefined
    || override.excludeProviders !== undefined;
  if (!operative) {
    throw new Error("routingOverride is a no-op: set provider, model, thinking, or excludeProviders");
  }
  if (override.thinking !== undefined && override.model === undefined) {
    throw new Error("routingOverride.thinking requires routingOverride.model");
  }
  for (const field of ["provider", "model", "thinking"] as const) {
    const value = override[field];
    if (value !== undefined && value.trim().length === 0) {
      throw new Error(`routingOverride.${field} must be a non-empty string`);
    }
  }
  if (override.excludeProviders !== undefined) {
    if (override.excludeProviders.length === 0) {
      throw new Error("routingOverride.excludeProviders must be a non-empty array");
    }
    for (const provider of override.excludeProviders) {
      if (provider.trim().length === 0) throw new Error("routingOverride.excludeProviders entries must be non-empty");
    }
  }
}

type OverrideSelection =
  | { readonly kind: "tiers"; readonly tiers: readonly RoutingTier[] }
  | { readonly kind: "model-pool"; readonly model: string };

/** Resolves an override into its selection, enforcing capability and policy checks. */
function overrideSelection(config: RoutingConfig, profile: RoutingProfile, override: RoutingOverride): OverrideSelection {
  validateOverrideShape(override);
  if (profile.overridePolicy === "rejected") {
    throw new Error("routingOverride is not allowed for this role's routing profile");
  }

  if (override.model !== undefined) {
    const capability = config.models[override.model];
    if (capability === undefined) {
      throw new Error(`routingOverride.model "${override.model}" has no capability record`);
    }
    if (override.provider !== undefined) {
      // Provider plus model is exact after capability validation.
      const providerCapability = capability.providers[override.provider];
      if (providerCapability === undefined) {
        throw new Error(`provider "${override.provider}" has no capability record for model "${override.model}"`);
      }
      const thinking = (override.thinking ?? providerCapability.default) as ThinkingLevel;
      if (!providerCapability.thinking.includes(thinking)) {
        throw new Error(`provider "${override.provider}" does not support model "${override.model}" at thinking "${thinking}"`);
      }
      return { kind: "tiers", tiers: [{ model: override.model, thinking, providers: [override.provider] }] };
    }
    if (override.thinking !== undefined) {
      if (!(config.thinkingLevels as readonly string[]).includes(override.thinking)) {
        throw new Error(`routingOverride.thinking "${override.thinking}" is not a configured thinking level`);
      }
      return { kind: "tiers", tiers: [{ model: override.model, thinking: override.thinking as ThinkingLevel }] };
    }
    // Model-only keeps the common provider selection: every capable provider
    // forms one logical pool ordered by the shared selector, each at its own
    // configured default thinking.
    return { kind: "model-pool", model: override.model };
  }

  // Provider-only pins and filters the configured tiers.
  return { kind: "tiers", tiers: profile.tiers };
}

/** Every model reachable through the configured Oracle profile, for main-model self-review prevention. */
export function oracleModelIds(config: RoutingConfig): ReadonlySet<string> {
  return new Set(config.oracleSafety.selfReviewModelIds);
}

/**
 * One shared selector for every role: per tier, derive eligible providers from
 * capabilities, intersect allowlists, disabled providers, and override
 * exclusions, draw one random primary for a multi-provider tier
 * (single-provider tiers stay deterministic and consume no draw), then
 * append the remaining providers in stable config order and concatenate
 * the tiers.
 */
export function selectRoutes(
  config: RoutingConfig,
  role: DelegateRole,
  override?: RoutingOverride,
  options: RouteSelectionOptions = {},
): readonly PiRoute[] {
  // Defense in depth: the oracle role rejects every override by role, so not
  // even a mutated in-memory profile policy can reroute the oracle.
  if (role === "oracle" && override !== undefined) {
    throw new Error("routingOverride is not allowed for the oracle role");
  }
  const profile = config.profiles[config.roles[role].profile]!;
  const selection: RouteSelection = {
    random: options.random,
    pinnedProvider: override?.provider,
    excluded: new Set(override?.excludeProviders ?? []),
  };
  let routes: PiRoute[];
  if (override === undefined) {
    routes = profile.tiers.flatMap((tier) => tierRoutes(config, tier, selection));
  } else {
    const selected = overrideSelection(config, profile, override);
    routes = selected.kind === "model-pool"
      ? modelPoolRoutes(config, selected.model, selection)
      : selected.tiers.flatMap((tier) => tierRoutes(config, tier, selection));
  }
  if (routes.length === 0) {
    throw new Error("routing produced no eligible route for this role and override");
  }
  // Route invariant: no selected route may ever carry a whitespace-only
  // provider or model id, even if a mutated in-memory config smuggles one
  // past validation.
  for (const route of routes) {
    if (route.provider.trim().length === 0 || route.model.trim().length === 0) {
      throw new Error("routing produced a route with a whitespace-only provider or model id");
    }
  }
  return routes;
}

/** Reads and strictly validates a routing config file. Never falls back. */
export function readRoutingConfigFile(filePath: string): RoutingConfig {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`delegated-pi-loop routing config invalid: cannot read ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`delegated-pi-loop routing config invalid: ${filePath} is not valid JSON`);
  }
  return validateRoutingConfig(parsed);
}

const defaultConfigPath = fileURLToPath(new URL("./routing.json", import.meta.url));
let cachedConfig: RoutingConfig | undefined;

/**
 * Loads the extension-owned routing config once per process. Fails closed on
 * a missing or invalid file; there is no compiled-route fallback.
 */
export function loadRoutingConfig(): RoutingConfig {
  if (cachedConfig === undefined) cachedConfig = readRoutingConfigFile(defaultConfigPath);
  return cachedConfig;
}
