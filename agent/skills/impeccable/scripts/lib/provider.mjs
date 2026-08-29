// Locally adapted for Pi command routing; see docs/skills/impeccable-update-process.md.
// Source scripts default to slash commands. The provider build replaces only
// this exact declaration, avoiding heuristic rewrites across executable code.
export const IMPECCABLE_COMMAND_PREFIX = "/skill:";
export const IMPECCABLE_PROVIDER_ID = "pi";
export const IMPECCABLE_COMMAND = `${IMPECCABLE_COMMAND_PREFIX}impeccable`;
