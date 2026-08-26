import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THINKING_LEVELS } from "./types.ts";
import type { DelegateRole, PiRoute, RoutingOverride, ThinkingLevel } from "./types.ts";

/**
 * Extension-owned versioned routing configuration. `routing.json` next to this
 * module is the single authority for model, provider, and thinking policy.
 * It is deliberately not coupled to `agent/settings.json`, enabled models,
 * `models.json`, or `models-store.json`: a missing or invalid file fails
 * closed with no compiled-route fallback.
 *
 * Version 2 replaced the concrete per-role mapping with family assignments:
 * ordered `solution`/`review` profile arrays derive indexed role ids
 * (`solution-a`..`solution-z`, `review-a`..`review-z`, capped at 26 per
 * family) and the four singleton families carry exactly one profile each.
 * The normalized role registry below is the only role authority for
 * validation, selection, classification, contracts, and tool schemas.
 */

export const ROUTING_CONFIG_VERSION = 2;

/** The six supported semantic role families; role count per family is policy, not code. */
export const ROLE_FAMILIES = [
  "solution",
  "review",
  "implementation",
  "remediation",
  "verification",
  "oracle",
] as const;

export type RoleFamily = (typeof ROLE_FAMILIES)[number];

/** Families whose assignment is an ordered array of profiles deriving lettered role ids. */
export const INDEXED_ROLE_FAMILIES = ["solution", "review"] as const;

/** Families whose assignment is exactly one profile string; they stay singleton. */
export const SINGLETON_ROLE_FAMILIES = ["implementation", "remediation", "verification", "oracle"] as const;

/** Indexed families derive at most `family-a`..`family-z` role ids. */
export const MAX_INDEXED_FAMILY_ROLES = 26;

/**
 * One normalized resolved role from the routing snapshot. `slot` is the
 * zero-based position inside an indexed family assignment; singleton roles
 * carry no slot and use the family name as their id.
 */
export interface ResolvedRole {
  readonly id: string;
  readonly family: RoleFamily;
  readonly profile: string;
  readonly slot?: number;
}

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

/**
 * Validated normalized role registry: derived role id to resolved role, in
 * canonical order (indexed solution slots, indexed review slots, then the
 * four singleton families). Built only by `validateRoutingConfig` and used
 * for every runtime role decision so unknown ids can never fall through.
 */
export type RoleRegistry = ReadonlyMap<string, ResolvedRole>;

export interface RoutingConfig {
  readonly version: number;
  readonly thinkingLevels: readonly ThinkingLevel[];
  readonly disabledProviders: readonly string[];
  readonly models: Readonly<Record<string, ModelCapability>>;
  readonly profiles: Readonly<Record<string, RoutingProfile>>;
  readonly roles: RoleRegistry;
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

const ROLE_LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Validates the version-2 family assignments and derives the normalized role
 * registry. Indexed families are ordered non-empty arrays capped at 26 that
 * may repeat a profile inside and across families; singleton families must be
 * exactly one profile string. Role ids derive from the family and slot, never
 * from prefix parsing at runtime.
 */
function parseAssignments(value: unknown, profiles: Readonly<Record<string, RoutingProfile>>): RoleRegistry {
  if (!isRecord(value)) fail("assignments must be an object");
  exactKeys(value, [...ROLE_FAMILIES], "assignments");
  for (const family of ROLE_FAMILIES) {
    // exactKeys catches extra keys only; every family key must also exist.
    if (value[family] === undefined) fail(`assignments.${family} is required`);
  }
  const roles = new Map<string, ResolvedRole>();
  for (const family of INDEXED_ROLE_FAMILIES) {
    const assignment = value[family];
    if (!Array.isArray(assignment) || assignment.length === 0) {
      fail(`assignments.${family} must be a non-empty ordered array of profile names`);
    }
    if (assignment.length > MAX_INDEXED_FAMILY_ROLES) {
      fail(
        `assignments.${family} lists ${assignment.length} profiles, but indexed families support at most ${MAX_INDEXED_FAMILY_ROLES} roles (${family}-a..${family}-z)`,
      );
    }
    assignment.forEach((profile, slot) => {
      if (!nonBlankString(profile)) {
        fail(`assignments.${family}[${slot}] must be a non-empty, non-whitespace-only profile name`);
      }
      if (profiles[profile] === undefined) {
        fail(`assignments.${family}[${slot}] references unknown profile "${profile}"`);
      }
      const id = `${family}-${ROLE_LETTERS[slot]!}`;
      roles.set(id, { id, family, profile, slot });
    });
  }
  for (const family of SINGLETON_ROLE_FAMILIES) {
    const profile = value[family];
    if (typeof profile !== "string" || !nonBlankString(profile)) {
      fail(`assignments.${family} must be exactly one non-empty, non-whitespace-only profile name string`);
    }
    if (profiles[profile] === undefined) {
      fail(`assignments.${family} references unknown profile "${profile}"`);
    }
    roles.set(family, { id: family, family, profile });
  }
  return roles;
}

/** Strictly validates and normalizes one parsed routing config document. */
export function validateRoutingConfig(value: unknown): RoutingConfig {
  if (!isRecord(value)) fail("document must be a JSON object");
  // The version gate runs before the key check so a version-1 document gets
  // one clear migration error instead of a confusing unknown-key failure.
  if (value.version !== ROUTING_CONFIG_VERSION) {
    if (value.version === 1) {
      fail(
        "version 1 was removed: migrate the concrete v1 roles mapping and oracleSafety.selfReviewModelIds into the version 2 assignments object; the oracle self-review set now derives from the assigned oracle profile",
      );
    }
    fail(`version must be exactly ${ROUTING_CONFIG_VERSION}`);
  }
  exactKeys(value, ["version", "thinkingLevels", "disabledProviders", "models", "profiles", "assignments"], "document");
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

  const roles = parseAssignments(value.assignments, profiles);

  // The oracle invariant must be explicit: a missing policy defaults to
  // "allowed", and an allowed policy would let the oracle role be rerouted.
  const oracleRole = roles.get("oracle")!;
  const oracleProfile = profiles[oracleRole.profile]!;
  if (oracleProfile.overridePolicy !== "rejected") {
    fail(`profiles.${oracleRole.profile}.overridePolicy must be "rejected" for the oracle role`);
  }

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

  return { version: value.version, thinkingLevels, disabledProviders, models, profiles, roles };
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

/**
 * Validates an untrusted runtime override as `unknown` and narrows it to the
 * safe `RoutingOverride` shape. Runs before any field read or exclusion Set
 * construction: Pi tool_call handlers can mutate validated input after
 * schema validation, and direct callers can bypass the tool schema entirely.
 * Every message is fixed and bounded; malformed values are never echoed.
 */
function validateOverrideShape(override: unknown): RoutingOverride {
  if (!isRecord(override)) {
    throw new Error("routingOverride must be an object");
  }
  if (!nonBlankString(override.reason)) {
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
    if (value !== undefined && !nonBlankString(value)) {
      throw new Error(`routingOverride.${field} must be a non-empty string`);
    }
  }
  if (override.excludeProviders !== undefined) {
    if (!Array.isArray(override.excludeProviders) || override.excludeProviders.length === 0) {
      throw new Error("routingOverride.excludeProviders must be a non-empty array");
    }
    for (const provider of override.excludeProviders) {
      if (!nonBlankString(provider)) {
        throw new Error("routingOverride.excludeProviders entries must be non-empty");
      }
    }
  }
  return override as unknown as RoutingOverride;
}

type OverrideSelection =
  | { readonly kind: "tiers"; readonly tiers: readonly RoutingTier[] }
  | { readonly kind: "model-pool"; readonly model: string };

/** Resolves an already-validated override into its selection, enforcing capability and policy checks. */
function overrideSelection(config: RoutingConfig, profile: RoutingProfile, override: RoutingOverride): OverrideSelection {
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

/** Every model reachable through the assigned Oracle profile, for main-model self-review prevention. */
export function oracleModelIds(config: RoutingConfig): ReadonlySet<string> {
  const oracleProfile = config.profiles[requireRole(config, "oracle").profile]!;
  // Every tier counts: a parent running any tier model must skip the
  // oracle instead of reviewing its own work.
  return new Set(oracleProfile.tiers.map((tier) => tier.model));
}

/**
 * Resolves one role id against the normalized registry, or throws a bounded
 * error. Every runtime consumer (route selection, prompts, classification,
 * concurrency, oracle checks) resolves through this, so an unknown role can
 * never fall through to a default or implementation contract.
 */
export function requireRole(config: RoutingConfig, role: string): ResolvedRole {
  const resolved = config.roles.get(role);
  if (resolved === undefined) {
    throw new Error(`unknown delegate role "${role}": roles derive from the routing snapshot assignments`);
  }
  return resolved;
}

/** All derived role ids in canonical registry order. */
export function roleIds(config: RoutingConfig): readonly string[] {
  return [...config.roles.keys()];
}

/** Role ids of one family in canonical slot order; singleton families yield their one id. */
export function roleIdsInFamily(config: RoutingConfig, family: RoleFamily): readonly string[] {
  return [...config.roles.values()].filter((role) => role.family === family).map((role) => role.id);
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
  // Registry-owned role validation: an unknown id fails closed here.
  const resolved = requireRole(config, role);
  // Defense in depth: the oracle role rejects every override by family, so not
  // even a mutated in-memory profile policy can reroute the oracle. This fires
  // before shape validation so every malformed oracle override still gets the
  // oracle-specific rejection.
  if (resolved.family === "oracle" && override !== undefined) {
    throw new Error("routingOverride is not allowed for the oracle role");
  }
  const profile = config.profiles[resolved.profile]!;
  // The override is validated and narrowed once, before the exclusion Set is
  // built: a string excludeProviders must never become character exclusions.
  const validatedOverride = override === undefined ? undefined : validateOverrideShape(override);
  const selection: RouteSelection = {
    random: options.random,
    pinnedProvider: validatedOverride?.provider,
    excluded: new Set(validatedOverride?.excludeProviders ?? []),
  };
  let routes: PiRoute[];
  if (validatedOverride === undefined) {
    routes = profile.tiers.flatMap((tier) => tierRoutes(config, tier, selection));
  } else {
    const selected = overrideSelection(config, profile, validatedOverride);
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

/**
 * Loads one fresh validated snapshot for extension registration. `/reload`
 * and restart re-run the extension factory, so the delegate_run role enum,
 * count-aware guidance, and the model catalog always track the current
 * `routing.json`; the same instance flows into every execution through
 * `RunOptions.routingConfig`, so registration and runtime never drift.
 */
export function loadRoutingSnapshot(): RoutingConfig {
  return readRoutingConfigFile(defaultConfigPath);
}
