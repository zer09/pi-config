import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("registration guidelines encode the automatic delegation policy without provider route details", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const guidelinesStart = source.indexOf("export function delegateRunPromptGuidelines(");
  assert.ok(guidelinesStart >= 0, "delegateRunPromptGuidelines builder not found");
  const guidelines = source.slice(guidelinesStart, source.indexOf("\n}\n", guidelinesStart));

  // Delegation is automatic for repository implementation changes unless the
  // user opts out. Only trivial edits and parent-authored plan or research
  // deliverables bypass implementation delegation.
  assert.match(guidelines, /automatically for repository implementation changes unless the user explicitly opts out/);
  assert.match(guidelines, /The parent may directly make only a truly trivial edit with no behavior change or create and revise the plan and research deliverables defined below/);
  assert.match(guidelines, /the parent never manually implements a non-trivial or small implementation task/);
  // The parent owns planning and research deliverables: it authors them
  // directly, artifact writes are an explicit exception to automatic
  // delegation, and no implementation or remediation delegate may author,
  // research, or revise them. Plan/research artifacts are classified by
  // purpose, and a pure planning or research request runs no implementation
  // delegate, review gate, or remediation.
  assert.match(guidelines, /The parent owns planning and research deliverables: directly formulate, draft, edit, and save every plan, design note, investigation report, and research note, including repository artifacts such as PLAN\.md/);
  assert.match(guidelines, /Those artifact writes are an explicit exception to automatic delegation even when they change repository files/);
  assert.match(guidelines, /plan and research artifacts are distinguished by purpose, not only by file extension or location/);
  assert.match(guidelines, /Never call an implementation or remediation delegate to research, explore, formulate, draft, edit, save, or revise a plan or research deliverable/);
  assert.match(guidelines, /An implementation delegate executes only a parent-finalized implementation contract that changes product code, configuration, operational behavior, or implementation documentation/);
  assert.match(guidelines, /implementation documentation such as README updates, ADRs, changelogs, policy files, and documentation accompanying code/);
  assert.match(guidelines, /a remediation delegate corrects only verification-confirmed findings in such implementation work/);
  assert.match(guidelines, /A pure planning or research request runs no implementation delegate, implementation review gate, or remediation/);
  assert.match(guidelines, /if the user later approves implementation, that later request follows the existing implementation delegation and review workflow/);
  // Small tasks skip only the solution-investigation gate and the oracle, and
  // still delegate implementation.
  assert.match(guidelines, /small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and the oracle role and still runs exactly one implementation delegate/);
  // The parent inspects the implementation diff and evidence before the review gate.
  assert.match(guidelines, /implementation delegate's diff and evidence/);
  assert.match(guidelines, /call delegate_run for \$\{joinRoleIds\(reviewRoleIds\)\} concurrently with the same neutral review scope/);
  assert.match(guidelines, /all \$\{countWord\(reviewRoleIds\.length\)\} must complete\./);
  // Reviewer-gate waiver: the strict all-five default stands, and only the
  // user may explicitly waive named failed reviewer roles for the one
  // current gate. The waiver continues with completed reports, records the
  // waived roles, never relabels failures as passes, stays one-shot and
  // gate-scoped, keeps findings from completed reviewers, and is never
  // inferred from generic continue/commit/skip-retry requests.
  assert.match(guidelines, /the gate stays blocked by default; only the user may explicitly waive the named failed reviewer roles for that one current gate/);
  assert.match(guidelines, /continue with the completed review reports instead of retrying or stopping solely because the waived reviewers failed/);
  assert.match(guidelines, /A reviewer waiver is one-shot and gate-scoped/);
  assert.match(guidelines, /it changes no later gates, role schema, routing, or concurrency/);
  assert.match(guidelines, /state which reviewers were waived and that the gate completed under user waiver/);
  assert.match(guidelines, /never label a waived failure as a reviewer pass/);
  assert.match(guidelines, /does not dismiss findings from completed reviewers/);
  assert.match(guidelines, /Do not infer a reviewer waiver from a generic request to continue, commit, or skip retries/);
  assert.match(guidelines, /C may be waived for this gate, authorizes only that named waiver/);
  // Solution delegates gather evidence and propose options; the parent stays
  // the sole author and owner of the final plan or research deliverable.
  assert.match(guidelines, /Solution delegates may gather evidence and propose options, but the parent verifies the evidence, synthesizes conclusions, and remains sole author and owner of the final plan or research deliverable/);
  // Solution-gate waiver: the strict all-six default stands before synthesis,
  // and only the user may explicitly waive named failed solution roles for
  // the one current solution gate. The waiver continues synthesis from
  // completed reports plus parent-verified repository evidence, requires at
  // least one completed investigator (zero completed reports cannot be waived
  // into a synthesis), records the waived roles without relabeling failures,
  // stays one-shot and gate-scoped, preserves the advisory oracle and the
  // downstream implementation/review/verification/remediation rules, and is
  // never inferred from generic continue/commit/skip-retry requests.
  assert.match(guidelines, /call delegate_run for \$\{joinRoleIds\(solutionRoleIds\)\} concurrently with the same neutral assignment/);
  assert.match(guidelines, /all \$\{countWord\(solutionRoleIds\.length\)\} must complete before synthesis/);
  assert.match(guidelines, /the gate stays blocked by default; only the user may explicitly waive the named failed solution roles for that one current solution gate/);
  assert.match(guidelines, /continue synthesis using only the completed solution reports plus parent-verified repository evidence/);
  assert.match(guidelines, /At least one solution delegate must have completed: the user cannot waive the entire evidence set and synthesize from zero completed investigator reports/);
  assert.match(guidelines, /A solution waiver is one-shot and gate-scoped/);
  assert.match(guidelines, /it changes no later solution gates, role schema, routing, or concurrency/);
  assert.match(guidelines, /state which solution roles were waived and that the solution gate proceeded under user waiver/);
  assert.match(guidelines, /never label a waived failure as completed or passed/);
  assert.match(guidelines, /does not fabricate or dismiss evidence, resolve uncertainties, authorize implementation, replace parent evidence verification/);
  assert.match(guidelines, /skip the advisory oracle when otherwise required/);
  assert.match(guidelines, /weaken implementation, review, verification, or remediation rules/);
  assert.match(guidelines, /Do not infer a solution waiver from a generic request to continue, commit, or skip retries/);
  assert.match(guidelines, /solution C may be waived for this gate, authorizes only that named waiver/);
  // Oracle policy: one fresh read-only oracle after a required solution gate,
  // the configured-Oracle-model set skip condition, advisory-only authority
  // that never authors or saves the final plan, and the neutral oracle prompt
  // contents.
  assert.match(guidelines, /After a required solution gate, call delegate_run for exactly one fresh read-only oracle review of the draft solution contract/);
  assert.match(guidelines, /only when the parent session's current model is not one of the configured Oracle profile models; when it is, skip the oracle and finalize the solution contract directly/);
  assert.match(guidelines, /Give the oracle role the neutral problem, governing documents, verified evidence, the draft solution contract, constraints, and unresolved uncertainties; do not give it raw investigator reports or the parent's synthesis rationale/);
  assert.match(guidelines, /Treat the oracle as advisory, not the final authority: the oracle critiques the parent draft but never authors or saves the final plan/);
  assert.match(guidelines, /Verify its VALID or REVISE analysis like any other evidence/);
  assert.match(guidelines, /run no automatic oracle loop; a non-completed oracle run blocks implementation/);
  assert.doesNotMatch(guidelines, /Claude Code|backend=claude/);
  assert.match(guidelines, /only one implementation, remediation, or oracle role at a time/);
  // Blocking findings get fresh verification, only verification-confirmed findings
  // reach one focused remediation role, and fresh gates repeat until none remain.
  // Independent verifications run in bounded four-way batches, duplicates are
  // consolidated first, dependent findings stay sequential, and the parent waits
  // for the whole batch before remediation.
  assert.match(guidelines, /consolidate exact duplicate findings first/);
  assert.match(guidelines, /give each verification exactly one finding without sibling verification reports/);
  assert.match(guidelines, /overlap verification only with other verification delegates/);
  assert.match(guidelines, /Run independent finding verifications concurrently in batches of at most four/);
  assert.match(guidelines, /keep dependent findings sequential/);
  assert.match(guidelines, /wait for every verification in the current batch before remediation/);
  assert.match(guidelines, /non-completed verification leaves its finding unresolved without erasing completed sibling reports/);
  assert.match(guidelines, /Send only verification-confirmed findings to one focused remediation role/);
  assert.match(guidelines, /fresh \$\{countWord\(reviewRoleIds\.length\)\}-reviewer gate until no blocking findings remain/);
  // Routing is automatic and config-driven; routingOverride is the only
  // exceptional escape hatch and is invalid for the oracle role.
  assert.match(guidelines, /Delegate routing, including model, thinking, and provider fallback after operational failures, is automatic from the extension-owned routing configuration/);
  assert.match(guidelines, /pass routingOverride only when the user or project explicitly requests an operational route change for that one run, never for the oracle role/);
  assert.match(guidelines, /routingOverride never changes role permissions or concurrency/);
  assert.match(guidelines, /do not retry outside the tool's bounded operational route fallback without user-authorized diagnosis/);
  // Git transitions and hosted writes never ride on a completed delegate.
  assert.match(guidelines, /require separate explicit authorization/);

  // Role routes live in routing.json; model-visible guidelines stay route-free.
  // The oracle skip condition references the configured Oracle models as a
  // set, so no concrete model id may appear in the guidelines at all. Compare
  // lowercased text so mixed-case reintroductions still fail.
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
  // description sits on the array property, not on the item enum.
  assert.match(source, /availableSkills: Type\.Optional\(Type\.Array\(\s*\n\s*StringEnum\(allowedSkillNames\),\s*\n\s*\{\s*\n\s*description: "Pre-approved skills to make discoverable to this delegate\. The delegate loads full skill instructions only when its task requires them\.",\s*\n\s*\},\s*\n\s*\)\),/);
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
      "Pre-approved skills to make discoverable to this delegate. The delegate loads full skill instructions only when its task requires them.",
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
    assert.deepEqual(role.enum, [...roleIds((await import("./routing.ts")).loadRoutingSnapshot())]);
    assert.match(
      role.description ?? "",
      /Use the configured solution roles \(solution-a, solution-b, solution-c, solution-d, solution-e, solution-f\) and review roles \(review-a, review-b, review-c, review-d, review-e\)/,
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
    const { loadRoutingSnapshot } = await import("./routing.ts");
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
    // The count-aware guidelines resolve against the shipped snapshot: the
    // generated text names every configured solution and review role and
    // carries the matching count words, so gate resizing regenerates them.
    const delegateRunGuidelines = (registrations[0]?.promptGuidelines ?? []).join("\n");
    assert.match(delegateRunGuidelines, /solution-a, solution-b, solution-c, solution-d, solution-e, and solution-f concurrently/);
    assert.match(delegateRunGuidelines, /all six must complete before synthesis/);
    assert.match(delegateRunGuidelines, /review-a, review-b, review-c, review-d, and review-e concurrently/);
    assert.match(delegateRunGuidelines, /all five must complete\./);
    assert.match(delegateRunGuidelines, /fresh five-reviewer gate until no blocking findings remain/);
    // No concrete route detail leaks into the generated guidance.
    const loweredGuidelines = delegateRunGuidelines.toLowerCase();
    for (const routeDetail of ["gpt-5.5", "gpt-5.6", "codex", "glm-", "zai", "opencode-go", "openrouter"]) {
      assert.ok(!loweredGuidelines.includes(routeDetail), `generated guidance must not contain ${routeDetail}`);
    }
    // The catalog guidance stays concise and does not enumerate combinations.
    const catalogGuidelines = (registrations[1]?.promptGuidelines ?? []).join("\n");
    assert.match(catalogGuidelines, /partial or unknown model/);
    assert.match(catalogGuidelines, /choose only a returned model, provider, and supported thinking-level combination/);
    for (const routeDetail of ["gpt-5.5", "gpt-5.6", "codex", "glm-", "zai"]) {
      assert.ok(!catalogGuidelines.includes(routeDetail), `catalog guidance must not contain ${routeDetail}`);
    }
  } finally {
    rmSync(hooksDir, { recursive: true, force: true });
  }
});

test("the model catalog guidance stays concise and keeps overrides exceptional", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const registrationStart = source.indexOf('name: "delegate_model_catalog"');
  assert.ok(registrationStart >= 0, "delegate_model_catalog registration not found");
  const registration = source.slice(registrationStart, source.indexOf("});", registrationStart));
  assert.match(registration, /promptSnippet: "Look up configured delegate models, providers, and thinking levels before an exceptional routing override"/);
  assert.match(registration, /only when an explicit user or project operational request names a partial or unknown model for a one-run routing substitution/);
  assert.match(registration, /choose only a returned model, provider, and supported thinking-level combination/);
  assert.match(registration, /never invokes pi --list-models/);
  assert.match(registration, /never for the oracle role/);
  // The catalog is never appended to the delegate_run schema or guidance.
  const delegateRunRegistration = source.slice(
    source.indexOf('name: "delegate_run"'),
    registrationStart,
  );
  assert.ok(!delegateRunRegistration.includes("delegate_model_catalog"));
  // No model/provider/thinking combination is enumerated in either schema.
  for (const forbidden of ["gpt-5.5", "gpt-5.6-sol", "glm-5.3", "openai-codex", "zai", "opencode-go"]) {
    assert.ok(!source.includes(forbidden), `index.ts must not enumerate concrete models or providers (found ${forbidden})`);
  }
});

test("count-aware guidance regenerates for a resized routing snapshot", async () => {
  const { delegateRunPromptGuidelines } = await import("./index.ts");
  const guidelines = delegateRunPromptGuidelines(
    ["solution-a", "solution-b", "solution-c"],
    ["review-a", "review-b"],
  ).join("\n");
  assert.match(guidelines, /call delegate_run for solution-a, solution-b, and solution-c concurrently with the same neutral assignment/);
  assert.match(guidelines, /all three must complete before synthesis/);
  assert.match(guidelines, /call delegate_run for review-a and review-b concurrently with the same neutral review scope/);
  assert.match(guidelines, /all two must complete\./);
  assert.match(guidelines, /fresh two-reviewer gate until no blocking findings remain/);
  // Single-role gates still read naturally.
  const single = delegateRunPromptGuidelines(["solution-a"], ["review-a"]).join("\n");
  assert.match(single, /call delegate_run for solution-a concurrently with the same neutral assignment/);
  assert.match(single, /all one must complete before synthesis/);
});

test("availableSkills guidance states the concise progressive-disclosure semantics", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  // The availableSkills line lives in the delegate_run guidelines builder.
  const guidelinesStart = source.indexOf("export function delegateRunPromptGuidelines(");
  assert.ok(guidelinesStart >= 0, "delegateRunPromptGuidelines builder not found");
  const guidelines = source.slice(guidelinesStart, source.indexOf("\n}\n", guidelinesStart));
  assert.match(guidelines, /Use availableSkills to make only task-relevant pre-approved skills discoverable to a delegate; selection does not force full skill loading, and the delegate decides which selected skills it actually needs\./);
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
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const runner = await readFile(new URL("./runner.ts", import.meta.url), "utf8");
  // Nothing appends skill bodies, forces /skill:name expansion, or instructs a
  // blanket read of every selected SKILL.md.
  for (const source of [index, routes, runner]) {
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
  const files = ["index.ts", "routing.ts", "routes.ts", "runner.ts", "supervisor.ts", "types.ts"];
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
