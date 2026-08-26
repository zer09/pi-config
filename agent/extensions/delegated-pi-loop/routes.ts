import type { ResolvedRole, RoleFamily } from "./routing.ts";

export function routeKey(route: { readonly provider: string; readonly model: string; readonly thinking: string }): string {
  return `${route.provider}/${route.model}:${route.thinking}`;
}

const READ_ONLY_FAMILIES: ReadonlySet<RoleFamily> = new Set(["solution", "review", "verification", "oracle"]);

/** Classification is family-owned from the normalized registry, never prefix inference. */
export function roleIsReadOnly(role: ResolvedRole): boolean {
  return READ_ONLY_FAMILIES.has(role.family);
}

export function roleIsExclusive(role: ResolvedRole): boolean {
  // Verification is not exclusive: DelegateManager gives it its own bounded
  // rule (verification-only overlap, capped concurrency) instead.
  return role.family === "implementation" || role.family === "remediation" || role.family === "oracle";
}

export function roleLabel(role: ResolvedRole): string {
  return role.id;
}

/**
 * Pre-spawn oracle guard, enforced before any artifact or child process:
 * main-model skip detection is model-id based against every model
 * reachable through the configured Oracle profile (all tiers), so the exact
 * model on any parent provider skips the oracle instead of reviewing
 * itself. Returning undefined means the run may proceed; the thrown message
 * stays bounded and model-visible so no fabricated oracle report is
 * produced.
 */
export function oracleGuard(
  role: ResolvedRole,
  parentModelId: string | undefined,
  configuredOracleModelIds: ReadonlySet<string>,
): Error | undefined {
  if (role.family !== "oracle") return undefined;
  if (parentModelId !== undefined && configuredOracleModelIds.has(parentModelId)) {
    return new Error(
      `Skip the oracle role: the parent session already runs ${parentModelId}; finalize the solution contract directly`,
    );
  }
  return undefined;
}
