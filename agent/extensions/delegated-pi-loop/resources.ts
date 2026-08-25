import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContainmentRoots,
  DelegateResourceSelection,
  ResolvedDelegateResources,
} from "./types.ts";

// Re-exported so policy fixtures can build containment roots; the type is
// owned by `types.ts` next to the resolved-resource contract.
export type { ContainmentRoots };

/**
 * Extension-owned versioned delegated child resource policy. `resources.json`
 * next to this module is the single authority for which extensions and skills
 * delegated Pi children may load. It is deliberately strict: every delegated
 * child starts with discovery disabled (`--no-extensions`, `--no-skills`,
 * `--no-prompt-templates`, `--no-themes`) and receives only the explicit
 * entry files and skill paths listed here. A missing or invalid policy fails
 * closed before `delegate_run` is registered; there is no broad-discovery
 * fallback and no compiled broad-resource default.
 *
 * The parent session keeps its normal extension and skill discovery. Only
 * delegated subprocesses receive this lean profile.
 */

export const RESOURCE_POLICY_VERSION = 1;

/**
 * Extension directories that contribute model-visible child tools. The
 * catalog preflight profile must not load any of them.
 */
const MODEL_TOOL_EXTENSION_DIRS: readonly string[] = ["web-search", "context-mode", "codegraph"];

/** Extension directory that registers the routed `openai-codex-*` alias providers. */
const ALIAS_EXTENSION_DIR = "openai-codex-aliases";

/** Base discovery-disable flags shared by the catalog and runtime profiles. */
const BASE_ISOLATION_FLAGS: readonly string[] = [
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
];

/**
 * The canonical delegated child profiles: the exact entry files each policy
 * list must resolve to, in the exact order children must load them. The
 * catalog profile carries only the alias providers; the runtime profile is
 * the fixed five-entry lean child. Entries are policy-relative (resolved
 * against the policy directory like a listed entry); display names are
 * extensions-root-relative identities for bounded failure messages.
 */
const CATALOG_PROFILE: readonly { readonly entry: string; readonly display: string }[] = [
  { entry: `../${ALIAS_EXTENSION_DIR}/index.ts`, display: `${ALIAS_EXTENSION_DIR}/index.ts` },
];

const RUNTIME_PROFILE: readonly { readonly entry: string; readonly display: string }[] = [
  { entry: "./index.ts", display: "delegated-pi-loop/index.ts" },
  { entry: `../${ALIAS_EXTENSION_DIR}/index.ts`, display: `${ALIAS_EXTENSION_DIR}/index.ts` },
  { entry: "../web-search/index.ts", display: "web-search/index.ts" },
  { entry: "../context-mode/src/index.ts", display: "context-mode/src/index.ts" },
  { entry: "../codegraph/index.ts", display: "codegraph/index.ts" },
];

function fail(message: string): never {
  throw new Error(`delegated-pi-loop resource policy invalid: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${label} has unknown key "${key}"`);
  }
}

/** Syntax failure from the duplicate-key-aware policy parser. */
class PolicyJsonSyntaxError extends Error {}

/** Duplicate object key failure carrying the dotted object-scope label. */
class PolicyDuplicateKeyError extends Error {
  constructor(scope: string, key: string) {
    super(`${scope} contains duplicate key "${key}"`);
  }
}

function isJsonWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** Decodes one exact JSON token through the platform parser so semantics match exactly. */
function decodeJsonToken(token: string): unknown {
  try {
    return JSON.parse(token);
  } catch {
    throw new PolicyJsonSyntaxError("invalid JSON token");
  }
}

/**
 * Duplicate-key-aware JSON parser for the closed policy schema.
 * `JSON.parse` silently keeps the last value of a repeated key, so this
 * scanner tracks the key set of every object scope while it walks the
 * document and fails on the first repeat in any scope, including nested
 * container keys such as `extensions.catalog` or `skills.excluded` that a
 * flat textual scan misses. Strings are consumed as whole escaped tokens
 * and primitives are decoded by `JSON.parse` itself, so key-like text
 * inside a value can never produce a false positive and number, string,
 * and escape semantics stay identical to the platform parser. Scope labels
 * follow the policy's dotted path (`extensions`, `skills.allowed`, array
 * indices) and match the validator's labels.
 */
class PolicyJsonParser {
  private readonly text: string;
  private pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  parseDocument(): unknown {
    const value = this.parseValue("document");
    this.skipWhitespace();
    if (this.pos !== this.text.length) throw new PolicyJsonSyntaxError("trailing content");
    return value;
  }

  private childScope(scope: string, key: string): string {
    return scope === "document" ? key : `${scope}.${key}`;
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && isJsonWhitespace(this.text[this.pos]!)) this.pos += 1;
  }

  private parseValue(scope: string): unknown {
    this.skipWhitespace();
    const ch = this.text[this.pos];
    if (ch === undefined) throw new PolicyJsonSyntaxError("unexpected end of input");
    if (ch === "{") return this.parseObject(scope);
    if (ch === "[") return this.parseArray(scope);
    if (ch === '"') return this.parseString();
    return this.parsePrimitive();
  }

  private parseObject(scope: string): Record<string, unknown> {
    this.pos += 1;
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos += 1;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') throw new PolicyJsonSyntaxError("expected an object key");
      const key = this.parseString();
      if (seen.has(key)) throw new PolicyDuplicateKeyError(scope, key);
      seen.add(key);
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") throw new PolicyJsonSyntaxError("expected ':' after an object key");
      this.pos += 1;
      result[key] = this.parseValue(this.childScope(scope, key));
      this.skipWhitespace();
      const separator = this.text[this.pos];
      if (separator === ",") {
        this.pos += 1;
        continue;
      }
      if (separator === "}") {
        this.pos += 1;
        return result;
      }
      throw new PolicyJsonSyntaxError("expected ',' or '}' in an object");
    }
  }

  private parseArray(scope: string): unknown[] {
    this.pos += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos += 1;
      return result;
    }
    for (;;) {
      result.push(this.parseValue(`${scope}[${result.length}]`));
      this.skipWhitespace();
      const separator = this.text[this.pos];
      if (separator === ",") {
        this.pos += 1;
        continue;
      }
      if (separator === "]") {
        this.pos += 1;
        return result;
      }
      throw new PolicyJsonSyntaxError("expected ',' or ']' in an array");
    }
  }

  private parseString(): string {
    const start = this.pos;
    this.pos += 1;
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]!;
      if (ch === "\\") {
        this.pos += 2;
        continue;
      }
      if (ch === '"') {
        const raw = this.text.slice(start, this.pos + 1);
        this.pos += 1;
        return decodeJsonToken(raw) as string;
      }
      this.pos += 1;
    }
    throw new PolicyJsonSyntaxError("unterminated string");
  }

  private parsePrimitive(): unknown {
    const start = this.pos;
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]!;
      if (ch === "," || ch === "]" || ch === "}" || isJsonWhitespace(ch)) break;
      this.pos += 1;
    }
    return decodeJsonToken(this.text.slice(start, this.pos));
  }
}

/** A canonical path is contained when it sits strictly below the root after symlink resolution. */
function containedBelow(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function regularFile(filePath: string): boolean {
  const info = statSync(filePath, { throwIfNoEntry: false });
  return info?.isFile() === true;
}

function regularDirectory(dirPath: string): boolean {
  const info = statSync(dirPath, { throwIfNoEntry: false });
  return info?.isDirectory() === true;
}

/**
 * Resolves one policy-relative extension entry to its canonical absolute
 * file path. Rejects absolute entries, blank entries, missing entries,
 * non-files, and any symlink resolution that escapes the extensions root.
 */
function resolveExtensionEntry(entry: unknown, roots: ContainmentRoots): string {
  if (!nonBlankString(entry)) fail("extensions entries must be non-empty, non-whitespace-only relative paths");
  if (path.isAbsolute(entry)) fail(`extensions entry "${entry}" must be a relative path, not absolute`);
  let canonical: string;
  try {
    canonical = realpathSync(path.resolve(roots.policyDir, entry));
  } catch {
    fail(`extensions entry "${entry}" does not resolve to an existing file`);
  }
  if (!regularFile(canonical)) fail(`extensions entry "${entry}" is not a regular file`);
  if (!containedBelow(canonical, roots.extensionsRoot)) {
    fail(`extensions entry "${entry}" resolves outside the extensions root`);
  }
  return canonical;
}

/**
 * Resolves one policy-relative skill directory to its canonical absolute
 * path and verifies it contains a regular `SKILL.md`. Symlink resolution
 * must stay inside the skills root.
 */
function resolveSkillDirectory(name: string, entry: unknown, roots: ContainmentRoots): string {
  if (!nonBlankString(entry)) fail(`skills.allowed.${name} must be a non-empty, non-whitespace-only relative path`);
  if (path.isAbsolute(entry)) fail(`skills.allowed.${name} must be a relative path, not absolute`);
  let canonical: string;
  try {
    canonical = realpathSync(path.resolve(roots.policyDir, entry));
  } catch {
    fail(`skills.allowed.${name} does not resolve to an existing directory`);
  }
  if (!regularDirectory(canonical)) fail(`skills.allowed.${name} is not a regular directory`);
  if (!containedBelow(canonical, roots.skillsRoot)) {
    fail(`skills.allowed.${name} resolves outside the skills root`);
  }
  // The SKILL.md invariant is canonical too: a symlinked SKILL.md that
  // resolves outside the skills root is an escape, not a valid skill body.
  let skillMdCanonical: string;
  try {
    skillMdCanonical = realpathSync(path.join(canonical, "SKILL.md"));
  } catch {
    fail(`skills.allowed.${name} directory contains no regular SKILL.md`);
  }
  if (!regularFile(skillMdCanonical)) {
    fail(`skills.allowed.${name} directory contains no regular SKILL.md`);
  }
  if (!containedBelow(skillMdCanonical, roots.skillsRoot)) {
    fail(`skills.allowed.${name} SKILL.md resolves outside the skills root`);
  }
  return canonical;
}

function parseExtensionList(value: unknown, label: string, roots: ContainmentRoots): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  const seenEntries = new Set<string>();
  const resolved: string[] = [];
  for (const entry of value) {
    if (!nonBlankString(entry)) fail(`${label} entries must be non-empty, non-whitespace-only relative paths`);
    if (seenEntries.has(entry)) fail(`${label} contains duplicate entry "${entry}"`);
    seenEntries.add(entry);
    resolved.push(resolveExtensionEntry(entry, roots));
  }
  // Two different relative strings can still resolve to one canonical file
  // (for example through a symlinked sibling); the child profile must never
  // load one entry file twice.
  const canonicalSet = new Set(resolved);
  if (canonicalSet.size !== resolved.length) fail(`${label} contains entries that resolve to the same file`);
  return resolved;
}

/** The extension directory a canonical entry file lives in, relative to the extensions root. */
function extensionDirOf(entry: string, roots: ContainmentRoots): string {
  return path.relative(roots.extensionsRoot, path.dirname(entry)).split(path.sep)[0]!;
}

function countEntriesInDir(entries: readonly string[], dir: string, roots: ContainmentRoots): number {
  return entries.filter((entry) => extensionDirOf(entry, roots) === dir).length;
}

/** Exact length, canonical identity, and order match between two resolved lists. */
function resolvesToCanonicalProfile(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
}

/**
 * Strictly validates one parsed resource-policy document and resolves every
 * path against the containment roots derived from the policy file location.
 * Fails closed on any structural, naming, containment, or required-profile
 * violation.
 */
export function validateResourcePolicy(value: unknown, roots: ContainmentRoots): ResolvedDelegateResources {
  if (!isRecord(value)) fail("document must be a JSON object");
  exactKeys(value, ["version", "extensions", "skills"], "document");
  if (value.version !== RESOURCE_POLICY_VERSION) fail(`version must be exactly ${RESOURCE_POLICY_VERSION}`);

  if (!isRecord(value.extensions)) fail("extensions must be an object");
  exactKeys(value.extensions, ["catalog", "runtime"], "extensions");
  const catalogExtensions = parseExtensionList(value.extensions.catalog, "extensions.catalog", roots);
  const runtimeExtensions = parseExtensionList(value.extensions.runtime, "extensions.runtime", roots);

  if (!isRecord(value.skills)) fail("skills must be an object");
  exactKeys(value.skills, ["allowed", "excluded"], "skills");
  if (!isRecord(value.skills.allowed) || Object.keys(value.skills.allowed).length === 0) {
    fail("skills.allowed must be a non-empty object");
  }
  const allowedSkills = new Map<string, string>();
  for (const [name, entry] of Object.entries(value.skills.allowed)) {
    if (!nonBlankString(name)) fail("skills.allowed keys must not be empty or whitespace-only");
    allowedSkills.set(name, resolveSkillDirectory(name, entry, roots));
  }
  if (!Array.isArray(value.skills.excluded)) fail("skills.excluded must be an array");
  const excludedSkills = new Set<string>();
  for (const name of value.skills.excluded) {
    if (!nonBlankString(name)) fail("skills.excluded entries must be non-empty, non-whitespace-only strings");
    if (excludedSkills.has(name)) fail(`skills.excluded contains duplicate entry "${name}"`);
    if (allowedSkills.has(name)) fail(`skill "${name}" appears in both allowed and excluded`);
    excludedSkills.add(name);
  }

  // The delegated child entry is this extension's own entry file next to the
  // policy: loading `delegated-pi-loop` in the child keeps the parent
  // watchdog and recursive-tool suppression active while adding no
  // model-visible child context.
  let delegatedChildEntry: string;
  try {
    delegatedChildEntry = realpathSync(path.join(roots.policyDir, "index.ts"));
  } catch {
    fail("the delegated child entry index.ts must exist next to the policy file");
  }
  if (!runtimeExtensions.includes(delegatedChildEntry)) {
    fail("extensions.runtime must contain the delegated child entry exactly once");
  }
  if (catalogExtensions.includes(delegatedChildEntry)) {
    fail("extensions.catalog must not load the delegated child entry");
  }
  if (countEntriesInDir(catalogExtensions, ALIAS_EXTENSION_DIR, roots) !== 1) {
    fail(`extensions.catalog must contain exactly one ${ALIAS_EXTENSION_DIR} entry`);
  }
  if (countEntriesInDir(runtimeExtensions, ALIAS_EXTENSION_DIR, roots) !== 1) {
    fail(`extensions.runtime must contain exactly one ${ALIAS_EXTENSION_DIR} entry`);
  }
  for (const dir of MODEL_TOOL_EXTENSION_DIRS) {
    if (countEntriesInDir(runtimeExtensions, dir, roots) !== 1) {
      fail(`extensions.runtime must contain exactly one ${dir} entry`);
    }
    if (countEntriesInDir(catalogExtensions, dir, roots) > 0) {
      fail(`extensions.catalog must not contain the model-tool extension ${dir}`);
    }
  }

  // Final exact-profile boundary: after canonical resolution each list must
  // equal the exact fixed entry files in the exact fixed order. The focused
  // invariants above keep their detailed first-failure diagnostics; this
  // check rejects everything they let through, because any deviation changes
  // the resolved array: extra contained entries (an unrelated sibling
  // extension such as footer), reordered fixed entries, and alternate entry
  // files inside a required extension directory all fail closed here.
  const canonicalCatalog = CATALOG_PROFILE.map((profile) => resolveExtensionEntry(profile.entry, roots));
  if (!resolvesToCanonicalProfile(catalogExtensions, canonicalCatalog)) {
    fail(
      `extensions.catalog must resolve to exactly one canonical entry, ${
        CATALOG_PROFILE.map((profile) => profile.display).join(", ")
      }`,
    );
  }
  const canonicalRuntime = RUNTIME_PROFILE.map((profile) => resolveExtensionEntry(profile.entry, roots));
  if (!resolvesToCanonicalProfile(runtimeExtensions, canonicalRuntime)) {
    fail(
      `extensions.runtime must resolve to exactly the five canonical entries in order: ${
        RUNTIME_PROFILE.map((profile) => profile.display).join(", ")
      }`,
    );
  }

  return {
    catalogExtensions,
    runtimeExtensions,
    allowedSkills,
    excludedSkills,
    roots,
  };
}

/** Containment roots for a policy file: its extension dir, the extensions root, and the sibling skills root. */
function containmentRootsFor(policyPath: string): ContainmentRoots {
  const policyDir = realpathSync(path.dirname(policyPath));
  const extensionsRoot = realpathSync(path.resolve(policyDir, ".."));
  const skillsRoot = realpathSync(path.resolve(extensionsRoot, "..", "skills"));
  if (!containedBelow(policyDir, extensionsRoot)) {
    fail("the policy file must live inside an extension directory under the extensions root");
  }
  return { extensionsRoot, skillsRoot, policyDir };
}

/** Reads and strictly validates a resource-policy file. Never falls back. */
export function readResourcesFile(filePath: string): ResolvedDelegateResources {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`delegated-pi-loop resource policy invalid: cannot read ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = new PolicyJsonParser(text).parseDocument();
  } catch (error) {
    if (error instanceof PolicyDuplicateKeyError) {
      throw new Error(`delegated-pi-loop resource policy invalid: ${error.message}`);
    }
    throw new Error(`delegated-pi-loop resource policy invalid: ${filePath} is not valid JSON`);
  }
  return validateResourcePolicy(parsed, containmentRootsFor(filePath));
}

const defaultResourcesPath = fileURLToPath(new URL("./resources.json", import.meta.url));

/**
 * Loads the extension-owned child resource policy. Reads and validates the
 * file fresh on every call so a `/reload` that re-runs the extension
 * instance picks policy changes up with the rest of the extension runtime;
 * there is no process-level cache and no broad-discovery fallback.
 */
export function loadDelegateResources(): ResolvedDelegateResources {
  return readResourcesFile(defaultResourcesPath);
}

/** Allowed skill names in policy order; builds the model-visible parameter enum. */
export function allowedDelegateSkillNames(resources: ResolvedDelegateResources): readonly string[] {
  return [...resources.allowedSkills.keys()];
}

/** One approved skill resolved to its canonical directory. */
export interface SelectedDelegateSkill {
  readonly name: string;
  /** Canonical absolute skill directory containing the regular `SKILL.md`. */
  readonly path: string;
}

/**
 * Resolves the orchestrator-selected skill candidates. Omitted and empty
 * selections resolve to no skills. The runtime value is untrusted (resumed
 * sessions and provider quirks can bypass the schema enum), so a defined
 * non-array fails with one exact bounded error before any entry or length
 * is read. Unknown, excluded, blank, and non-string names fail closed with
 * the name only; no policy filesystem path is ever exposed through these
 * errors. Duplicates collapse and the result follows policy order, not
 * caller order, so child prompts stay deterministic.
 */
export function resolveDelegateSkills(
  resources: ResolvedDelegateResources,
  requested: unknown,
): readonly SelectedDelegateSkill[] {
  if (requested === undefined) return [];
  if (!Array.isArray(requested)) {
    throw new Error("availableSkills must be an array of skill names");
  }
  if (requested.length === 0) return [];
  const requestedNames = new Set<string>();
  for (const name of requested) {
    if (!nonBlankString(name)) {
      throw new Error("availableSkills entries must be non-empty, non-whitespace-only skill names");
    }
    if (resources.excludedSkills.has(name)) {
      throw new Error(`Skill "${name}" is not approved for delegated children`);
    }
    if (!resources.allowedSkills.has(name)) {
      throw new Error(`Skill "${name}" is not approved for delegated children`);
    }
    requestedNames.add(name);
  }
  // Policy order, not caller order, keeps child prompts deterministic.
  return [...resources.allowedSkills.entries()]
    .filter(([name]) => requestedNames.has(name))
    .map(([name, skillPath]) => ({ name, path: skillPath }));
}

/**
 * Re-verifies one approved extension entry against its startup validation.
 * The stored canonical path must still resolve to itself (a symlink swap
 * resolves elsewhere), stay a regular file, and stay contained under the
 * canonical extensions root. Runs at argument construction and again
 * immediately before every catalog or runtime spawn. Messages stay bounded
 * and carry no paths or policy identifiers.
 */
function verifyExtensionEntry(entry: string, roots: ContainmentRoots): void {
  let current: string;
  try {
    current = realpathSync(entry);
  } catch {
    throw new Error("delegated-pi-loop resource policy invalid: an approved extension entry file disappeared before spawn");
  }
  if (current !== entry) {
    throw new Error("delegated-pi-loop resource policy invalid: an approved extension entry no longer resolves to its validated canonical path");
  }
  if (!regularFile(current)) {
    throw new Error("delegated-pi-loop resource policy invalid: an approved extension entry is no longer a regular file");
  }
  if (!containedBelow(current, roots.extensionsRoot)) {
    throw new Error("delegated-pi-loop resource policy invalid: an approved extension entry resolves outside the extensions root");
  }
}

/**
 * Re-verifies one selected skill directory against its startup validation:
 * canonical identity, regular directory, containment under the skills root,
 * and a regular `SKILL.md` whose own symlink resolution stays inside the
 * skills root. Runs at argument construction and again immediately before
 * every catalog and runtime spawn.
 */
function verifySelectedSkill(skill: SelectedDelegateSkill, roots: ContainmentRoots): void {
  let current: string;
  try {
    current = realpathSync(skill.path);
  } catch {
    throw new Error("delegated-pi-loop resource policy invalid: an approved skill disappeared before spawn");
  }
  if (current !== skill.path) {
    throw new Error("delegated-pi-loop resource policy invalid: an approved skill no longer resolves to its validated canonical path");
  }
  if (!regularDirectory(current)) {
    throw new Error("delegated-pi-loop resource policy invalid: an approved skill is no longer a regular directory");
  }
  if (!containedBelow(current, roots.skillsRoot)) {
    throw new Error("delegated-pi-loop resource policy invalid: an approved skill resolves outside the skills root");
  }
  let skillMdCanonical: string;
  try {
    skillMdCanonical = realpathSync(path.join(current, "SKILL.md"));
  } catch {
    throw new Error("delegated-pi-loop resource policy invalid: an approved skill disappeared before spawn");
  }
  if (!regularFile(skillMdCanonical)) {
    throw new Error("delegated-pi-loop resource policy invalid: an approved skill directory contains no regular SKILL.md");
  }
  if (!containedBelow(skillMdCanonical, roots.skillsRoot)) {
    throw new Error("delegated-pi-loop resource policy invalid: an approved skill SKILL.md resolves outside the skills root");
  }
}

/**
 * Fail-closed re-verification of every selected skill. Shared by the
 * catalog and runtime pre-spawn verifiers: a selected skill that became
 * invalid after selection fails the run before any child of either profile
 * spawns, not only before the runtime child that would receive its
 * `--skill` path.
 */
function verifySelectedSkills(selectedSkills: readonly SelectedDelegateSkill[], roots: ContainmentRoots): void {
  for (const skill of selectedSkills) verifySelectedSkill(skill, roots);
}

/**
 * Fail-closed re-verification of every approved catalog extension entry.
 * Runs at argument construction and again immediately before every catalog
 * preflight spawn, including fallback attempts.
 */
export function verifyCatalogResources(resources: ResolvedDelegateResources): void {
  for (const entry of resources.catalogExtensions) verifyExtensionEntry(entry, resources.roots);
}

/**
 * Fail-closed re-verification of every approved runtime extension entry and
 * every selected skill. Runs at argument construction and again immediately
 * before every runtime child spawn, including fallback attempts.
 */
export function verifyRuntimeResources(
  resources: ResolvedDelegateResources,
  selectedSkills: readonly SelectedDelegateSkill[],
): void {
  for (const entry of resources.runtimeExtensions) verifyExtensionEntry(entry, resources.roots);
  verifySelectedSkills(selectedSkills, resources.roots);
}

function extensionFlagArgs(entries: readonly string[]): readonly string[] {
  return entries.flatMap((entry) => ["-e", entry]);
}

function skillFlagArgs(skills: readonly SelectedDelegateSkill[]): readonly string[] {
  return skills.flatMap((skill) => ["--skill", skill.path]);
}

/**
 * Catalog-preflight child arguments: all discovery disabled (including
 * context files), then exactly the explicitly approved catalog extension
 * entry files in policy order. No skills and no runtime model-tool
 * extensions ever reach a catalog preflight. Construction re-verifies every
 * catalog entry so a vanished or swapped path fails before arguments exist.
 */
export function buildCatalogResourceArgs(resources: ResolvedDelegateResources): readonly string[] {
  verifyCatalogResources(resources);
  return [...BASE_ISOLATION_FLAGS, "--no-context-files", ...extensionFlagArgs(resources.catalogExtensions)];
}

/**
 * Delegated RPC child arguments: discovery disabled (context files stay
 * enabled), the five fixed extension entry files in policy order, then one
 * explicit `--skill` path per selected and approved skill in policy order.
 * Construction re-verifies every runtime entry and selected skill so a
 * vanished or swapped path fails before arguments exist.
 */
export function buildRuntimeResourceArgs(
  resources: ResolvedDelegateResources,
  selectedSkills: readonly SelectedDelegateSkill[],
): readonly string[] {
  verifyRuntimeResources(resources, selectedSkills);
  return [
    ...BASE_ISOLATION_FLAGS,
    ...extensionFlagArgs(resources.runtimeExtensions),
    ...skillFlagArgs(selectedSkills),
  ];
}

/**
 * Builds the one immutable resource selection for a complete delegate
 * invocation. The extension, skill validation, and full canonical
 * re-verification here run before manager admission, private artifact
 * creation, or any child spawn; the runner reuses these exact arrays for
 * every route attempt and report-recovery round. The verification closures
 * re-run the same fail-closed checks immediately before every catalog or
 * runtime spawn, including fallback attempts: the catalog closure re-checks
 * every approved catalog entry and every selected skill as a precondition
 * (the catalog argv itself stays alias-only; no skill ever reaches the
 * catalog CLI), and the runtime closure re-checks every runtime entry and
 * selected skill. A post-validation symlink swap of any approved path thus
 * fails closed before any child command line exists while the argument
 * arrays stay byte-for-byte identical across attempts.
 */
export function buildDelegateResourceSelection(
  resources: ResolvedDelegateResources,
  requestedSkills?: unknown,
): DelegateResourceSelection {
  const selectedSkills = resolveDelegateSkills(resources, requestedSkills);
  return {
    catalogArgs: buildCatalogResourceArgs(resources),
    runtimeArgs: buildRuntimeResourceArgs(resources, selectedSkills),
    verifyCatalogSpawn: () => {
      verifyCatalogResources(resources);
      verifySelectedSkills(selectedSkills, resources.roots);
    },
    verifyRuntimeSpawn: () => verifyRuntimeResources(resources, selectedSkills),
  };
}
