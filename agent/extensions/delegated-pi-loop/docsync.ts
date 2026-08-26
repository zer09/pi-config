import { MODEL_CATALOG_DEFAULT_LIMIT, MODEL_CATALOG_MAX_LIMIT } from "./catalog.ts";
import {
  DELEGATE_MODEL_CATALOG_TOOL,
  DELEGATE_RUN_PARAMETER_DESCRIPTIONS,
  DELEGATE_RUN_TOOL,
  MODEL_CATALOG_PROMPT_GUIDELINES,
  REPORT_RECOVERY_PROMPT,
  RESTART_AFTER_WORK_NOTE,
  ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS,
  composeDelegatePrompt,
  delegateRunPromptGuidelines,
  delegateRunRoleDescription,
  modelCatalogParameterDescriptions,
  modelCatalogToolDescription,
  roleFamilyContract,
} from "./instructions.ts";
import { ROLE_FAMILIES, roleIdsInFamily, type RoutingConfig } from "./routing.ts";

/**
 * Documentation synchronization for the model-visible instruction sections of
 * `docs/delegated-pi-loop-agent-instructions.md`.
 *
 * Every marked section in that document is rendered from the canonical
 * exports of `instructions.ts` (plus the shipped routing snapshot for the
 * count-aware parts), so the checked-in reference can never silently drift
 * from the prompts and guidelines Pi actually sends. `render-instructions-doc.ts`
 * regenerates the marked regions in place; `docsync.test.ts` fails when the
 * checked-in content diverges. This is deliberately not a general-purpose
 * Markdown template language: only these fixed, named sections are managed.
 */

const MARKER_PREFIX = "pi-delegated-instructions";

/** Ordered section ids managed by the renderer. */
export const INSTRUCTION_DOC_SECTION_IDS = [
  "delegate-run-tool",
  "delegate-run-parameters",
  "delegate-run-guidelines",
  "model-catalog-tool",
  "child-prompt-template",
  "role-family-contracts",
  "restart-note",
  "report-recovery-prompt",
] as const;

export type InstructionDocSectionId = (typeof INSTRUCTION_DOC_SECTION_IDS)[number];

function beginMarker(id: string): string {
  return `<!-- ${MARKER_PREFIX}:begin:${id} -->`;
}

function endMarker(id: string): string {
  return `<!-- ${MARKER_PREFIX}:end:${id} -->`;
}

function fenced(text: string): string {
  return `\`\`\`text\n${text}\n\`\`\``;
}

function definitionList(entries: readonly (readonly [string, string])[]): string {
  return entries.map(([term, description]) => `- **${term}:** ${description}`).join("\n");
}

function numberedList(lines: readonly string[]): string {
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n\n");
}

/** Renders one managed section from the canonical exports. */
function renderSection(id: InstructionDocSectionId, routing: RoutingConfig): string {
  const solutionRoleIds = roleIdsInFamily(routing, "solution");
  const reviewRoleIds = roleIdsInFamily(routing, "review");
  switch (id) {
    case "delegate-run-tool":
      return definitionList([
        ["Name", `\`${DELEGATE_RUN_TOOL.name}\``],
        ["Label", DELEGATE_RUN_TOOL.label],
        ["Description", DELEGATE_RUN_TOOL.description],
        ["Prompt snippet", DELEGATE_RUN_TOOL.promptSnippet],
      ]);
    case "delegate-run-parameters":
      return definitionList([
        ["`role`", delegateRunRoleDescription(solutionRoleIds, reviewRoleIds)],
        ["`prompt`", DELEGATE_RUN_PARAMETER_DESCRIPTIONS.prompt],
        ["`cwd`", DELEGATE_RUN_PARAMETER_DESCRIPTIONS.cwd],
        ["`availableSkills`", DELEGATE_RUN_PARAMETER_DESCRIPTIONS.availableSkills],
        ["`routingOverride.provider`", ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.provider],
        ["`routingOverride.model`", ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.model],
        ["`routingOverride.thinking`", ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.thinking],
        ["`routingOverride.excludeProviders`", ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.excludeProviders],
        ["`routingOverride.reason`", ROUTING_OVERRIDE_PARAMETER_DESCRIPTIONS.reason],
      ]);
    case "delegate-run-guidelines":
      return numberedList(delegateRunPromptGuidelines(solutionRoleIds, reviewRoleIds));
    case "model-catalog-tool": {
      const descriptions = modelCatalogParameterDescriptions({
        default: MODEL_CATALOG_DEFAULT_LIMIT,
        max: MODEL_CATALOG_MAX_LIMIT,
      });
      return [
        definitionList([
          ["Name", `\`${DELEGATE_MODEL_CATALOG_TOOL.name}\``],
          ["Label", DELEGATE_MODEL_CATALOG_TOOL.label],
          ["Description", modelCatalogToolDescription(MODEL_CATALOG_MAX_LIMIT)],
          ["Prompt snippet", DELEGATE_MODEL_CATALOG_TOOL.promptSnippet],
          ["`query`", descriptions.query],
          ["`provider`", descriptions.provider],
          ["`thinking`", descriptions.thinking],
          ["`limit`", descriptions.limit],
        ]),
        "",
        "Guidelines:",
        "",
        numberedList(MODEL_CATALOG_PROMPT_GUIDELINES),
      ].join("\n");
    }
    case "child-prompt-template":
      // The documented template uses literal placeholders in the same
      // composition the spawned prompt uses, so the shape stays derived from
      // the canonical builder instead of a hand-maintained copy.
      return fenced(composeDelegatePrompt({
        taskHeading: "# Task: <role>",
        cwdSentence: 'You are a fresh delegated CLI agent working directly in "<cwd>".',
        roleContractText: "<role-specific contract>",
        assignedTask: "<parent-supplied prompt>",
        restartNote: undefined,
      }));
    case "role-family-contracts":
      return ROLE_FAMILIES
        .map((family) => `### ${family}\n\n${fenced(roleFamilyContract(family))}`)
        .join("\n\n");
    case "restart-note":
      return fenced(RESTART_AFTER_WORK_NOTE);
    case "report-recovery-prompt":
      return fenced(REPORT_RECOVERY_PROMPT);
  }
}

/** Renders every managed section from the canonical exports and one snapshot. */
export function renderInstructionDocSections(routing: RoutingConfig): ReadonlyMap<InstructionDocSectionId, string> {
  const sections = new Map<InstructionDocSectionId, string>();
  for (const id of INSTRUCTION_DOC_SECTION_IDS) {
    sections.set(id, renderSection(id, routing));
  }
  return sections;
}

const SECTION_PATTERN = new RegExp(
  `<!-- ${MARKER_PREFIX}:begin:([a-z0-9-]+) -->\\n([\\s\\S]*?)\\n<!-- ${MARKER_PREFIX}:end:\\1 -->`,
  "g",
);

/**
 * Extracts the marked sections from the reference document. Trailing
 * whitespace is normalized away so the check compares content, and a
 * duplicated section id fails instead of silently winning.
 */
export function extractInstructionDocSections(markdown: string): ReadonlyMap<string, string> {
  const sections = new Map<string, string>();
  for (const match of markdown.matchAll(SECTION_PATTERN)) {
    const id = match[1]!;
    if (sections.has(id)) throw new Error(`duplicated instruction doc section "${id}"`);
    sections.set(id, match[2]!.trimEnd());
  }
  return sections;
}

/**
 * Replaces each marked region with the rendered content. Missing begin or
 * end markers fail closed so a hand edit can never silently orphan a section.
 */
export function applyInstructionDocSections(
  markdown: string,
  sections: ReadonlyMap<string, string>,
): string {
  let updated = markdown;
  for (const [id, content] of sections) {
    const begin = beginMarker(id);
    const end = endMarker(id);
    const beginIndex = updated.indexOf(begin);
    if (beginIndex < 0) throw new Error(`instruction doc is missing the begin marker for section "${id}"`);
    const contentStart = beginIndex + begin.length;
    const endIndex = updated.indexOf(end, contentStart);
    if (endIndex < 0) throw new Error(`instruction doc is missing the end marker for section "${id}"`);
    updated = updated.slice(0, contentStart) + `\n${content.trimEnd()}\n` + updated.slice(endIndex);
  }
  return updated;
}

/** Wraps one rendered section in its markers (used when seeding a new document). */
export function instructionDocSectionBlock(id: InstructionDocSectionId, content: string): string {
  return `${beginMarker(id)}\n${content.trimEnd()}\n${endMarker(id)}`;
}
