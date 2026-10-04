import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import fsPromises, { readFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import type { CodexUsageCache, CodexUsageCacheOptions } from "./codex-usage-cache.ts";
import type { DelegateRunResult, DelegateToolParams, RunOptions, ToolDefinition, ToolResult } from "./types.ts";

test("registration guidelines encode the compact automatic delegation policy without route details", async () => {
  const { delegateRunPromptGuidelines } = await import("./instructions.ts");
  const lines = delegateRunPromptGuidelines(
    ["solution-a", "solution-b", "solution-c"],
    ["review-a", "review-b"],
  );
  assert.equal(lines.length, 16);
  assert.ok(lines.every((line) => line.startsWith("delegate_run ")));
  const guidelines = lines.join("\n");

  assert.match(guidelines, /Use implementation delegation for non-trivial repository implementation/);
  assert.match(guidelines, /parent handles simple, mechanical, and low-risk tasks directly/i);
  assert.match(guidelines, /explicitly requested Git operations/);
  assert.match(guidelines, /executes the task directly without a delegate/);
  assert.match(guidelines, /Parent directly owns all planning and research deliverables/);
  assert.match(guidelines, /Pure planning or research runs no implementation, review, or remediation/);
  assert.match(guidelines, /Never use implementation or remediation for research or plans/);
  assert.match(guidelines, /non-trivial task with an accepted solution contract/);
  assert.match(guidelines, /exactly one fresh implementation delegate per increment/);
  assert.match(guidelines, /contract for delegated implementation/);

  assert.match(guidelines, /solution-a, solution-b, and solution-c concurrently/);
  assert.match(guidelines, /review-a and review-b concurrently/);
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

test("runtime and routing checker sources never load the test-only routing fixture", async () => {
  for (const file of ["index.ts", "routing.ts", "runner.ts", "check-routing.ts"]) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /routing\.(?:test-)?fixture/, `${file} must use routing.json, not the test fixture`);
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

test("active bash command never enters ToolResult details or compact, expanded, and progress rendering", async () => {
  const piRoot = findInstalledPiPackageRoot();
  assert.ok(piRoot);
  const hooksDir = mkdtempSync(path.join(tmpdir(), "pi-delegate-render-"));
  const hooksPath = path.join(hooksDir, "resolve-hooks.mjs");
  writeFileSync(hooksPath, PI_RESOLVE_HOOKS_SOURCE, "utf8");
  const { register } = await import("node:module");
  register(pathToFileURL(hooksPath).href + "?root=" + encodeURIComponent(piRoot));
  try {
    const { finalToolResult } = await import("./result.ts");
    const { failureDiagnostic, schemaNineRecord } = await import("./diagnostics.ts");
    const { renderDelegateResult } = await import("./render.ts");
    const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    for (const state of ["stalled", "completed"] as const) {
      const result: DelegateRunResult = {
        label: "implementation", role: "implementation", state,
        report: "Done\n\nDELEGATE_RESULT: COMPLETED", artifactDir: "/tmp/not-read",
        activeBashCommand: { text: "COMMAND-SENTINEL", totalBytes: 16, truncatedBytes: 0 },
        supervisedProviderIds: ["TRACKING-SUPERVISED"], quotaFailedProviderIds: ["TRACKING-QUOTA"],
        attempts: [], startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z",
        elapsedSeconds: 1, streamErrors: [],
        progress: {
          label: "implementation", role: "implementation", state, protocol: "pi-rpc", attempt: 1,
          phase: "tool", lastEvent: "tool_execution_start", lastEventDetail: "bash",
          lastEventAt: "2026-01-01T00:00:00.000Z", activityIdleSeconds: 1, elapsedSeconds: 1,
          toolExecutionCount: 1, activityWarningCount: 0, progressWarningCount: 0,
          activityEventCount: 1, structuralProgressCount: 1, duplicateCheckpointCount: 0,
          restartAfterWorkCount: 0, reportNudgeCount: 0, reportRound: 1,
          activeToolCount: 1, activeToolName: "bash",
        },
      };
      const toolResult = finalToolResult(result);
      assert.doesNotMatch(JSON.stringify(toolResult), /COMMAND-SENTINEL|activeBashCommand|TRACKING|supervisedProviderIds|quotaFailedProviderIds/);
      for (const surface of [failureDiagnostic(result), schemaNineRecord(result), result.progress, result.report]) {
        assert.doesNotMatch(JSON.stringify(surface), /TRACKING|supervisedProviderIds|quotaFailedProviderIds/);
      }
      for (const expanded of [false, true]) {
        for (const isPartial of [false, true]) {
          const rendered = renderDelegateResult(toolResult, { expanded, isPartial }, theme, {}).render(120).join("\n");
          assert.match(rendered, /implementation/);
          assert.doesNotMatch(rendered, /COMMAND-SENTINEL|activeBashCommand|TRACKING|supervisedProviderIds|quotaFailedProviderIds/);
        }
      }
    }
    // Pi omits details when execute throws; this result must not get a success checkmark.
    const thrown = renderDelegateResult(
      { content: [{ type: "text", text: "Delegated session history validation failed" }] },
      { expanded: false, isPartial: false }, theme, {},
    ).render(120).join("\n");
    assert.match(thrown, /^✗ failed/);
    assert.doesNotMatch(thrown, /✓|completed/);
  } finally {
    rmSync(hooksDir, { recursive: true, force: true });
  }
});

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
    const registrations: { name: string; description: string; parameters: unknown; promptGuidelines?: readonly string[] }[] = [];
    const fakePi = {
      on: () => {},
      registerCommand: () => {},
      registerTool: (config: { name: string; description: string; parameters: unknown; promptGuidelines?: readonly string[] }) => registrations.push(config),
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
    const { DELEGATE_RUN_TOOL, delegateRunPromptGuidelines, MODEL_CATALOG_PROMPT_GUIDELINES } = await import("./instructions.ts");
    assert.equal(registrations[0]?.description, DELEGATE_RUN_TOOL.description);
    assert.match(registrations[0]!.description, /Returns completed and valid intentional BLOCKED\/FAILED Markdown reports; operational failures remain sanitized tool errors/);
    const { loadRoutingSnapshot, roleIdsInFamily } = await import("./routing.ts");
    const snapshot = loadRoutingSnapshot();
    assert.deepEqual(
      registrations[0]?.promptGuidelines,
      [...delegateRunPromptGuidelines(roleIdsInFamily(snapshot, "solution"), roleIdsInFamily(snapshot, "review"))],
      "delegate_run must register the canonical guidelines exactly once",
    );
    assert.equal(registrations[0]?.promptGuidelines?.length, 16);
    assert.deepEqual(registrations[1]?.promptGuidelines, [...MODEL_CATALOG_PROMPT_GUIDELINES]);
    // JSON round-trip mirrors the serialization providers receive: plain
    // JSON Schema keys survive and symbol markers do not.
    const parameters = JSON.parse(JSON.stringify(registrations[0]?.parameters)) as {
      required?: string[];
      properties: Record<string, {
        type?: string;
        default?: boolean;
        description?: string;
        minItems?: number;
        maxItems?: number;
        items?: { enum?: string[]; description?: string; minItems?: number; maxItems?: number }; enum?: string[];
      }>;
    };
    const fastlane = parameters.properties.fastlane;
    assert.equal(fastlane?.type, "boolean");
    assert.equal(fastlane?.default, false);
    assert.equal(parameters.required?.includes("fastlane"), false);
    assert.match(fastlane?.description ?? "", /increases subscription usage/);
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
    // The dynamic guidelines resolve against the operator snapshot and name
    // every configured solution and review role without pinning their counts.
    const delegateRunGuidelines = (registrations[0]?.promptGuidelines ?? []).join("\n");
    for (const roleId of [
      ...roleIdsInFamily(snapshot, "solution"),
      ...roleIdsInFamily(snapshot, "review"),
    ]) {
      assert.ok(delegateRunGuidelines.includes(roleId), `generated guidance must name ${roleId}`);
    }
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
  // Import paths can name provider helpers without enumerating concrete routes.
  const implementation = source.replace(/^import .* from .*;$/gm, "");
  // No model/provider/thinking combination is enumerated in either module.
  for (const forbidden of ["gpt-5.5", "gpt-5.6-sol", "glm-5.3", "openai-codex", "zai", "opencode-go"]) {
    assert.ok(!implementation.includes(forbidden), `index.ts must not enumerate concrete models or providers (found ${forbidden})`);
    assert.ok(!instructions.includes(forbidden), `instructions.ts must not enumerate concrete models or providers (found ${forbidden})`);
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function loadExtensionForTest(t: TestContext) {
  const piRoot = findInstalledPiPackageRoot();
  assert.ok(piRoot);
  const root = mkdtempSync(path.join(tmpdir(), "pi-delegate-lifecycle-"));
  const hooksPath = path.join(root, "resolve-hooks.mjs");
  writeFileSync(hooksPath, PI_RESOLVE_HOOKS_SOURCE, "utf8");
  const { register } = await import("node:module");
  register(pathToFileURL(hooksPath).href + "?root=" + encodeURIComponent(piRoot));
  const savedChildFlag = process.env.PI_DELEGATED_CHILD;
  const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_DELEGATED_CHILD;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (savedChildFlag === undefined) delete process.env.PI_DELEGATED_CHILD;
    else process.env.PI_DELEGATED_CHILD = savedChildFlag;
    if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
    rmSync(root, { recursive: true, force: true });
  });
  return { root, extension: (await import("./index.ts")).default };
}

function lifecycleResult(artifactDir: string): DelegateRunResult {
  return {
    label: "solution-a", role: "solution-a", state: "completed", artifactDir,
    report: "Done\n\nDELEGATE_RESULT: COMPLETED", attempts: [], streamErrors: [],
    startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z", elapsedSeconds: 1,
    progress: {
      label: "solution-a", role: "solution-a", state: "completed", protocol: "pi-rpc", attempt: 1,
      phase: "settled", lastEvent: "agent_settled", lastEventAt: "2026-01-01T00:00:01.000Z",
      activityIdleSeconds: 0, elapsedSeconds: 1, toolExecutionCount: 0,
      activityWarningCount: 0, progressWarningCount: 0, activityEventCount: 1,
      structuralProgressCount: 1, duplicateCheckpointCount: 0, restartAfterWorkCount: 0,
      reportNudgeCount: 0, reportRound: 1,
    },
  };
}

test("Fastlane rendering shows only strict requested and confirmed configuration, including restored details", async (t) => {
  await loadExtensionForTest(t);
  const { renderDelegateCall, renderDelegateResult } = await import("./render.ts");
  const { finalToolResult } = await import("./result.ts");
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const args = { role: "solution-a", prompt: "test", fastlane: true };
  assert.doesNotMatch(renderDelegateCall(args, theme, {}).render(160).join("\n"), /fastlane/);
  for (const requested of [true, false, undefined, "true", 1]) {
    for (const state of ["enabled", "inactive", "unknown", undefined, true, "PRIVATE-STATE", ["enabled"]]) {
      for (const catalog of [false, true]) {
        const base = lifecycleResult("/tmp/not-read");
        const progress = { ...base.progress, fastlaneRequested: requested, fastlaneState: state,
          state: catalog ? "catalog_check" : "completed", phase: catalog ? "catalog" : "settled" };
        // Exercise both production sanitization and untrusted historical details.
        const sanitized = finalToolResult({ ...base, progress } as DelegateRunResult);
        const raw = { ...sanitized, details: { ...sanitized.details, progress } };
        const expected = requested === true && state === "enabled" && !catalog;
        for (const result of [sanitized, JSON.parse(JSON.stringify(raw))]) {
          for (const isPartial of [false, true]) {
            const context = { state: {} };
            const rendered = renderDelegateResult(result, { expanded: false, isPartial }, theme, context).render(160).join("\n");
            assert.equal(rendered.includes("fastlane"), expected);
            assert.doesNotMatch(rendered, /PRIVATE-STATE/);
            assert.equal(renderDelegateCall(args, theme, context).render(160).join("\n").includes("fastlane"), expected);
            assert.doesNotMatch(renderDelegateCall(args, theme, context, 1, false).render(160).join("\n"), /fastlane/);
            assert.doesNotMatch(renderDelegateCall({ ...args, fastlane: false }, theme, context).render(160).join("\n"), /fastlane/);
          }
        }
      }
    }
  }
});

test("installed Pi call-first restored partial and final rows refresh Fastlane before the first frame", async (t) => {
  const { extension } = await loadExtensionForTest(t);
  let tool: ToolDefinition<DelegateToolParams> | undefined;
  extension({
    on: () => {}, registerCommand: () => {},
    registerTool: (config: { name: string }) => { if (config.name === "delegate_run") tool = config as ToolDefinition<DelegateToolParams>; },
  });
  assert.ok(tool);
  const piRoot = findInstalledPiPackageRoot()!;
  const { initTheme } = await import(pathToFileURL(path.join(piRoot, "dist/modes/interactive/theme/theme.js")).href);
  const { ToolExecutionComponent } = await import(pathToFileURL(path.join(piRoot, "dist/modes/interactive/components/tool-execution.js")).href);
  initTheme("dark", false);
  const { finalToolResult } = await import("./result.ts");
  const base = lifecycleResult("/tmp/not-read");
  const enabled = { ...base.progress, fastlaneRequested: true, fastlaneState: "enabled" };
  const resultWith = (progress: unknown): ToolResult => ({
    ...finalToolResult(base), details: { state: "completed", delegateId: 7, progress },
  });
  let renderRequests = 0;
  const order: string[] = [];
  const definition = { ...tool,
    renderCall: (...args: Parameters<NonNullable<ToolDefinition<DelegateToolParams>["renderCall"]>>) => { order.push("call"); return tool!.renderCall!(...args); },
    renderResult: (...args: Parameters<NonNullable<ToolDefinition<DelegateToolParams>["renderResult"]>>) => { order.push("result"); return tool!.renderResult!(...args); },
  };
  const row = (id: string, fastlane: unknown = true) => new ToolExecutionComponent(
    "delegate_run", id, { role: "solution-a", prompt: id, fastlane }, {}, definition,
    { requestRender: () => { renderRequests++; } }, "/tmp",
  );
  const frame = (component: InstanceType<typeof ToolExecutionComponent>) => component.render(160).join("\n");
  const callLine = (component: InstanceType<typeof ToolExecutionComponent>) => frame(component).split("\n").find((line: string) => line.includes("Delegate "))!;
  const clearing = [
    undefined, null, "malformed", {},
    { ...enabled, fastlaneRequested: undefined }, { ...enabled, fastlaneRequested: false },
    { ...enabled, fastlaneRequested: "true" }, { ...enabled, fastlaneRequested: 1 },
    { ...enabled, fastlaneState: undefined }, { ...enabled, fastlaneState: "inactive" },
    { ...enabled, fastlaneState: "unknown" }, { ...enabled, fastlaneState: ["enabled"] },
    { ...enabled, fastlaneState: "PRIVATE-STATE" },
    { ...enabled, state: "catalog_check" }, { ...enabled, phase: "catalog" },
  ];
  for (const isPartial of [true, false]) {
    const first = row(`restored-${isPartial}`);
    const second = row(`other-${isPartial}`);
    assert.doesNotMatch(callLine(first), /fastlane/);
    for (const progress of clearing) {
      order.length = 0;
      first.updateResult(JSON.parse(JSON.stringify(resultWith(enabled))), isPartial);
      assert.deepEqual(order, ["call", "result"]);
      assert.match(callLine(first), /fastlane/);
      assert.match(callLine(first), /#7/);
      assert.match(callLine(first), /fastlane/); // A repeated cached frame must stay correct.
      assert.doesNotMatch(callLine(second), /fastlane/);
      second.updateResult(JSON.parse(JSON.stringify(resultWith(enabled))), isPartial);
      first.updateResult(JSON.parse(JSON.stringify(resultWith(progress))), isPartial);
      assert.doesNotMatch(callLine(first), /fastlane/);
      assert.doesNotMatch(frame(first), /fastlane|PRIVATE-STATE/);
      assert.match(callLine(second), /fastlane/);
      second.updateResult(resultWith(undefined), isPartial);
    }
    for (const requested of [undefined, false, "true", 1]) {
      const unrequested = row(`unrequested-${String(requested)}`, requested);
      // Undefined is an omitted argument, not the helper's default true.
      if (requested === undefined) unrequested.updateArgs({ role: "solution-a", prompt: "omitted" });
      unrequested.updateResult(resultWith(enabled), isPartial);
      assert.doesNotMatch(callLine(unrequested), /fastlane/);
    }
  }
  assert.equal(renderRequests, 0, "result refresh must not recurse through invalidate/requestRender");
});

test("call-first result refresh keeps active manager false authoritative over restored confirmation", async (t) => {
  await loadExtensionForTest(t);
  const { renderDelegateCall, renderDelegateResult } = await import("./render.ts");
  const { finalToolResult } = await import("./result.ts");
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const base = lifecycleResult("/tmp/not-read");
  const result = finalToolResult({ ...base, progress: { ...base.progress, fastlaneRequested: true, fastlaneState: "enabled" } });
  const context = { state: { fastlaneEnabled: true } };
  const call = renderDelegateCall({ role: "solution-a", prompt: "test", fastlane: true }, theme, context, 1, false);
  renderDelegateResult(result, { expanded: false, isPartial: false }, theme, context);
  assert.doesNotMatch(call.render(160).join("\n"), /fastlane/);
});

test("Fastlane forwarding defaults off and concurrent call, progress, final, and list indicators stay isolated", async (t) => {
  for (const admittedFirst of ["requested", "defaulted"] as const) {
    await t.test(`${admittedFirst} admitted first`, async (t) => {
      const { root, extension } = await loadExtensionForTest(t);
      const { finalToolResult } = await import("./result.ts");
      const realpathGates = [
        { entered: deferred<void>(), release: deferred<void>() },
        { entered: deferred<void>(), release: deferred<void>() },
      ];
      const originalRealpath = fsPromises.realpath;
      let nextGate = 0;
      const realpathMock = t.mock.method(fsPromises, "realpath", async (candidate: string) => {
        const gate = realpathGates[nextGate++];
        const cwd = await originalRealpath(candidate);
        if (gate) {
          gate.entered.resolve();
          await gate.release.promise;
        }
        return cwd;
      });
      // Update index.ts's named builtin import so admission waits for these gates.
      syncBuiltinESMExports();
      t.after(() => {
        realpathMock.mock.restore();
        syncBuiltinESMExports();
      });
      const admissions = new Map(["requested", "defaulted", "false"].map((prompt) => [prompt, deferred<void>()]));
      let tool: ToolDefinition<DelegateToolParams> | undefined;
      const commands = new Map<string, { handler: (args: string, ctx: unknown) => unknown }>();
      const pending = new Map<string, { options: RunOptions; done: ReturnType<typeof deferred<DelegateRunResult>> }>();
      extension({
        on: () => {},
        registerCommand: (name, command) => { commands.set(name, command as unknown as { handler: (args: string, ctx: unknown) => unknown }); },
        registerTool: (config: { name: string }) => { if (config.name === "delegate_run") tool = config as ToolDefinition<DelegateToolParams>; },
      }, {
        createUsageCache: async () => ({ getFreshSnapshot: () => Object.freeze({}), invalidate: async () => {}, refresh: async () => {} }),
        runDelegate: (options) => {
          const done = deferred<DelegateRunResult>();
          pending.set(options.prompt, { options, done });
          admissions.get(options.prompt)!.resolve();
          return done.promise;
        },
        finalizeDelegateRun: async (result) => finalToolResult(result),
      });
      assert.ok(tool);
      const ctx = { cwd: root, modelRegistry: { getProviderAuth: async () => undefined } };
      const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
      const requested = { role: "solution-a", prompt: "requested", fastlane: true };
      const defaulted = { role: "solution-a", prompt: "defaulted" };
      const updates: ToolResult[] = [];
      const first = tool.execute("first", requested, undefined, (result) => updates.push(result), ctx);
      const second = tool.execute("second", defaulted, undefined, undefined, ctx);
      await Promise.all(realpathGates.map((gate) => gate.entered.promise));
      const firstGate = admittedFirst === "requested" ? 0 : 1;
      realpathGates[firstGate]!.release.resolve();
      await admissions.get(admittedFirst)!.promise;
      assert.equal(pending.size, 1);
      realpathGates[1 - firstGate]!.release.resolve();
      await Promise.all([admissions.get("requested")!.promise, admissions.get("defaulted")!.promise]);
      assert.equal(pending.get("requested")!.options.fastlane, true);
      assert.equal(pending.get("defaulted")!.options.fastlane, false);
      assert.doesNotMatch(tool.renderCall!(requested, theme, { toolCallId: "first" }).render(160).join("\n"), /fastlane/);
      const base = lifecycleResult(root);
      const enabled = { ...base.progress, state: "running" as const, fastlaneRequested: true, fastlaneState: "enabled" as const };
      const omitted = { ...enabled, fastlaneRequested: false };
      pending.get("requested")!.options.onProgress!(enabled);
      const requestedId = updates.at(-1)!.details?.delegateId;
      assert.equal(requestedId, admittedFirst === "requested" ? 1 : 2);
      pending.get("defaulted")!.options.onProgress!(omitted);
      assert.match(tool.renderCall!(requested, theme, { toolCallId: "first" }).render(160).join("\n"), /fastlane/);
      assert.doesNotMatch(tool.renderCall!(defaulted, theme, { toolCallId: "second" }).render(160).join("\n"), /fastlane/);
      assert.match(tool.renderResult!(updates.at(-1)!, { expanded: false, isPartial: true }, theme, {}).render(160).join("\n"), /fastlane/);
      let labels: string[] = [];
      const list = async () => commands.get("delegate:list")!.handler("", { hasUI: true, ui: {
        select: async (_title: string, options: string[]) => { labels = options; return undefined; },
      } });
      await list();
      assert.equal(labels.length, 2);
      const requestedPrefix = `#${requestedId}  `;
      const requestedLabel = labels.find((label) => label.startsWith(requestedPrefix));
      const defaultedLabel = labels.find((label) => !label.startsWith(requestedPrefix));
      assert.ok(requestedLabel);
      assert.ok(defaultedLabel);
      assert.notEqual(defaultedLabel, requestedLabel);
      assert.match(requestedLabel, /fastlane/);
      assert.doesNotMatch(defaultedLabel, /fastlane/);
      pending.get("requested")!.options.onProgress!({ ...enabled, state: "catalog_check", phase: "catalog" });
      await list();
      assert.doesNotMatch(labels.join("\n"), /fastlane/);
      assert.doesNotMatch(tool.renderCall!(requested, theme, { toolCallId: "first", state: { fastlaneEnabled: true } }).render(160).join("\n"), /fastlane/);
      pending.get("requested")!.done.resolve({ ...base, progress: { ...enabled, state: "completed" } });
      pending.get("defaulted")!.done.resolve({ ...base, progress: omitted });
      const [firstResult, secondResult] = await Promise.all([first, second]);
      assert.match(tool.renderResult!(JSON.parse(JSON.stringify(firstResult)), { expanded: false, isPartial: false }, theme, {}).render(160).join("\n"), /fastlane/);
      assert.doesNotMatch(tool.renderResult!(secondResult, { expanded: false, isPartial: false }, theme, {}).render(160).join("\n"), /fastlane/);
      const third = tool.execute("third", { ...defaulted, prompt: "false", fastlane: false }, undefined, undefined, ctx);
      await admissions.get("false")!.promise;
      assert.equal(pending.get("false")!.options.fastlane, false);
      pending.get("false")!.done.resolve(base);
      await third;
      const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
      assert.doesNotMatch(source, /fastlane:state/);
    });
  }
});

test("the synchronous child factory never initializes the usage cache or loads routing", async (t) => {
  const { extension } = await loadExtensionForTest(t);
  process.env.PI_DELEGATED_CHILD = "1";
  const events: string[] = [];
  const returned = extension({
    on: (event) => { events.push(event); },
    registerCommand: () => assert.fail("no child commands"),
    registerTool: () => assert.fail("no child tools"),
  }, {
    createUsageCache: () => assert.fail("child must not create or load the cache"),
    loadRoutingSnapshot: () => assert.fail("child must not load routing"),
  });
  assert.equal(returned, undefined);
  assert.deepEqual(events, ["session_start", "session_shutdown"]);
});

test("history validation returns exact content with operator-only categories and native error marking", async (t) => {
  const { root, extension } = await loadExtensionForTest(t);
  const { HistoryValidationError } = await import("./runner.ts");
  const events = new Map<string, (...args: unknown[]) => unknown>();
  let tool: ToolDefinition<DelegateToolParams> | undefined;
  let failure: unknown;
  extension({
    on: (event, handler) => { events.set(event, handler); }, registerCommand: () => {},
    registerTool: (config: { name: string }) => {
      if (config.name === "delegate_run") tool = config as ToolDefinition<DelegateToolParams>;
    },
  }, {
    createUsageCache: async () => ({
      getFreshSnapshot: () => Object.freeze({}),
      invalidate: async () => assert.fail("no finalized quota failures"),
      refresh: async () => assert.fail("throw paths request no usage refresh"),
    }),
    runDelegate: async () => { throw failure; },
    finalizeDelegateRun: async () => assert.fail("the runner owns cleanup on throw"),
  });
  assert.ok(tool);
  const ctx = { cwd: root, modelRegistry: { getProviderAuth: async () => assert.fail("fake cache needs no auth") } };
  const params = { role: "remediation", prompt: "test" };
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  let delegateId = 0;
  for (const category of ["file_integrity", "size_limit", "read_changed", "record_shape", "context_target", "ancestry", "unclassified"] as const) {
    failure = new HistoryValidationError(category);
    // Reusing an exclusive role also proves that every exception releases manager admission.
    const result = await tool.execute("history-failure", params, undefined, undefined, ctx);
    assert.deepEqual(result, {
      content: [{ type: "text", text: "Delegated session history validation failed" }],
      details: { state: "delegate_failed", historyFailureCategory: category, delegateId: ++delegateId },
    });
    const event = { toolName: "delegate_run", ...result, isError: false };
    const patch = events.get("tool_result")!(event);
    assert.deepEqual(patch, { isError: true });
    assert.deepEqual(event.content, result.content);
    assert.deepEqual(event.details, result.details);
    assert.equal(events.get("tool_result")!({ ...event, toolName: "other" }), undefined);
    for (const expanded of [false, true]) {
      const rendered = tool.renderResult!(result, { expanded, isPartial: false }, theme, {}).render(160).join("\n");
      assert.ok(rendered.includes(`history validation: ${category}`));
      assert.match(rendered, /✗.*delegate_failed/);
      assert.doesNotMatch(rendered, /✓|completed/);
    }
    assert.deepEqual(result.content, [{ type: "text", text: "Delegated session history validation failed" }]);
  }
  for (const unrelated of [
    new Error("unrelated runner failure"),
    new Error("Delegated child cleanup failed"),
    Object.assign(new Error("Delegated session history validation failed"), { name: "HistoryValidationError", category: "record_shape" }),
    { message: "Delegated session history validation failed", category: "record_shape" },
  ]) {
    failure = unrelated;
    await assert.rejects(tool.execute("unrelated-failure", params, undefined, undefined, ctx), (caught) => caught === unrelated);
  }
});

test("history category rendering rejects arbitrary strings, paths, and content without coercion", async (t) => {
  await loadExtensionForTest(t);
  const { renderDelegateResult } = await import("./render.ts");
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const result: ToolResult = {
    content: [{ type: "text", text: "Delegated session history validation failed" }],
    details: { state: "delegate_failed" },
  };
  for (const expanded of [false, true]) {
    const options = { expanded, isPartial: false };
    const baseline = renderDelegateResult(result, options, theme, {}).render(160).join("\n");
    for (const category of [
      undefined, null, false, 42, "", "unknown", "__proto__", "constructor", "toString", "RECORD_SHAPE",
      "record_shape ", "record_shape\nPRIVATE-HISTORY-CONTENT", "/private/session.jsonl", "PRIVATE-HISTORY-CONTENT".repeat(100),
      ["record_shape"], { category: "record_shape" }, { toString() { assert.fail("never coerce category objects"); } },
    ]) {
      const untrusted = { ...result, details: { ...result.details, historyFailureCategory: category } };
      assert.equal(renderDelegateResult(untrusted, options, theme, {}).render(160).join("\n"), baseline);
      assert.deepEqual(untrusted.content, [{ type: "text", text: "Delegated session history validation failed" }]);
    }
    const completed = { ...result, details: { state: "completed", historyFailureCategory: "record_shape" } };
    assert.doesNotMatch(renderDelegateResult(completed, options, theme, {}).render(160).join("\n"), /history validation:|record_shape/);
  }
});

test("the parent lazily shares one cache and first execute auth context, forwarding fresh snapshots", async (t) => {
  const { root, extension } = await loadExtensionForTest(t);
  let tool: ToolDefinition<DelegateToolParams> | undefined;
  const initialization = deferred<CodexUsageCache>();
  let cacheOptions: CodexUsageCacheOptions | undefined;
  let creates = 0;
  let refreshes = 0;
  const forwarded: RunOptions["codexUsageSnapshot"][] = [];
  let snapshot: ReturnType<CodexUsageCache["getFreshSnapshot"]> = Object.freeze({});
  const cache: CodexUsageCache = {
    getFreshSnapshot: () => snapshot,
    invalidate: async () => assert.fail("no quota failures"),
    refresh: async () => { refreshes += 1; },
  };
  const registered = extension({
    on: () => {}, registerCommand: () => {},
    registerTool: (config: { name: string }) => {
      if (config.name === "delegate_run") tool = config as ToolDefinition<DelegateToolParams>;
    },
  }, {
    createUsageCache: (options) => { creates += 1; cacheOptions = options; return initialization.promise; },
    runDelegate: async (options) => { forwarded.push(options.codexUsageSnapshot); return lifecycleResult(root); },
    finalizeDelegateRun: async () => ({ content: [{ type: "text", text: "finalized" }] }),
  });
  assert.equal(registered, undefined, "parent registration remains synchronous");
  assert.equal(creates, 0, "registration must not create or load a cache");
  assert.ok(tool);
  const authCalls: string[] = [];
  const firstRegistry = {
    name: "first",
    async getProviderAuth(providerId: string) { authCalls.push(`${this.name}:${providerId}`); return { auth: {} }; },
  };
  const otherRegistry = { getProviderAuth: async () => assert.fail("only the first execute context resolves auth") };
  const params = { role: "solution-a", prompt: "test" };
  const first = tool.execute("first", params, undefined, undefined, { cwd: root, modelRegistry: firstRegistry });
  const second = tool.execute("second", params, undefined, undefined, { cwd: root, modelRegistry: otherRegistry });
  assert.equal(creates, 1, "concurrent executes share the pending initialization");
  assert.deepEqual(forwarded, [], "no run starts before the file load completes");
  assert.equal(refreshes, 0, "no pre-selection refresh");
  await cacheOptions!.resolveAuth("openai-codex");
  assert.deepEqual(authCalls, ["first:openai-codex"]);
  initialization.resolve(cache);
  await Promise.all([first, second]);
  assert.equal(forwarded[0], snapshot);
  assert.equal(forwarded[1], snapshot);
  snapshot = Object.freeze({ "openai-codex": { providerId: "openai-codex", planType: "plus", fetchedAt: 1, allowed: true, primary: { remainingPercent: 80 } } });
  await tool.execute("third", params, undefined, undefined, { cwd: root, modelRegistry: otherRegistry });
  assert.equal(forwarded[2], snapshot, "each run reads the current fresh snapshot");
  assert.equal(creates, 1);
  assert.equal(refreshes, 3);
});

test("each registration owns one scheduler shared by concurrently initiated runs and forwards the millisecond clock", async (t) => {
  const { root, extension } = await loadExtensionForTest(t);
  const { selectRoutes, validateRoutingConfig } = await import("./routing.ts");
  const providers = ["openai-codex", "openai-codex-a", "openai-codex-b"];
  const routing = validateRoutingConfig({
    version: 2,
    thinkingLevels: ["high"],
    models: { "model-x": { providers: Object.fromEntries(providers.map((provider) => [
      provider, { thinking: ["high"], default: "high" },
    ])) } },
    profiles: { pool: { overridePolicy: "rejected", tiers: [{ model: "model-x", thinking: "high" }] } },
    assignments: {
      solution: ["pool", "pool"], review: ["pool"], implementation: "pool",
      remediation: "pool", verification: "pool", oracle: "pool",
    },
  });
  const now = () => 1_800_000_000_000;
  const snapshot: RunOptions["codexUsageSnapshot"] = Object.freeze({
    "openai-codex": { providerId: "openai-codex", planType: "plus", fetchedAt: now(), allowed: true, primary: { remainingPercent: 80 } },
    "openai-codex-a": { providerId: "openai-codex-a", planType: "plus", fetchedAt: now(), allowed: true, primary: { remainingPercent: 80 } },
    "openai-codex-b": {
      providerId: "openai-codex-b", planType: "prolite", fetchedAt: now(), allowed: true,
      secondary: { remainingPercent: 100, resetAt: now() / 1000 + 604800 },
    },
  });
  const registrations: NonNullable<RunOptions["scheduler"]>[] = [];
  for (const runCount of [3, 2]) {
    let tool: ToolDefinition<DelegateToolParams> | undefined;
    const forwarded: RunOptions[] = [];
    const primaries: string[] = [];
    extension({
      on: () => {}, registerCommand: () => {},
      registerTool: (config: { name: string }) => {
        if (config.name === "delegate_run") tool = config as ToolDefinition<DelegateToolParams>;
      },
    }, {
      loadRoutingSnapshot: () => routing,
      now,
      createUsageCache: async (options) => {
        assert.equal(options.now, now, "cache freshness and routing use the same clock");
        return { getFreshSnapshot: () => snapshot, invalidate: async () => {}, refresh: async () => {} };
      },
      runDelegate: async (options) => {
        assert.equal(options.now, now);
        assert.equal(options.codexUsageSnapshot, snapshot);
        assert.ok(options.scheduler);
        forwarded.push(options);
        primaries.push(selectRoutes(options.routingConfig!, options.role, options.routingOverride, options)[0]!.provider);
        await nextTurn();
        return lifecycleResult(root);
      },
      finalizeDelegateRun: async () => ({ content: [{ type: "text", text: "finalized" }] }),
    });
    assert.ok(tool);
    await Promise.all(Array.from({ length: runCount }, (_, index) => tool!.execute(
      `run-${index}`, { role: index % 2 === 0 ? "solution-a" : "solution-b", prompt: "test" }, undefined, undefined,
      { cwd: root, modelRegistry: { getProviderAuth: async () => assert.fail("fake cache needs no auth") } },
    )));
    assert.deepEqual(primaries, ["openai-codex", "openai-codex-a", "openai-codex"].slice(0, runCount));
    assert.ok(forwarded.every((options) => options.scheduler === forwarded[0]!.scheduler));
    registrations.push(forwarded[0]!.scheduler!);
  }
  assert.notEqual(registrations[0], registrations[1]);
});

test("seven concurrent delegates refresh once after the transition to idle", async (t) => {
  const { root, extension } = await loadExtensionForTest(t);
  const providerIds = ["openai-codex-gate-a", "openai-codex-gate-b", "openai-codex-gate-c",
    "openai-codex-gate-d", "openai-codex-gate-e", "openai-codex-gate-f", "openai-codex-gate-g"];
  const completions = providerIds.map(() => deferred<DelegateRunResult>());
  const starts = providerIds.map(() => deferred<void>());
  const refreshStarted = deferred<void>();
  const finishRefresh = deferred<void>();
  const invalidated: string[] = [];
  const refreshRequests: Array<Parameters<CodexUsageCache["refresh"]>[0]> = [];
  let runCount = 0;
  const cache: CodexUsageCache = {
    getFreshSnapshot: () => Object.freeze({}),
    invalidate: async (providerId) => { invalidated.push(providerId); },
    refresh: async (request) => {
      refreshRequests.push(request);
      refreshStarted.resolve();
      await finishRefresh.promise;
    },
  };
  let tool: ToolDefinition<DelegateToolParams> | undefined;
  extension({
    on: () => {}, registerCommand: () => {},
    registerTool: (config: { name: string }) => {
      if (config.name === "delegate_run") tool = config as ToolDefinition<DelegateToolParams>;
    },
  }, {
    createUsageCache: async () => cache,
    runDelegate: async () => {
      const index = runCount++;
      starts[index].resolve();
      return completions[index].promise;
    },
    finalizeDelegateRun: async () => ({ content: [{ type: "text", text: "finalized" }] }),
  });
  assert.ok(tool);
  const executions: Array<Promise<ToolResult>> = [];
  for (let index = 0; index < providerIds.length; index += 1) {
    executions.push(tool.execute(
      `run-${index}`,
      { role: "solution-a", prompt: "test" },
      undefined,
      undefined,
      { cwd: root, modelRegistry: { getProviderAuth: async () => assert.fail("fake cache never resolves auth") } },
    ));
    await starts[index].promise;
  }
  assert.equal(runCount, 7);
  for (let index = 0; index < 6; index += 1) {
    completions[index].resolve({
      ...lifecycleResult(root),
      supervisedProviderIds: [providerIds[index], providerIds[index]],
      ...(index % 3 === 0 ? { quotaFailedProviderIds: [providerIds[index]] } : {}),
    });
    await executions[index];
    assert.equal(refreshRequests.length, 0, "a completed delegate must not refresh while another remains active");
  }
  let lastReturned = false;
  void executions[6].then(() => { lastReturned = true; });
  completions[6].resolve({
    ...lifecycleResult(root),
    supervisedProviderIds: [providerIds[6]],
    quotaFailedProviderIds: [providerIds[6]],
  });
  await refreshStarted.promise;
  assert.equal(lastReturned, false, "the final delegate awaits the bounded refresh");
  assert.equal(refreshRequests.length, 1);
  assert.equal(refreshRequests[0]?.forcedProviderIds, undefined);
  for (const providerId of providerIds) {
    assert.ok(refreshRequests[0]?.candidateProviderIds?.includes(providerId));
  }
  assert.deepEqual(invalidated, [providerIds[0], providerIds[3], providerIds[6]]);
  finishRefresh.resolve();
  await executions[6];
  assert.equal(lastReturned, true);
});

test("simultaneous completions across role families refresh once on the transition to idle", async (t) => {
  const { root, extension } = await loadExtensionForTest(t);
  const providerIds = ["openai-codex-solution", "openai-codex-review"];
  const completions = providerIds.map(() => deferred<DelegateRunResult>());
  const starts = providerIds.map(() => deferred<void>());
  const allFinalizing = deferred<void>();
  const refreshStarted = deferred<void>();
  const finishRefresh = deferred<void>();
  const refreshRequests: Array<Parameters<CodexUsageCache["refresh"]>[0]> = [];
  let runCount = 0;
  let finalizingCount = 0;
  const cache: CodexUsageCache = {
    getFreshSnapshot: () => Object.freeze({}),
    invalidate: async () => assert.fail("no quota failures"),
    refresh: async (request) => {
      refreshRequests.push(request);
      refreshStarted.resolve();
      await finishRefresh.promise;
    },
  };
  let tool: ToolDefinition<DelegateToolParams> | undefined;
  extension({
    on: () => {}, registerCommand: () => {},
    registerTool: (config: { name: string }) => {
      if (config.name === "delegate_run") tool = config as ToolDefinition<DelegateToolParams>;
    },
  }, {
    createUsageCache: async () => cache,
    runDelegate: async () => {
      const index = runCount++;
      starts[index].resolve();
      return completions[index].promise;
    },
    finalizeDelegateRun: async () => {
      finalizingCount += 1;
      if (finalizingCount === providerIds.length) allFinalizing.resolve();
      await allFinalizing.promise;
      return { content: [{ type: "text", text: "finalized" }] };
    },
  });
  assert.ok(tool);
  const roles = ["solution-a", "review-a"];
  const executions: Array<Promise<ToolResult>> = [];
  for (let index = 0; index < roles.length; index += 1) {
    executions.push(tool.execute(
      `simultaneous-${index}`,
      { role: roles[index], prompt: "test" },
      undefined,
      undefined,
      { cwd: root, modelRegistry: { getProviderAuth: async () => assert.fail("fake cache never resolves auth") } },
    ));
    await starts[index].promise;
  }
  for (let index = 0; index < completions.length; index += 1) {
    completions[index].resolve({ ...lifecycleResult(root), supervisedProviderIds: [providerIds[index]] });
  }
  const outcome = await Promise.race([
    refreshStarted.promise.then(() => "refresh" as const),
    Promise.all(executions).then(() => "returned" as const),
  ]);
  assert.equal(outcome, "refresh", "simultaneous finalizers must not both miss the idle transition");
  assert.equal(refreshRequests.length, 1);
  assert.equal(refreshRequests[0]?.forcedProviderIds, undefined);
  for (const providerId of providerIds) {
    assert.ok(refreshRequests[0]?.candidateProviderIds?.includes(providerId));
  }
  finishRefresh.resolve();
  await Promise.all(executions);
  assert.equal(refreshRequests.length, 1);
});

test("usage refresh follows finalization and invalidation, uses all candidates, and cannot change ToolResult", async (t) => {
  const { root, extension } = await loadExtensionForTest(t);
  const { validateRoutingConfig } = await import("./routing.ts");
  const { finalizeDelegateRun } = await import("./result.ts");
  const capability = { thinking: ["high"], default: "high" };
  const routing = validateRoutingConfig({
    version: 2, thinkingLevels: ["high"],
    disabledProviders: ["openai-codex-disabled", "openai-codex-disabled-only"],
    models: {
      current: { providers: { "openai-codex-a": capability, other: capability } },
      spare: { providers: { "openai-codex": capability, "openai-codex-a": capability, "openai-codex-b": capability,
        "openai-codex-disabled": capability, "openai-codex-": capability } },
      unused: { providers: { "openai-codex-unused": capability } },
    },
    profiles: {
      current: { overridePolicy: "allowed", tiers: [{ model: "current", thinking: "high", providers: ["openai-codex-a"] }] },
      oracle: { overridePolicy: "rejected", tiers: [{ model: "spare", thinking: "high", providers: ["openai-codex-b"] }] },
    },
    assignments: { solution: ["current"], review: ["current"], implementation: "current", remediation: "current", verification: "current", oracle: "oracle" },
  });
  for (const refreshFails of [false, true]) {
    await t.test(refreshFails ? "refresh rejection" : "refresh success", async () => {
      const events: string[] = [];
      const finalizationStarted = deferred<void>();
      const finishFinalization = deferred<void>();
      const refreshStarted = deferred<void>();
      const finishRefresh = deferred<void>();
      const artifactDir = mkdtempSync(path.join(root, "artifacts-"));
      writeFileSync(path.join(artifactDir, "private.txt"), "test artifact");
      const result: DelegateRunResult = {
        ...lifecycleResult(artifactDir),
        attempts: [{ route: "openai-codex-b/spare:high", state: "catalog_unavailable", elapsedSeconds: 0 }],
        supervisedProviderIds: ["openai-codex-a", "openai-codex", "openai-codex-a", "other", "openai-codex-"],
        quotaFailedProviderIds: ["openai-codex-a", "other", "openai-codex-"],
      };
      let tool: ToolDefinition<DelegateToolParams> | undefined;
      let finalized: ToolResult | undefined;
      let refreshRequest: Parameters<CodexUsageCache["refresh"]>[0];
      let artifactExistsOnInvalidate: boolean | undefined;
      const cache: CodexUsageCache = {
        getFreshSnapshot: () => { events.push("snapshot"); return Object.freeze({}); },
        invalidate: async (providerId) => {
          artifactExistsOnInvalidate = existsSync(artifactDir);
          events.push(`invalidate:${providerId}`);
          await Promise.resolve();
          events.push("invalidated");
        },
        refresh: async (request) => {
          events.push("refresh");
          refreshRequest = request;
          refreshStarted.resolve();
          await finishRefresh.promise;
          events.push("refreshed");
          if (refreshFails) throw new Error("synthetic-private-refresh-error");
        },
      };
      extension({
        on: () => {}, registerCommand: () => {},
        registerTool: (config: { name: string }) => {
          if (config.name === "delegate_run") tool = config as ToolDefinition<DelegateToolParams>;
        },
      }, {
        loadRoutingSnapshot: () => routing,
        createUsageCache: async () => cache,
        runDelegate: async (options) => { assert.equal(options.routingConfig, routing); events.push("run"); return result; },
        finalizeDelegateRun: async (run) => {
          events.push("finalize");
          finalizationStarted.resolve();
          await finishFinalization.promise;
          finalized = await finalizeDelegateRun(run);
          events.push("finalized");
          return finalized;
        },
      });
      assert.ok(tool);
      let returned = false;
      const pending = tool.execute("run", { role: "solution-a", prompt: "test" }, undefined, undefined, {
        cwd: root, modelRegistry: { getProviderAuth: async () => assert.fail("fake cache never resolves auth") },
      }).then((value) => { returned = true; return value; });
      await finalizationStarted.promise;
      assert.deepEqual(events, ["snapshot", "run", "finalize"]);
      assert.equal(existsSync(artifactDir), true);
      finishFinalization.resolve();
      await refreshStarted.promise;
      await nextTurn();
      assert.equal(artifactExistsOnInvalidate, false, "finalization removes artifacts before invalidation");
      assert.deepEqual(events, ["snapshot", "run", "finalize", "finalized", "invalidate:openai-codex-a", "invalidated", "refresh"]);
      assert.equal(returned, false, "execute awaits the bounded refresh");
      assert.equal(refreshRequest?.forcedProviderIds, undefined);
      assert.deepEqual([...(refreshRequest?.candidateProviderIds ?? [])].sort(), [
        "openai-codex", "openai-codex-a", "openai-codex-b", "openai-codex-disabled", "openai-codex-disabled-only", "openai-codex-unused",
      ]);
      finishRefresh.resolve();
      const toolResult = await pending;
      assert.ok(finalized);
      assert.deepEqual(toolResult, { ...finalized, details: { ...finalized.details, delegateId: 1 } });
      assert.equal(result.state, "completed");
      assert.doesNotMatch(JSON.stringify(toolResult), /synthetic-private-refresh-error|supervisedProviderIds|quotaFailedProviderIds/);
      assert.equal(events.at(-1), "refreshed");
    });
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
    "../fastlane/index.ts",
  ]);
  // Extension selection stays fixed by the policy: local presentation
  // extensions, configured package extensions, and every project or future
  // extension stay outside the allowlist, so delegated children register no
  // BTW, Claude Bridge, Cursor, footer, or theme behavior. Fastlane is the
  // fixed runtime-only exception and adds no model-visible child tool.
  const extensionsText = JSON.stringify(policy.extensions);
  for (const forbidden of ["footer", "theme-overrides", "pi-blackhole", "pi-btw", "pi-browser-harness", "pi-claude-bridge", "pi-cursor"]) {
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
