import assert from "node:assert/strict";
import { after, test } from "node:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowedDelegateSkillNames,
  buildCatalogResourceArgs,
  buildDelegateResourceSelection,
  buildRuntimeResourceArgs,
  loadDelegateResources,
  readResourcesFile,
  resolveDelegateSkills,
  validateResourcePolicy,
  type SelectedDelegateSkill,
} from "./resources.ts";
import type { ContainmentRoots } from "./resources.ts";

const shippedResourcesPath = fileURLToPath(new URL("./resources.json", import.meta.url));

/** Pinned shipped-policy inventory; a policy edit must update this test deliberately. */
const SHIPPED_ALLOWED_SKILLS = [
  "figma", "figma-create-design-system-rules", "figma-implement-design",
  "firebase-ai-logic-basics", "firebase-app-hosting-basics", "firebase-auth-basics",
  "firebase-basics", "firebase-data-connect", "firebase-firestore",
  "firebase-hosting-basics", "firebase-security-rules-auditor",
  "gh-cli", "linear-cli", "mysql", "notion", "postgres", "pp-posthog",
  "ruff", "ty", "uv",
] as const;

const SHIPPED_EXCLUDED_SKILLS = [
  "crit", "crit-cli", "developing-genkit-dart", "developing-genkit-go",
  "developing-genkit-js", "developing-genkit-python", "directus-browser",
  "grill-with-docs", "improve-codebase-architecture", "intent-layer",
  "nlm-skill", "pi-browser-harness", "session-handoff", "skill-creator",
] as const;

/** Unique fixture roots; removed by exact path after all tests. */
const fixtureRoots: string[] = [];

after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
});

const FIXTURE_ENTRY = {
  child: "./index.ts",
  alias: "../openai-codex-aliases/index.ts",
  aliasAlternate: "../openai-codex-aliases/alias-alt.ts",
  webSearch: "../web-search/index.ts",
  contextMode: "../context-mode/src/index.ts",
  codegraph: "../codegraph/index.ts",
  codegraphAlternate: "../codegraph/alt.ts",
  footer: "../footer/index.ts",
} as const;

interface FixtureOptions {
  readonly catalog?: readonly string[];
  readonly runtime?: readonly string[];
  readonly allowed?: Readonly<Record<string, string>>;
  readonly excluded?: readonly string[];
  readonly skills?: readonly string[];
  readonly skipChildEntry?: boolean;
}

/**
 * One self-contained policy sandbox that mirrors the real layout: an
 * extensions root with the delegated-pi-loop directory holding the policy, a
 * sibling skills root, and the five required extension directories. Every
 * file is created empty; only structure matters to the validator.
 */
async function createFixturePolicy(options: FixtureOptions = {}): Promise<{
  readonly root: string;
  readonly policyPath: string;
  readonly extensionsRoot: string;
  readonly skillsRoot: string;
  readonly childEntryPath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-resources-test-"));
  fixtureRoots.push(root);
  const extensionsRoot = path.join(root, "agent", "extensions");
  const policyDir = path.join(extensionsRoot, "delegated-pi-loop");
  const skillsRoot = path.join(root, "agent", "skills");
  for (const dir of [
    policyDir,
    path.join(extensionsRoot, "openai-codex-aliases"),
    path.join(extensionsRoot, "web-search"),
    path.join(extensionsRoot, "context-mode", "src"),
    path.join(extensionsRoot, "codegraph"),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  const childEntryPath = path.join(policyDir, "index.ts");
  if (options.skipChildEntry !== true) await writeFile(childEntryPath, "");
  await writeFile(path.join(extensionsRoot, "openai-codex-aliases", "index.ts"), "");
  await writeFile(path.join(extensionsRoot, "web-search", "index.ts"), "");
  await writeFile(path.join(extensionsRoot, "context-mode", "src", "index.ts"), "");
  await writeFile(path.join(extensionsRoot, "codegraph", "index.ts"), "");
  // Contained-but-unapproved siblings that mirror the real extensions
  // root: an unrelated footer extension plus alternate entry files inside
  // two required extension directories. Listing any of them in a policy
  // must fail canonical profile resolution; their mere presence on disk
  // must never fail validation.
  await mkdir(path.join(extensionsRoot, "footer"), { recursive: true });
  await writeFile(path.join(extensionsRoot, "footer", "index.ts"), "");
  await writeFile(path.join(extensionsRoot, "openai-codex-aliases", "alias-alt.ts"), "");
  await writeFile(path.join(extensionsRoot, "codegraph", "alt.ts"), "");
  const skills = options.skills ?? ["alpha", "beta", "gamma"];
  for (const skill of skills) {
    await mkdir(path.join(skillsRoot, skill), { recursive: true });
    await writeFile(path.join(skillsRoot, skill, "SKILL.md"), `# ${skill}\n`);
  }
  const document = {
    version: 1,
    extensions: {
      catalog: options.catalog ?? [FIXTURE_ENTRY.alias],
      runtime: options.runtime ?? [
        FIXTURE_ENTRY.child,
        FIXTURE_ENTRY.alias,
        FIXTURE_ENTRY.webSearch,
        FIXTURE_ENTRY.contextMode,
        FIXTURE_ENTRY.codegraph,
      ],
    },
    skills: {
      allowed: options.allowed ?? {
        alpha: "../../skills/alpha",
        beta: "../../skills/beta",
        gamma: "../../skills/gamma",
      },
      excluded: options.excluded ?? ["delta", "epsilon"],
    },
  };
  const policyPath = path.join(policyDir, "resources.json");
  await writeFile(policyPath, `${JSON.stringify(document, null, 2)}\n`);
  return { root, policyPath, extensionsRoot, skillsRoot, childEntryPath };
}

/** Fails closed with the shared prefix and a bounded message fragment. */
function assertPolicyFailure(run: () => unknown, fragment: RegExp): Promise<void> {
  // Route sync throws through a real rejected promise so the message is
  // always validated instead of propagating unexamined.
  return Promise.resolve().then(run).then(
    () => { throw new Error("expected the policy load to fail closed"); },
    (error: unknown) => {
      assert.match((error as Error).message, /^delegated-pi-loop resource policy invalid: /);
      assert.match((error as Error).message, fragment);
    },
  );
}

test("the shipped resources.json validates with the exact policy inventory", () => {
  const resources = readResourcesFile(shippedResourcesPath);
  assert.equal(resources.catalogExtensions.length, 1);
  assert.ok(resources.catalogExtensions[0]!.endsWith(path.join("openai-codex-aliases", "index.ts")));
  // The context-mode entry lives under src/, so compare each entry's exact
  // extensions-root-relative file identity: the validator now requires the
  // exact canonical entry files in the exact canonical order.
  const extensionsRoot = path.resolve(path.dirname(resources.catalogExtensions[0]!), "..");
  assert.equal(
    path.relative(extensionsRoot, resources.catalogExtensions[0]!),
    path.join("openai-codex-aliases", "index.ts"),
  );
  assert.deepEqual(
    resources.runtimeExtensions.map((entry) => path.relative(extensionsRoot, entry)),
    [
      path.join("delegated-pi-loop", "index.ts"),
      path.join("openai-codex-aliases", "index.ts"),
      path.join("web-search", "index.ts"),
      path.join("context-mode", "src", "index.ts"),
      path.join("codegraph", "index.ts"),
    ],
  );
  assert.deepEqual(allowedDelegateSkillNames(resources), [...SHIPPED_ALLOWED_SKILLS]);
  assert.deepEqual([...resources.excludedSkills].sort(), [...SHIPPED_EXCLUDED_SKILLS].sort());
  for (const skillPath of resources.allowedSkills.values()) {
    assert.ok(skillPath.includes(path.join("agent", "skills")));
  }
});

test("the shipped policy resolves through the public loader", () => {
  const resources = loadDelegateResources();
  assert.equal(resources.runtimeExtensions.length, 5);
  assert.equal(resources.allowedSkills.size, SHIPPED_ALLOWED_SKILLS.length);
});

test("a missing policy file fails closed", async () => {
  await assertPolicyFailure(
    () => readResourcesFile(path.join(os.tmpdir(), `missing-${Date.now()}`, "resources.json")),
    /cannot read/,
  );
});

test("invalid JSON fails closed", async () => {
  const { policyPath } = await createFixturePolicy();
  await writeFile(policyPath, "{ not json");
  await assertPolicyFailure(() => readResourcesFile(policyPath), /is not valid JSON/);
});

test("unknown root and nested keys fail", async () => {
  const { policyPath } = await createFixturePolicy();
  const base = JSON.parse(await readFileText(policyPath)) as Record<string, unknown>;

  const rootExtra = { ...base, extra: true };
  await assertPolicyFailure(
    () => validateResourcePolicy(rootExtra, rootsFor(policyPath)),
    /document has unknown key "extra"/,
  );

  const extensionsExtra = structuredClone(base);
  (extensionsExtra.extensions as Record<string, unknown>).extra = true;
  await assertPolicyFailure(
    () => validateResourcePolicy(extensionsExtra, rootsFor(policyPath)),
    /extensions has unknown key "extra"/,
  );

  const skillsExtra = structuredClone(base);
  (skillsExtra.skills as Record<string, unknown>).extra = true;
  await assertPolicyFailure(
    () => validateResourcePolicy(skillsExtra, rootsFor(policyPath)),
    /skills has unknown key "extra"/,
  );
});

test("an unsupported version fails", async () => {
  const { policyPath } = await createFixturePolicy();
  const base = JSON.parse(await readFileText(policyPath)) as Record<string, unknown>;
  await assertPolicyFailure(
    () => validateResourcePolicy({ ...base, version: 2 }, rootsFor(policyPath)),
    /version must be exactly 1/,
  );
});

test("empty, duplicate, and blank extension entries fail", async () => {
  const { policyPath } = await createFixturePolicy();
  const base = JSON.parse(await readFileText(policyPath)) as { extensions: { runtime: string[]; catalog: string[] } };

  const emptyRuntime = structuredClone(base);
  emptyRuntime.extensions.runtime = [];
  await assertPolicyFailure(
    () => validateResourcePolicy(emptyRuntime, rootsFor(policyPath)),
    /extensions\.runtime must be a non-empty array/,
  );

  const duplicate = structuredClone(base);
  duplicate.extensions.runtime = [...base.extensions.runtime, FIXTURE_ENTRY.alias];
  await assertPolicyFailure(
    () => validateResourcePolicy(duplicate, rootsFor(policyPath)),
    /extensions\.runtime contains duplicate entry/,
  );

  const blank = structuredClone(base);
  blank.extensions.runtime = [...base.extensions.runtime.slice(1), "  "];
  await assertPolicyFailure(
    () => validateResourcePolicy(blank, rootsFor(policyPath)),
    /extensions\.runtime entries must be non-empty/,
  );
});

test("absolute extension and skill paths fail", async () => {
  const { policyPath } = await createFixturePolicy();
  const base = JSON.parse(await readFileText(policyPath)) as {
    extensions: { runtime: string[] };
    skills: { allowed: Record<string, string> };
  };

  const absoluteExtension = structuredClone(base);
  absoluteExtension.extensions.runtime = [...base.extensions.runtime.slice(1), "/etc/passwd"];
  await assertPolicyFailure(
    () => validateResourcePolicy(absoluteExtension, rootsFor(policyPath)),
    /must be a relative path, not absolute/,
  );

  const absoluteSkill = structuredClone(base);
  absoluteSkill.skills.allowed = { ...base.skills.allowed, alpha: "/etc" };
  await assertPolicyFailure(
    () => validateResourcePolicy(absoluteSkill, rootsFor(policyPath)),
    /skills\.allowed\.alpha must be a relative path, not absolute/,
  );
});

test("a missing extension entry file fails", async () => {
  const { policyPath, extensionsRoot } = await createFixturePolicy();
  await rm(path.join(extensionsRoot, "web-search", "index.ts"));
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /does not resolve to an existing file/,
  );
});

test("a missing skill directory fails", async () => {
  const { policyPath, skillsRoot } = await createFixturePolicy();
  await rm(path.join(skillsRoot, "beta"), { recursive: true });
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /skills\.allowed\.beta does not resolve to an existing directory/,
  );
});

test("a missing or non-regular SKILL.md fails", async () => {
  const { policyPath, skillsRoot } = await createFixturePolicy();
  await rm(path.join(skillsRoot, "alpha", "SKILL.md"));
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /skills\.allowed\.alpha directory contains no regular SKILL\.md/,
  );
  await mkdir(path.join(skillsRoot, "alpha", "SKILL.md"), { recursive: true });
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /skills\.allowed\.alpha directory contains no regular SKILL\.md/,
  );
});

test("a symlink escaping the extensions root fails", { skip: process.platform === "win32" }, async () => {
  const { policyPath, root, extensionsRoot } = await createFixturePolicy();
  const outside = path.join(root, "outside-entry.ts");
  await writeFile(outside, "");
  const linked = path.join(extensionsRoot, "web-search", "linked.ts");
  await symlink(outside, linked);
  const base = JSON.parse(await readFileText(policyPath)) as { extensions: { runtime: string[]; catalog?: string[] } };
  const escaped = structuredClone(base);
  escaped.extensions.runtime = base.extensions.runtime.map((entry) =>
    entry === FIXTURE_ENTRY.webSearch ? "../web-search/linked.ts" : entry,
  );
  await assertPolicyFailure(
    () => validateResourcePolicy(escaped, rootsFor(policyPath)),
    /resolves outside the extensions root/,
  );
});

test("a symlink escaping the skills root fails", { skip: process.platform === "win32" }, async () => {
  const { policyPath, root, skillsRoot } = await createFixturePolicy();
  const outsideDir = path.join(root, "outside-skill");
  await mkdir(outsideDir);
  await writeFile(path.join(outsideDir, "SKILL.md"), "# outside\n");
  await symlink(outsideDir, path.join(skillsRoot, "escaped"));
  const raw = await readFileText(policyPath);
  const document = JSON.parse(raw) as { skills: { allowed: Record<string, string> } };
  document.skills.allowed.alpha = "../../skills/escaped";
  await writeFile(policyPath, `${JSON.stringify(document, null, 2)}\n`);
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /skills\.allowed\.alpha resolves outside the skills root/,
  );
});

test("duplicate allowed keys in the raw text and duplicate excluded names fail", async () => {
  const { policyPath } = await createFixturePolicy();
  const raw = await readFileText(policyPath);
  // Duplicating the alpha key in the raw text: JSON.parse would silently keep
  // the last one, so the loader must reject the document textually.
  const duplicated = raw.replace(
    /"alpha": "\.\.\/\.\.\/skills\/alpha",?/,
    (match) => `${match}\n      "alpha": "../../skills/beta",`,
  );
  assert.notEqual(duplicated, raw, "the fixture must actually duplicate a key");
  await writeFile(policyPath, duplicated);
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /skills\.allowed contains duplicate key "alpha"/,
  );
});

test("duplicate nested container keys in every object scope fail closed", async () => {
  const { policyPath } = await createFixturePolicy();
  const raw = await readFileText(policyPath);
  // Every duplicated container key names the exact object scope that
  // repeated it. JSON.parse alone accepts each document (it silently keeps
  // the last duplicate), which is why the parser must be duplicate-aware.
  const cases: ReadonlyArray<{ readonly fragment: RegExp; readonly key: string }> = [
    { fragment: /document contains duplicate key "version"/, key: "version" },
    { fragment: /document contains duplicate key "extensions"/, key: "extensions" },
    { fragment: /document contains duplicate key "skills"/, key: "skills" },
    { fragment: /extensions contains duplicate key "catalog"/, key: "catalog" },
    { fragment: /extensions contains duplicate key "runtime"/, key: "runtime" },
    { fragment: /skills contains duplicate key "allowed"/, key: "allowed" },
    { fragment: /skills contains duplicate key "excluded"/, key: "excluded" },
  ];
  for (const testCase of cases) {
    const duplicated = duplicateRawKey(raw, testCase.key);
    assert.doesNotThrow(() => JSON.parse(duplicated), `JSON.parse must accept the duplicated ${testCase.key} text`);
    await writeFile(policyPath, duplicated);
    await assertPolicyFailure(() => readResourcesFile(policyPath), testCase.fragment);
    await writeFile(policyPath, raw);
  }
});

test("key-like text inside string values never triggers duplicate detection", async () => {
  // Object-scope-correct parsing consumes strings as whole escaped tokens,
  // so a value that merely looks like a repeated container key is data, not
  // structure; the same fixture still rejects a structural duplicate.
  const fixture = await createFixturePolicy({
    excluded: ["delta", "epsilon", "literal-\"extensions\":-text", "nested \"skills\"\u003a ok"],
  });
  const resources = readResourcesFile(fixture.policyPath);
  assert.ok(resources.excludedSkills.has("literal-\"extensions\":-text"));
  const raw = await readFileText(fixture.policyPath);
  await writeFile(fixture.policyPath, duplicateRawKey(raw, "catalog"));
  await assertPolicyFailure(
    () => readResourcesFile(fixture.policyPath),
    /extensions contains duplicate key "catalog"/,
  );
});

test("duplicate excluded names fail", async () => {
  const { policyPath } = await createFixturePolicy({ excluded: ["delta", "delta"] });
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /skills\.excluded contains duplicate entry "delta"/,
  );
});

test("an allowed and excluded skill overlap fails", async () => {
  const { policyPath } = await createFixturePolicy({ excluded: ["alpha"] });
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /skill "alpha" appears in both allowed and excluded/,
  );
});

test("a missing delegated child runtime entry fails", async () => {
  const { policyPath, extensionsRoot } = await createFixturePolicy({
    runtime: [
      FIXTURE_ENTRY.alias,
      FIXTURE_ENTRY.webSearch,
      FIXTURE_ENTRY.contextMode,
      FIXTURE_ENTRY.codegraph,
    ],
  });
  assert.ok(await fileExists(path.join(extensionsRoot, "delegated-pi-loop", "index.ts")));
  await assertPolicyFailure(
    () => readResourcesFile(policyPath),
    /extensions\.runtime must contain the delegated child entry exactly once/,
  );
});

test("a missing alias entry in catalog or runtime fails", async () => {
  const noCatalogAlias = await createFixturePolicy({ catalog: [] });
  await assertPolicyFailure(
    () => readResourcesFile(noCatalogAlias.policyPath),
    /extensions\.catalog must be a non-empty array/,
  );

  const { policyPath } = await createFixturePolicy();
  const base = JSON.parse(await readFileText(policyPath)) as { extensions: { runtime: string[]; catalog?: string[] } };

  const noRuntimeAlias = structuredClone(base);
  noRuntimeAlias.extensions.runtime = base.extensions.runtime.filter((entry) => entry !== FIXTURE_ENTRY.alias);
  await assertPolicyFailure(
    () => validateResourcePolicy(noRuntimeAlias, rootsFor(policyPath)),
    /extensions\.runtime must contain exactly one openai-codex-aliases entry/,
  );

  const wrongCatalogAlias = structuredClone(base);
  wrongCatalogAlias.extensions = {
    ...base.extensions,
    catalog: [FIXTURE_ENTRY.webSearch],
  };
  await assertPolicyFailure(
    () => validateResourcePolicy(wrongCatalogAlias, rootsFor(policyPath)),
    /extensions\.catalog must contain exactly one openai-codex-aliases entry/,
  );
});

test("a missing model-tool extension in runtime fails", async () => {
  for (const entry of [FIXTURE_ENTRY.webSearch, FIXTURE_ENTRY.contextMode, FIXTURE_ENTRY.codegraph]) {
    const { policyPath } = await createFixturePolicy();
    const base = JSON.parse(await readFileText(policyPath)) as { extensions: { runtime: string[]; catalog?: string[] } };
    const missing = structuredClone(base);
    missing.extensions.runtime = base.extensions.runtime.filter((candidate) => candidate !== entry);
    await assertPolicyFailure(
      () => validateResourcePolicy(missing, rootsFor(policyPath)),
      /extensions\.runtime must contain exactly one (web-search|context-mode|codegraph) entry/,
    );
  }
});

test("a model-tool extension in the catalog profile fails", async () => {
  const { policyPath } = await createFixturePolicy();
  const base = JSON.parse(await readFileText(policyPath)) as { extensions: { runtime: string[]; catalog?: string[] } };
  const polluted = structuredClone(base);
  polluted.extensions = {
    runtime: base.extensions.runtime,
    catalog: [FIXTURE_ENTRY.alias, FIXTURE_ENTRY.codegraph],
  };
  await assertPolicyFailure(
    () => validateResourcePolicy(polluted, rootsFor(policyPath)),
    /extensions\.catalog must not contain the model-tool extension codegraph/,
  );
});

test("the delegated child entry in the catalog profile fails", async () => {
  const { policyPath } = await createFixturePolicy();
  const base = JSON.parse(await readFileText(policyPath)) as { extensions: { runtime: string[]; catalog?: string[] } };
  const polluted = structuredClone(base);
  polluted.extensions = {
    runtime: base.extensions.runtime,
    catalog: [FIXTURE_ENTRY.alias, FIXTURE_ENTRY.child],
  };
  await assertPolicyFailure(
    () => validateResourcePolicy(polluted, rootsFor(policyPath)),
    /extensions\.catalog must not load the delegated child entry/,
  );
});

test("an extra footer entry in catalog or runtime fails canonical resolution", async () => {
  // The footer extension is contained under the extensions root and the
  // per-directory invariants above stay satisfied, so only exact canonical
  // profile resolution can reject it: accepting and emitting it would load
  // an unapproved extension in every child.
  const catalogExtra = await createFixturePolicy({
    catalog: [FIXTURE_ENTRY.alias, FIXTURE_ENTRY.footer],
  });
  await assertPolicyFailure(
    () => readResourcesFile(catalogExtra.policyPath),
    /extensions\.catalog must resolve to exactly one canonical entry, openai-codex-aliases\/index\.ts/,
  );

  const runtimeExtra = await createFixturePolicy({
    runtime: [
      FIXTURE_ENTRY.child,
      FIXTURE_ENTRY.alias,
      FIXTURE_ENTRY.webSearch,
      FIXTURE_ENTRY.contextMode,
      FIXTURE_ENTRY.codegraph,
      FIXTURE_ENTRY.footer,
    ],
  });
  await assertPolicyFailure(
    () => readResourcesFile(runtimeExtra.policyPath),
    /extensions\.runtime must resolve to exactly the five canonical entries in order/,
  );
});

test("reordered runtime entries fail the canonical profile order", async () => {
  // Every required directory still appears exactly once; only the order
  // differs, and children must load the fixed entries in the fixed order.
  const fixture = await createFixturePolicy({
    runtime: [
      FIXTURE_ENTRY.alias,
      FIXTURE_ENTRY.child,
      FIXTURE_ENTRY.webSearch,
      FIXTURE_ENTRY.contextMode,
      FIXTURE_ENTRY.codegraph,
    ],
  });
  await assertPolicyFailure(
    () => readResourcesFile(fixture.policyPath),
    /extensions\.runtime must resolve to exactly the five canonical entries in order/,
  );
});

test("alternate same-directory entry files fail canonical entry identity", async () => {
  // alias-alt.ts and alt.ts are regular contained files inside required
  // extension directories, so per-directory counting alone accepts them;
  // canonical resolution must require the exact index.ts entry files.
  const catalogAlternate = await createFixturePolicy({
    catalog: [FIXTURE_ENTRY.aliasAlternate],
  });
  await assertPolicyFailure(
    () => readResourcesFile(catalogAlternate.policyPath),
    /extensions\.catalog must resolve to exactly one canonical entry, openai-codex-aliases\/index\.ts/,
  );

  const runtimeAlternate = await createFixturePolicy({
    runtime: [
      FIXTURE_ENTRY.child,
      FIXTURE_ENTRY.alias,
      FIXTURE_ENTRY.webSearch,
      FIXTURE_ENTRY.contextMode,
      FIXTURE_ENTRY.codegraphAlternate,
    ],
  });
  await assertPolicyFailure(
    () => readResourcesFile(runtimeAlternate.policyPath),
    /extensions\.runtime must resolve to exactly the five canonical entries in order/,
  );
});

test("a future unlisted skill is unavailable by default", () => {
  const resources = loadDelegateResources();
  for (const unlisted of ["brand-new-skill", "crit", "pi-browser-harness", "session-handoff"]) {
    assert.ok(!resources.allowedSkills.has(unlisted), `${unlisted} must not be delegate-available`);
  }
  assert.throws(
    () => resolveDelegateSkills(resources, ["brand-new-skill"]),
    /Skill "brand-new-skill" is not approved for delegated children/,
  );
});

test("omitted and empty availableSkills resolve to no skills", () => {
  const resources = loadDelegateResources();
  assert.deepEqual(resolveDelegateSkills(resources, undefined), []);
  assert.deepEqual(resolveDelegateSkills(resources, []), []);
  const selection = buildDelegateResourceSelection(resources, []);
  assert.ok(!selection.runtimeArgs.includes("--skill"));
});

test("one allowed name resolves to one canonical path", () => {
  const resources = loadDelegateResources();
  const [selected] = resolveDelegateSkills(resources, ["uv"]) as SelectedDelegateSkill[];
  assert.equal(selected.name, "uv");
  assert.ok(selected.path.endsWith(path.join("skills", "uv")));
  const args = buildRuntimeResourceArgs(resources, resolveDelegateSkills(resources, ["uv"]));
  const skillIndex = args.indexOf("--skill");
  assert.equal(args[skillIndex + 1], selected.path);
  assert.equal(args.filter((arg) => arg === "--skill").length, 1);
});

test("multiple names resolve in policy order and caller order does not matter", () => {
  const resources = loadDelegateResources();
  // The shipped policy lists ..., ruff, ty, uv; policy order wins over caller order.
  const forward = resolveDelegateSkills(resources, ["uv", "ruff", "ty"]).map((skill) => skill.name);
  const backward = resolveDelegateSkills(resources, ["ty", "uv", "ruff"]).map((skill) => skill.name);
  assert.deepEqual(forward, ["ruff", "ty", "uv"]);
  assert.deepEqual(forward, backward);
  const args = buildRuntimeResourceArgs(resources, resolveDelegateSkills(resources, ["uv", "ty"]));
  const emitted = args.filter((_, index) => args[index - 1] === "--skill");
  assert.deepEqual(emitted.map((entry) => path.basename(entry)), ["ty", "uv"]);
});

test("duplicate requested names emit one path", () => {
  const resources = loadDelegateResources();
  const selected = resolveDelegateSkills(resources, ["uv", "uv", "ruff", "uv"]);
  assert.deepEqual(selected.map((skill) => skill.name), ["ruff", "uv"]);
  const args = buildRuntimeResourceArgs(resources, selected);
  assert.equal(args.filter((arg) => arg === "--skill").length, 2);
});

test("unknown names fail with the name only and no policy paths", () => {
  const resources = loadDelegateResources();
  for (const unknown of ["definitely-not-a-skill", "firebase"]) {
    assert.throws(
      () => resolveDelegateSkills(resources, [unknown]),
      (error: Error) => {
        assert.match(error.message, new RegExp(`Skill "${unknown}" is not approved for delegated children`));
        assert.ok(!error.message.includes("agent/skills"));
        assert.ok(!error.message.includes("resources.json"));
        return true;
      },
    );
  }
});

test("every excluded name fails even if a malformed policy admitted it", () => {
  const resources = loadDelegateResources();
  for (const excluded of SHIPPED_EXCLUDED_SKILLS) {
    assert.throws(
      () => resolveDelegateSkills(resources, [excluded]),
      new RegExp(`Skill "${excluded}" is not approved for delegated children`),
    );
  }
});

test("blank and non-string values fail defensively", () => {
  const resources = loadDelegateResources();
  for (const invalid of ["", "   ", 42, null, {}, []] as unknown[]) {
    assert.throws(
      () => resolveDelegateSkills(resources, [invalid] as unknown[]),
      /availableSkills entries must be non-empty, non-whitespace-only skill names/,
    );
  }
});

test("a defined non-array availableSkills value fails with one exact bounded error", () => {
  const resources = loadDelegateResources();
  // The runtime value is untrusted: a string would otherwise be iterated
  // character by character and an object would silently resolve to no
  // skills, so any defined non-array fails with the exact bounded error
  // before a length is read or an entry is iterated.
  for (const invalid of ["uv", "", "uv,ruff", 42, null, true, { 0: "uv" }, { length: 1 }] as unknown[]) {
    assert.throws(
      () => resolveDelegateSkills(resources, invalid),
      (error: unknown) => {
        assert.equal((error as Error).message, "availableSkills must be an array of skill names");
        return true;
      },
    );
  }
  // The selection build path fails identically, before any argument
  // construction.
  for (const invalid of ["uv", { name: "uv" }] as unknown[]) {
    assert.throws(
      () => buildDelegateResourceSelection(resources, invalid),
      /availableSkills must be an array of skill names/,
    );
  }
  // An actual array still resolves normally.
  assert.deepEqual(resolveDelegateSkills(resources, ["uv"]).map((skill) => skill.name), ["uv"]);
});

test("the complete allowed set emits every skill exactly once with no count limit", () => {
  const resources = loadDelegateResources();
  const everyName = allowedDelegateSkillNames(resources);
  const shuffled = [...everyName].reverse();
  const selected = resolveDelegateSkills(resources, shuffled);
  assert.equal(selected.length, everyName.length);
  assert.deepEqual(selected.map((skill) => skill.name), everyName);
  const args = buildRuntimeResourceArgs(resources, selected);
  const emitted = args.filter((_, index) => args[index - 1] === "--skill");
  assert.equal(emitted.length, everyName.length);
  assert.deepEqual(new Set(emitted).size, emitted.length);
});

test("catalog arguments disable all discovery, load only the alias entry, and carry no skills", () => {
  const resources = loadDelegateResources();
  const args = buildCatalogResourceArgs(resources);
  assert.deepEqual(args, [
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "-e",
    resources.catalogExtensions[0]!,
  ]);
  assert.ok(!args.includes("--skill"));
  for (const forbidden of ["web-search", "context-mode", "codegraph", "delegated-pi-loop"]) {
    assert.ok(!args.some((arg) => arg.includes(forbidden)), `catalog must not load ${forbidden}`);
  }
});

test("runtime arguments keep context files enabled, load exactly the five entries, then skills", () => {
  const resources = loadDelegateResources();
  const args = buildRuntimeResourceArgs(resources, resolveDelegateSkills(resources, ["uv"]));
  for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"]) {
    assert.equal(args.filter((arg) => arg === flag).length, 1, flag);
  }
  assert.ok(!args.includes("--no-context-files"));
  assert.deepEqual(args.slice(0, 4), ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"]);
  const entryArgs = args.filter((_, index) => args[index - 1] === "-e");
  assert.deepEqual(entryArgs, resources.runtimeExtensions);
  const skillIndex = args.indexOf("--skill");
  assert.ok(skillIndex > args.lastIndexOf("-e") + 1);
});

test("a vanished extension entry fails argument construction before spawn", async () => {
  const fixture = await createFixturePolicy();
  const resources = readResourcesFile(fixture.policyPath);
  await rm(path.join(fixture.extensionsRoot, "web-search", "index.ts"));
  assert.throws(
    () => buildDelegateResourceSelection(resources, ["alpha"]),
    /an approved extension entry file disappeared before spawn/,
  );
  // A later full reload of the same policy also fails closed at load time.
  await assert.rejects(
    () => readFileText(fixture.policyPath).then(() => {
      throw new Error("unreachable");
    }),
    /unreachable/,
  ).catch(() => {});
  assert.throws(() => readResourcesFile(fixture.policyPath), /does not resolve to an existing file/);
  // Catalog construction rechecks its own entries independently.
  const catalogFixture = await createFixturePolicy();
  const catalogResources = readResourcesFile(catalogFixture.policyPath);
  await rm(path.join(catalogFixture.extensionsRoot, "openai-codex-aliases", "index.ts"));
  assert.throws(
    () => buildCatalogResourceArgs(catalogResources),
    /an approved extension entry file disappeared before spawn/,
  );
});

test("a vanished SKILL.md fails runtime argument construction before spawn", async () => {
  const fixture = await createFixturePolicy();
  const resources = readResourcesFile(fixture.policyPath);
  await rm(path.join(fixture.skillsRoot, "beta", "SKILL.md"));
  await assert.throws(
    () => buildRuntimeResourceArgs(resources, resolveDelegateSkills(resources, ["beta"])),
    /an approved skill disappeared before spawn/,
  );
});

test("an extension symlink swap before argument construction fails closed", { skip: process.platform === "win32" }, async () => {
  const fixture = await createFixturePolicy();
  const outside = path.join(fixture.root, "outside-entry.ts");
  await writeFile(outside, "");
  const resources = readResourcesFile(fixture.policyPath);
  // Replace the validated web-search entry with a symlink whose target sits
  // outside the extensions root: the pre-construction re-verification must
  // reject the changed canonical identity instead of emitting the swapped
  // path (statSync alone would follow the symlink and accept it).
  await rm(path.join(fixture.extensionsRoot, "web-search", "index.ts"));
  await symlink(outside, path.join(fixture.extensionsRoot, "web-search", "index.ts"));
  await assertPolicyFailure(
    () => buildDelegateResourceSelection(resources, ["alpha"]),
    /an approved extension entry no longer resolves to its validated canonical path/,
  );
  // A swapped catalog entry fails its own argument construction first.
  const catalogFixture = await createFixturePolicy();
  const catalogOutside = path.join(catalogFixture.root, "outside-alias.ts");
  await writeFile(catalogOutside, "");
  const catalogResources = readResourcesFile(catalogFixture.policyPath);
  await rm(path.join(catalogFixture.extensionsRoot, "openai-codex-aliases", "index.ts"));
  await symlink(catalogOutside, path.join(catalogFixture.extensionsRoot, "openai-codex-aliases", "index.ts"));
  await assertPolicyFailure(
    () => buildCatalogResourceArgs(catalogResources),
    /an approved extension entry no longer resolves to its validated canonical path/,
  );
});

test("a selected-skill symlink swap before argument construction fails closed", { skip: process.platform === "win32" }, async () => {
  const fixture = await createFixturePolicy();
  const outsideDir = path.join(fixture.root, "outside-skill");
  await mkdir(outsideDir);
  await writeFile(path.join(outsideDir, "SKILL.md"), "# outside\n");
  const resources = readResourcesFile(fixture.policyPath);
  await rm(path.join(fixture.skillsRoot, "alpha"), { recursive: true });
  await symlink(outsideDir, path.join(fixture.skillsRoot, "alpha"));
  await assertPolicyFailure(
    () => buildDelegateResourceSelection(resources, ["alpha"]),
    /an approved skill no longer resolves to its validated canonical path/,
  );
});

test("a SKILL.md symlink resolving outside the skills root fails closed", { skip: process.platform === "win32" }, async () => {
  const fixture = await createFixturePolicy();
  const outsideFile = path.join(fixture.root, "outside-SKILL.md");
  await writeFile(outsideFile, "# outside\n");
  const resources = readResourcesFile(fixture.policyPath);
  await rm(path.join(fixture.skillsRoot, "beta", "SKILL.md"));
  await symlink(outsideFile, path.join(fixture.skillsRoot, "beta", "SKILL.md"));
  await assertPolicyFailure(
    () => buildDelegateResourceSelection(resources, ["beta"]),
    /an approved skill SKILL\.md resolves outside the skills root/,
  );
  // A fresh load catches the same escape at startup validation with the
  // named entry.
  await assertPolicyFailure(
    () => readResourcesFile(fixture.policyPath),
    /skills\.allowed\.beta SKILL\.md resolves outside the skills root/,
  );
});

test("post-selection symlink swaps fail the pre-spawn verification closures", { skip: process.platform === "win32" }, async () => {
  // A runtime-only entry swap: the catalog profile stays valid, the runtime
  // closure fails.
  const fixture = await createFixturePolicy();
  const outside = path.join(fixture.root, "outside-entry.ts");
  await writeFile(outside, "");
  const resources = readResourcesFile(fixture.policyPath);
  const selection = buildDelegateResourceSelection(resources, ["alpha"]);
  await rm(path.join(fixture.extensionsRoot, "codegraph", "index.ts"));
  await symlink(outside, path.join(fixture.extensionsRoot, "codegraph", "index.ts"));
  assert.doesNotThrow(() => selection.verifyCatalogSpawn());
  assert.throws(() => selection.verifyRuntimeSpawn(), /no longer resolves to its validated canonical path/);

  // A catalog entry swap fails both closures, so no spawn of either profile
  // can proceed.
  const catalogFixture = await createFixturePolicy();
  const catalogOutside = path.join(catalogFixture.root, "outside-alias.ts");
  await writeFile(catalogOutside, "");
  const catalogSelection = buildDelegateResourceSelection(readResourcesFile(catalogFixture.policyPath), []);
  await rm(path.join(catalogFixture.extensionsRoot, "openai-codex-aliases", "index.ts"));
  await symlink(catalogOutside, path.join(catalogFixture.extensionsRoot, "openai-codex-aliases", "index.ts"));
  assert.throws(() => catalogSelection.verifyCatalogSpawn(), /no longer resolves to its validated canonical path/);
  assert.throws(() => catalogSelection.verifyRuntimeSpawn(), /no longer resolves to its validated canonical path/);

  // A selected-skill directory swap after selection fails both closures:
  // the catalog closure re-verifies every selected skill as a fail-closed
  // precondition (the catalog argv itself stays alias-only), so the swap
  // blocks the first catalog spawn too, not only the runtime spawn that
  // would carry the `--skill` path.
  const skillFixture = await createFixturePolicy();
  const outsideDir = path.join(skillFixture.root, "outside-skill");
  await mkdir(outsideDir);
  await writeFile(path.join(outsideDir, "SKILL.md"), "# outside\n");
  const skillSelection = buildDelegateResourceSelection(readResourcesFile(skillFixture.policyPath), ["gamma"]);
  await rm(path.join(skillFixture.skillsRoot, "gamma"), { recursive: true });
  await symlink(outsideDir, path.join(skillFixture.skillsRoot, "gamma"));
  assert.throws(() => skillSelection.verifyCatalogSpawn(), /an approved skill no longer resolves to its validated canonical path/);
  assert.throws(() => skillSelection.verifyRuntimeSpawn(), /an approved skill no longer resolves to its validated canonical path/);
});

test("post-selection selected-skill SKILL.md invalidation fails the catalog spawn closure", { skip: process.platform === "win32" }, async () => {
  // A SKILL.md whose symlink resolution escapes the skills root after
  // selection fails both closures, so no child of either profile spawns.
  const swapFixture = await createFixturePolicy();
  const outside = path.join(swapFixture.root, "outside-skill-md.md");
  await writeFile(outside, "# outside\n");
  const swapSelection = buildDelegateResourceSelection(readResourcesFile(swapFixture.policyPath), ["beta"]);
  await rm(path.join(swapFixture.skillsRoot, "beta", "SKILL.md"));
  await symlink(outside, path.join(swapFixture.skillsRoot, "beta", "SKILL.md"));
  assert.throws(() => swapSelection.verifyCatalogSpawn(), /an approved skill SKILL\.md resolves outside the skills root/);
  assert.throws(() => swapSelection.verifyRuntimeSpawn(), /an approved skill SKILL\.md resolves outside the skills root/);

  // A removed SKILL.md after selection fails both closures too.
  const goneFixture = await createFixturePolicy();
  const goneSelection = buildDelegateResourceSelection(readResourcesFile(goneFixture.policyPath), ["gamma"]);
  await rm(path.join(goneFixture.skillsRoot, "gamma", "SKILL.md"));
  assert.throws(() => goneSelection.verifyCatalogSpawn(), /an approved skill disappeared before spawn/);
  assert.throws(() => goneSelection.verifyRuntimeSpawn(), /an approved skill disappeared before spawn/);

  // Only the immutable selection's skills are precondition-checked: an
  // invalidated unselected skill must not fail the catalog closure.
  const unselectedFixture = await createFixturePolicy();
  const unselectedSelection = buildDelegateResourceSelection(readResourcesFile(unselectedFixture.policyPath), ["alpha"]);
  await rm(path.join(unselectedFixture.skillsRoot, "gamma"), { recursive: true });
  assert.doesNotThrow(() => unselectedSelection.verifyCatalogSpawn());
});

test("skill resolution never reads full SKILL.md content", async () => {
  const source = await readFileText(fileURLToPath(new URL("./resources.ts", import.meta.url)));
  // The only file read is the policy document itself; skills are validated
  // through stat calls, so no selected full skill body is ever loaded.
  assert.match(source, /readFileSync\(filePath, "utf8"\)/);
  assert.doesNotMatch(source, /readFile[^(]*\([^)]*SKILL\.md/);
});

// ---- local helpers -------------------------------------------------------

/** Reads fixture file text. */
function readFileText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

/**
 * Duplicates one complete `"key": <value>` member of pretty-printed JSON
 * text. String values are skipped as whole escaped tokens and bracket depth
 * is tracked, so the copied span is exactly the original member.
 */
function duplicateRawKey(raw: string, key: string): string {
  const startMatch = raw.match(new RegExp(`^(\\s*)"${key}"\\s*:`, "m"));
  assert.ok(startMatch, `the fixture must contain key "${key}"`);
  const start = raw.indexOf(startMatch[0]);
  let index = start + startMatch[0].length;
  let depth = 0;
  let inString = false;
  let end = -1;
  while (index < raw.length) {
    const ch = raw[index]!;
    if (inString) {
      if (ch === "\\") index += 1;
      else if (ch === '"') inString = false;
      index += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (ch === "[" || ch === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === "]" || ch === "}") {
      if (depth === 0) {
        end = index;
        break;
      }
      depth -= 1;
      index += 1;
      continue;
    }
    if ((ch === "," || ch === "\n") && depth === 0) {
      end = index;
      break;
    }
    index += 1;
  }
  assert.ok(end > 0, `the fixture must terminate the value of "${key}"`);
  const member = raw.slice(start, end);
  return `${raw.slice(0, start)}${member},\n${startMatch[1]!}${raw.slice(start)}`;
}

function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath).then(() => true, () => false);
}

/**
 * Containment roots for a fixture policy path, mirroring the production
 * layout the loader derives from the policy location.
 */
/** Containment roots for a fixture policy path, mirroring the loader's derivation. */
function rootsFor(policyPath: string): ContainmentRoots {
  const policyDir = realpathSync(path.dirname(policyPath));
  const extensionsRoot = realpathSync(path.resolve(policyDir, ".."));
  const skillsRoot = realpathSync(path.resolve(extensionsRoot, "..", "skills"));
  return { extensionsRoot, skillsRoot, policyDir };
}
