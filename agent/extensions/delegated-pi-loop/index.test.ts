import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("registration guidelines encode the compact automatic delegation policy without route details", async () => {
  const { delegateRunPromptGuidelines } = await import("./instructions.ts");
  const { loadRoutingSnapshot, roleIdsInFamily } = await import("./routing.ts");
  const snapshot = loadRoutingSnapshot();
  const lines = delegateRunPromptGuidelines(
    roleIdsInFamily(snapshot, "solution"),
    roleIdsInFamily(snapshot, "review"),
  );
  assert.equal(lines.length, 15);
  assert.ok(lines.every((line) => line.startsWith("delegate_run ")));
  const guidelines = lines.join("\n");

  assert.match(guidelines, /Use for repository implementation unless the user explicitly opts out/);
  assert.match(guidelines, /Parent may directly make only trivial no-behavior edits/);
  assert.match(guidelines, /Parent directly owns all planning and research deliverables/);
  assert.match(guidelines, /Pure planning or research runs no implementation, review, or remediation/);
  assert.match(guidelines, /Never use implementation or remediation for research or plans/);
  assert.match(guidelines, /exactly one implementation/);

  assert.match(guidelines, /solution-a, solution-b, solution-c, solution-d, solution-e, and solution-f concurrently/);
  assert.match(guidelines, /review-a, review-b, review-c, review-d, and review-e concurrently/);
  assert.match(guidelines, /wait for every role/);
  assert.match(guidelines, /follow the user's next instruction/);
  assert.match(guidelines, /continue, resume, or retry requires no special syntax/);
  assert.doesNotMatch(guidelines, /OVERRIDE:/);
  assert.match(guidelines, /at least one completed report/);
  assert.match(guidelines, /Findings from completed reviews remain binding/);

  assert.match(guidelines, /one fresh read-only oracle unless the parent model is in the configured Oracle model set/);
  assert.match(guidelines, /exclude raw solution reports and parent synthesis rationale/);
  assert.match(guidelines, /Oracle is advisory and returns VALID or REVISE/);
  assert.match(guidelines, /never loops automatically/);
  assert.match(guidelines, /non-completed oracle stops automatic advancement/);
  assert.match(guidelines, /only one implementation, remediation, or oracle at a time/);

  assert.match(guidelines, /Give each fresh verification exactly one finding and no sibling reports/);
  assert.match(guidelines, /batches of at most four/);
  assert.match(guidelines, /dependent findings sequentially/);
  assert.match(guidelines, /without erasing completed siblings/);
  assert.match(guidelines, /only verification-confirmed findings/);
  assert.match(guidelines, /repeat the full review gate until no blocking findings remain/);

  assert.match(guidelines, /Routing and operational fallback are automatic/);
  assert.match(guidelines, /never override oracle or change permissions or concurrency/);
  assert.match(guidelines, /Do not retry automatically beyond bounded fallback/);
  assert.match(guidelines, /separate explicit authorization/);
  assert.match(guidelines, /Selection exposes skills but never forces full loading/);

  const lowered = guidelines.toLowerCase();
  for (const routeDetail of ["gpt-5.5", "gpt-5.6", "codex", "cursor", "ox-alpha", "hy3", "opus", "deepseek", "muse-spark", "glm-", "backend", "z.ai", "zai"]) {
    assert.ok(!lowered.includes(routeDetail), `route detail "${routeDetail}" must not appear in prompt guidelines`);
  }
});

test("the tool schema replaces routine backend selection with an exceptional routing override", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  // The routine backend parameter is gone from the model-visible schema.
  assert.doesNotMatch(source, /backend\s*:/);
  assert.doesNotMatch(source, /backend\?/);
  assert.doesNotMatch(source, /backend=/);
  // The exceptional override is optional with a mandatory non-empty reason.
  assert.match(source, /routingOverride: Type\.Optional\(RoutingOverrideParameters\)/);
  assert.match(source, /reason: Type\.String\(\{\s*\n\s*minLength: 1,/);
  assert.match(source, /excludeProviders: Type\.Optional\(Type\.Array\(Type\.String\(\{ minLength: 1 \}\), \{/);
});

test("registers the optional orchestrator-selected availableSkills parameter", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  // The parameter is optional, built from the validated policy allowlist with
  // StringEnum for provider compatibility, and the progressive-disclosure
  // description sits on the array property, not on the item enum. The
  // description text itself is centralized in instructions.ts.
  assert.match(source, /availableSkills: Type\.Optional\(Type\.Array\(\s*\n\s*StringEnum\(allowedSkillNames\),\s*\n\s*\{\s*\n\s*description: DELEGATE_RUN_PARAMETER_DESCRIPTIONS\.availableSkills,\s*\n\s*\},\s*\n\s*\)\),/);
  // No arbitrary item-count maximum and no forced minimum.
  assert.ok(!source.includes("maxItems"), "availableSkills must not set an item maximum");
  assert.ok(!/availableSkills[\s\S]{0,200}minItems/.test(source), "availableSkills must not require an item minimum");
  // The enum is built from the validated policy's allowed names in policy order.
  assert.match(source, /delegateParameters\(allowedDelegateSkillNames\(delegateResources\), routingSnapshot\)/);
  // The public type carries the optional field.
  const types = await readFile(new URL("./types.ts", import.meta.url), "utf8");
  assert.match(types, /readonly availableSkills\?: readonly string\[\];/);
});

// The extension factory imports bare `typebox` and `@earendil-works/*`
// packages that only Pi's extension loader maps by default. A temporary ESM
// resolve hook resolves exactly those four specifiers against the installed
// Pi package tree, so the test below can import the real `index.ts` under
// plain `node --test` and assert the schema actually handed to registerTool.
const PI_MAPPED_IMPORTS = [
  "typebox",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-coding-agent",
];

const PI_RESOLVE_HOOKS_SOURCE = String.raw`import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL(import.meta.url).searchParams.get("root");
const mapped = ${JSON.stringify(PI_MAPPED_IMPORTS)};

function entryUrlFor(specifier) {
  const pkgDir = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  const pkgJsonPath = pkgDir === "@earendil-works/pi-coding-agent"
    ? join(root, "package.json")
    : join(dirname(dirname(root)), pkgDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const entry = pkg.exports ? pkg.exports["."] : undefined;
  const rel = typeof entry === "string" ? entry : entry?.import ?? entry?.default ?? pkg.main ?? pkg.module;
  if (!rel) throw new Error("no ESM entry for " + specifier);
  return pathToFileURL(join(dirname(pkgJsonPath), rel)).href;
}

export async function resolve(specifier, context, nextResolve) {
  if (!isAbsolute(specifier) && mapped.includes(specifier)) {
    return { url: entryUrlFor(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

/** Locates the installed Pi package through the `pi` executable on PATH. */
function findInstalledPiPackageRoot(): string | undefined {
  const marker = path.join("node_modules", "@earendil-works", "pi-coding-agent");
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      const real = realpathSync(path.join(dir, "pi"));
      const index = real.lastIndexOf(marker);
      if (index >= 0) return real.slice(0, index + marker.length);
    } catch {
      // No pi executable in this PATH entry; keep scanning.
    }
  }
  return undefined;
}

test("the registered availableSkills schema carries the description on the array property, not the item", async () => {
  const piRoot = findInstalledPiPackageRoot();
  assert.ok(piRoot, "the installed Pi package root must be discoverable through the pi executable on PATH");
  const hooksDir = mkdtempSync(path.join(tmpdir(), "pi-delegate-schema-"));
  const hooksPath = path.join(hooksDir, "resolve-hooks.mjs");
  writeFileSync(hooksPath, PI_RESOLVE_HOOKS_SOURCE, "utf8");
  const { register } = await import("node:module");
  register(pathToFileURL(hooksPath).href + "?root=" + encodeURIComponent(piRoot));
  try {
    const extension = await import("./index.ts");
    // The factory reads PI_DELEGATED_CHILD at call time; run the parent
    // branch and restore the value so this test also works inside a
    // delegated child.
    const savedChildFlag = process.env.PI_DELEGATED_CHILD;
    delete process.env.PI_DELEGATED_CHILD;
    const registrations: { name: string; parameters: unknown; promptGuidelines?: readonly string[] }[] = [];
    const fakePi = {
      on: () => {},
      registerCommand: () => {},
      registerTool: (config: { name: string; parameters: unknown; promptGuidelines?: readonly string[] }) => registrations.push(config),
    };
    try {
      (extension.default as (pi: unknown) => void)(fakePi);
    } finally {
      if (savedChildFlag !== undefined) process.env.PI_DELEGATED_CHILD = savedChildFlag;
    }
    assert.equal(registrations.length, 2, "the parent branch registers delegate_run and delegate_model_catalog");
    assert.deepEqual(
      registrations.map((registration) => registration.name),
      ["delegate_run", "delegate_model_catalog"],
    );
    // The parent receives the complete centralized delegation workflow
    // exactly once, through the active delegate_run promptGuidelines.
    const { delegateRunPromptGuidelines, MODEL_CATALOG_PROMPT_GUIDELINES } = await import("./instructions.ts");
    const { loadRoutingSnapshot, roleIdsInFamily } = await import("./routing.ts");
    const snapshot = loadRoutingSnapshot();
    assert.deepEqual(
      registrations[0]?.promptGuidelines,
      [...delegateRunPromptGuidelines(roleIdsInFamily(snapshot, "solution"), roleIdsInFamily(snapshot, "review"))],
      "delegate_run must register the canonical guidelines exactly once",
    );
    assert.equal(registrations[0]?.promptGuidelines?.length, 15);
    assert.deepEqual(registrations[1]?.promptGuidelines, [...MODEL_CATALOG_PROMPT_GUIDELINES]);
    // JSON round-trip mirrors the serialization providers receive: plain
    // JSON Schema keys survive and symbol markers do not.
    const parameters = JSON.parse(JSON.stringify(registrations[0]?.parameters)) as {
      required?: string[];
      properties: Record<string, {
        type?: string;
        description?: string;
        minItems?: number;
        maxItems?: number;
        items?: { enum?: string[]; description?: string; minItems?: number; maxItems?: number }; enum?: string[];
      }>;
    };
    const availableSkills = parameters.properties.availableSkills;
    assert.ok(availableSkills, "the registered schema must carry the availableSkills property");
    assert.equal(availableSkills.type, "array");
    assert.equal(
      availableSkills.description,
      "Approved skills visible to the child; full instructions load only if needed.",
      "the array property must carry the exact progressive-disclosure description",
    );
    assert.equal(
      availableSkills.items?.description,
      undefined,
      "the item enum must not carry the progressive-disclosure description",
    );
    const { allowedDelegateSkillNames, loadDelegateResources } = await import("./resources.ts");
    assert.deepEqual(
      availableSkills.items?.enum,
      [...allowedDelegateSkillNames(loadDelegateResources())],
      "the item enum must stay the exact policy allowlist in policy order",
    );
    assert.equal(availableSkills.minItems, undefined, "no minimum item count on the array");
    assert.equal(availableSkills.maxItems, undefined, "no maximum item count on the array");
    assert.equal(availableSkills.items?.minItems, undefined, "no minimum item count on the item");
    assert.equal(availableSkills.items?.maxItems, undefined, "no maximum item count on the item");
    assert.equal(
      parameters.required?.includes("availableSkills"),
      false,
      "availableSkills must stay optional",
    );
    // The role enum is generated from the same validated routing snapshot
    // the runner consumes: derived ids in canonical registry order.
    const { roleIds } = await import("./routing.ts");
    const role = parameters.properties.role;
    assert.ok(role?.enum, "the role property must carry the generated enum");
    assert.deepEqual(role.enum, [...roleIds(snapshot)]);
    assert.equal(
      role.description,
      "Choose one configured role. Gate members and sequencing are listed in delegate_run guidelines.",
    );
    // The model catalog schema comes from the same snapshot's thinking scale.
    const catalogParameters = JSON.parse(JSON.stringify(registrations[1]?.parameters)) as {
      required?: string[];
      properties: Record<string, {
        type?: string;
        description?: string;
        minimum?: number;
        maximum?: number;
        enum?: string[];
      }>;
    };
    assert.deepEqual(catalogParameters.required, ["query"]);
    assert.equal(catalogParameters.properties.query?.type, "string");
    assert.equal(catalogParameters.properties.provider?.type, "string");
    assert.deepEqual(
      catalogParameters.properties.thinking?.enum,
      [...loadRoutingSnapshot().thinkingLevels],
    );
    assert.equal(catalogParameters.properties.limit?.type, "integer");
    assert.equal(catalogParameters.properties.limit?.minimum, 1);
    assert.equal(catalogParameters.properties.limit?.maximum, 20);
    assert.equal(catalogParameters.required?.includes("limit"), false);
    // The dynamic guidelines resolve against the shipped snapshot and name
    // every configured solution and review role without redundant count words.
    const delegateRunGuidelines = (registrations[0]?.promptGuidelines ?? []).join("\n");
    assert.match(delegateRunGuidelines, /solution-a, solution-b, solution-c, solution-d, solution-e, and solution-f concurrently/);
    assert.match(delegateRunGuidelines, /review-a, review-b, review-c, review-d, and review-e concurrently/);
    assert.match(delegateRunGuidelines, /wait for every role/);
    assert.match(delegateRunGuidelines, /repeat the full review gate until no blocking findings remain/);
    // No concrete route detail leaks into the generated guidance.
    const loweredGuidelines = delegateRunGuidelines.toLowerCase();
    for (const routeDetail of ["gpt-5.5", "gpt-5.6", "codex", "glm-", "zai", "opencode-go", "openrouter"]) {
      assert.ok(!loweredGuidelines.includes(routeDetail), `generated guidance must not contain ${routeDetail}`);
    }
    // The catalog guidance stays concise and does not enumerate combinations.
    const catalogGuidelines = (registrations[1]?.promptGuidelines ?? []).join("\n");
    assert.match(catalogGuidelines, /partial or unknown model/);
    assert.match(catalogGuidelines, /choose only a returned compatible combination/);
    for (const routeDetail of ["gpt-5.5", "gpt-5.6", "codex", "glm-", "zai"]) {
      assert.ok(!catalogGuidelines.includes(routeDetail), `catalog guidance must not contain ${routeDetail}`);
    }
    // Child mode registers neither tool: the early child branch returns
    // before any parent-only registration, so children receive none of the
    // parent tool guidelines.
    const childRegistrations: { name: string }[] = [];
    const fakeChildPi = {
      on: () => {},
      registerCommand: () => {},
      registerTool: (config: { name: string }) => childRegistrations.push(config),
    };
    const savedChildFlag2 = process.env.PI_DELEGATED_CHILD;
    process.env.PI_DELEGATED_CHILD = "1";
    try {
      (extension.default as (pi: unknown) => void)(fakeChildPi);
    } finally {
      if (savedChildFlag2 === undefined) delete process.env.PI_DELEGATED_CHILD;
      else process.env.PI_DELEGATED_CHILD = savedChildFlag2;
    }
    assert.deepEqual(childRegistrations, [], "child mode must register neither delegate_run nor delegate_model_catalog");
  } finally {
    rmSync(hooksDir, { recursive: true, force: true });
  }
});

test("the model catalog guidance stays concise and keeps overrides exceptional", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const instructions = await readFile(new URL("./instructions.ts", import.meta.url), "utf8");
  // index.ts wires the centralized metadata; the concise guidance text
  // itself lives only in instructions.ts.
  const registrationStart = source.indexOf(`name: DELEGATE_MODEL_CATALOG_TOOL.name`);
  assert.ok(registrationStart >= 0, "delegate_model_catalog registration not found");
  const registration = source.slice(registrationStart, source.indexOf("});", registrationStart));
  assert.match(registration, /promptSnippet: DELEGATE_MODEL_CATALOG_TOOL\.promptSnippet/);
  assert.match(registration, /promptGuidelines: MODEL_CATALOG_PROMPT_GUIDELINES/);
  assert.match(instructions, /Use only to resolve a partial or unknown model in an explicit user or project request for a one-run operational override/);
  assert.match(instructions, /choose only a returned compatible combination/);
  assert.match(instructions, /Lookup changes nothing/);
  assert.match(instructions, /never allowed for oracle/);
  // The catalog is never appended to the delegate_run schema or guidance.
  const delegateRunRegistration = source.slice(
    source.indexOf(`name: DELEGATE_RUN_TOOL.name`),
    registrationStart,
  );
  assert.ok(!delegateRunRegistration.includes("delegate_model_catalog"));
  // The catalog receives only its own concise guidelines, never the parent
  // delegation workflow.
  const catalogGuidelines = instructions.slice(
    instructions.indexOf("export const MODEL_CATALOG_PROMPT_GUIDELINES"),
    instructions.indexOf("export const DELEGATE_RUN_PARAMETER_DESCRIPTIONS"),
  );
  for (const workflow of ["waive", "solution gate", "review gate", "implementation delegate", "availableSkills", "oracle review of the draft solution contract"]) {
    assert.ok(!catalogGuidelines.includes(workflow), `catalog guidance must stay workflow-free (found ${workflow})`);
  }
  // No model/provider/thinking combination is enumerated in either module.
  for (const forbidden of ["gpt-5.5", "gpt-5.6-sol", "glm-5.3", "openai-codex", "zai", "opencode-go"]) {
    assert.ok(!source.includes(forbidden), `index.ts must not enumerate concrete models or providers (found ${forbidden})`);
    assert.ok(!instructions.includes(forbidden), `instructions.ts must not enumerate concrete models or providers (found ${forbidden})`);
  }
});

test("dynamic guidance regenerates naturally for a resized routing snapshot", async () => {
  const { delegateRunPromptGuidelines } = await import("./instructions.ts");
  const guidelines = delegateRunPromptGuidelines(
    ["solution-a", "solution-b", "solution-c"],
    ["review-a", "review-b"],
  ).join("\n");
  assert.match(guidelines, /run solution-a, solution-b, and solution-c concurrently with the same neutral assignment and wait for every role/);
  assert.match(guidelines, /run review-a and review-b concurrently with the same neutral scope; wait for every role/);
  assert.doesNotMatch(guidelines, /all three|all two|reviewer gate/);
  // Single-role gates still read naturally.
  const single = delegateRunPromptGuidelines(["solution-a"], ["review-a"]).join("\n");
  assert.match(single, /run solution-a concurrently with the same neutral assignment and wait for every role/);
  assert.match(single, /run review-a concurrently with the same neutral scope; wait for every role/);
});

test("availableSkills guidance states the concise progressive-disclosure semantics", async () => {
  const source = await readFile(new URL("./instructions.ts", import.meta.url), "utf8");
  // The availableSkills line lives in the canonical guidelines builder.
  const guidelinesStart = source.indexOf("export function delegateRunPromptGuidelines(");
  assert.ok(guidelinesStart >= 0, "delegateRunPromptGuidelines builder not found");
  const guidelines = source.slice(guidelinesStart, source.indexOf("\n}\n", guidelinesStart));
  assert.match(guidelines, /Pass only task-relevant pre-approved availableSkills\. Selection exposes skills but never forces full loading\./);
  // No blanket forced-read instruction and no skill-name inventory in guidance.
  assert.doesNotMatch(guidelines, /read every selected skill/i);
  assert.doesNotMatch(guidelines, /\/skill:/);
  assert.doesNotMatch(guidelines, /firebase|figma|gh-cli|linear-cli|pp-posthog/);
});

test("the delegated-child branch stays minimal and returns before parent-only resource loading", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const childCheck = source.indexOf('process.env.PI_DELEGATED_CHILD === "1"');
  const policyLoad = source.indexOf("loadDelegateResources()");
  assert.ok(childCheck >= 0 && policyLoad > childCheck, "the child branch must return before policy loading");
  const childReturn = source.indexOf("return;", childCheck);
  assert.ok(childReturn > childCheck && childReturn < policyLoad, "the child branch must return before policy loading");
  // Skill selection resolves before manager admission, artifact creation, or spawn.
  const selection = source.indexOf("buildDelegateResourceSelection(delegateResources");
  const admission = source.indexOf("manager.begin(toolCallId");
  assert.ok(selection >= 0 && admission > selection, "resource selection must precede manager admission");
  const runCall = source.indexOf("await runDelegate({");
  assert.ok(runCall > selection && source.slice(runCall, runCall + 400).includes("resourceSelection,"));
});

test("a non-array runtime availableSkills value fails the exact bounded error before admission or spawn", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  // execute hands the untrusted runtime value straight to the selection
  // build; resources.ts rejects any defined non-array (string, object,
  // number, boolean, null) with the exact bounded error before a length is
  // read or an entry is iterated. The string and object regressions for
  // that rejection are pinned in resources.test.ts; this pins that the only
  // availableSkills consumer in execute is the pre-admission selection
  // build, so the rejection necessarily precedes manager admission,
  // private artifact creation, and any child spawn.
  assert.match(
    source,
    /buildDelegateResourceSelection\(delegateResources, params\.availableSkills\)/,
  );
  const executeStart = source.indexOf("async execute(toolCallId");
  const executeEnd = source.indexOf("renderCall:", executeStart);
  const executeBody = executeStart >= 0 && executeEnd > executeStart ? source.slice(executeStart, executeEnd) : "";
  assert.ok(executeBody.length > 0, "the execute body must be found");
  assert.equal(
    executeBody.match(/availableSkills/g)?.length ?? 0,
    1,
    "execute must consume availableSkills only through the selection build",
  );
  const selection = source.indexOf("buildDelegateResourceSelection(delegateResources");
  const admission = source.indexOf("manager.begin(toolCallId");
  const runCall = source.indexOf("await runDelegate({");
  assert.ok(selection >= 0 && admission > selection && runCall > admission);
});

test("no forced skill loading appears in model-visible guidance or child prompts", async () => {
  const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const instructions = await readFile(new URL("./instructions.ts", import.meta.url), "utf8");
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const runner = await readFile(new URL("./runner.ts", import.meta.url), "utf8");
  // Nothing appends skill bodies, forces /skill:name expansion, or instructs a
  // blanket read of every selected SKILL.md.
  for (const source of [index, instructions, routes, runner]) {
    assert.doesNotMatch(source, /--append-system-prompt/);
    assert.doesNotMatch(source, /\/skill:/);
    assert.doesNotMatch(source, /readFile[^(]*\([^)]*SKILL\.md/);
  }
  assert.doesNotMatch(routes, /skill/i);
});

test("the fixed child extension profile excludes package, presentation, and project extensions", async () => {
  const policy = JSON.parse(await readFile(new URL("./resources.json", import.meta.url), "utf8")) as {
    extensions: { catalog: string[]; runtime: string[] };
  };
  assert.deepEqual(policy.extensions.catalog, ["../openai-codex-aliases/index.ts"]);
  assert.deepEqual(policy.extensions.runtime, [
    "./index.ts",
    "../openai-codex-aliases/index.ts",
    "../web-search/index.ts",
    "../context-mode/src/index.ts",
    "../codegraph/index.ts",
  ]);
  // Extension selection stays fixed by the policy: local presentation
  // extensions, configured package extensions, and every project or future
  // extension stay outside the allowlist, so delegated children register no
  // BTW, Claude Bridge, Cursor, Fastlane, footer, or theme behavior.
  const extensionsText = JSON.stringify(policy.extensions);
  for (const forbidden of ["fastlane", "footer", "theme-overrides", "pi-blackhole", "pi-btw", "pi-browser-harness", "pi-claude-bridge", "pi-cursor"]) {
    assert.ok(!extensionsText.includes(forbidden), `the child resource policy must not load ${forbidden}`);
  }
  // Extension selection is never model-controlled.
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("availableExtensions"), "extension selection must stay fixed, not model-controlled");
});

test("public schema and runtime contain no direct Claude CLI backend", async () => {
  const files = ["index.ts", "instructions.ts", "routing.ts", "routes.ts", "runner.ts", "supervisor.ts", "types.ts"];
  const forbidden = [
    "ClaudeRoute", "CLAUDE_ROUTE", "superviseClaude", "spawn(\"claude\"", "--print",
    "--no-session-persistence", "permission-mode", "allowedTools", "disallowedTools",
    "claude-code/", "protocol: \"plain\"", "backend=claude",
    "DelegateBackend", "DELEGATE_BACKENDS",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    for (const value of forbidden) assert.ok(!source.includes(value), `${file} must not contain ${value}`);
  }
  const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(index, /StringEnum\(roleIds\(routing\)/);
  // The role enum derives from the validated routing snapshot, not a
  // compile-time union: registration and runtime share one registry.
  assert.match(index, /const routingSnapshot = loadRoutingSnapshot\(\)/);
  assert.match(index, /role: params\.role,\n\s+routingConfig: routingSnapshot,/);
});

test("registers targeted delegate list and stop commands without a BTW control path", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const renderSource = await readFile(new URL("./render.ts", import.meta.url), "utf8");
  assert.match(source, /registerCommand\("delegate:list"/);
  assert.match(source, /const labels = active\.map\(activeDelegateLabel\)/);
  assert.match(source, /select\("Active delegates", labels\)/);
  assert.match(source, /setEditorText\(`\/delegate:stop \$\{delegate\.id\}`\)/);
  assert.match(source, /registerCommand\("delegate:stop"/);
  assert.match(source, /manager\.stop\(delegateId\)/);
  assert.match(source, /Delegate #\$\{delegateId\} is no longer active/);
  assert.match(renderSource, /`Delegate \$\{id\}`/);
  assert.match(renderSource, /`⏳ \$\{id\}\$\{progress\.label\}`/);
  assert.match(renderSource, /`\$\{id\}\$\{String\(state\)\}`/);
  assert.doesNotMatch(source, /btw:delegate/);
  // The live render surfaces bounded restart-after-work metadata.
  assert.match(renderSource, /restarts: \$\{progress\.restartAfterWorkCount\}/);
  assert.match(renderSource, /restarts after work: \$\{progress\.restartAfterWorkCount\}/);
  // The call render marks an exceptional override without route details.
  assert.match(renderSource, /args\.routingOverride !== undefined \? " override" : ""/);
});
