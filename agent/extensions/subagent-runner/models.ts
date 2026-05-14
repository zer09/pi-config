import { spawnSync } from "node:child_process";
import {
  BANNED_SUBAGENT_MODELS,
  MAX_MODEL_SUGGESTIONS,
  MODEL_THINKING_LEVELS,
} from "./constants.ts";
import { replaceHome } from "./path-utils.ts";
import type {
  AvailableModel,
  ModelResolution,
  ModelSelector,
} from "./types.ts";

export function splitModelSelector(value: string): ModelSelector {
  const raw = value.trim();
  let base = raw;
  let thinkingSuffix = "";
  const suffixIndex = raw.lastIndexOf(":");
  if (suffixIndex > 0) {
    const suffix = raw.slice(suffixIndex + 1).trim();
    if (MODEL_THINKING_LEVELS.has(suffix)) {
      base = raw.slice(0, suffixIndex).trim();
      thinkingSuffix = `:${suffix}`;
    }
  }

  const slashIndex = base.indexOf("/");
  if (slashIndex > 0 && slashIndex < base.length - 1) {
    return {
      raw,
      provider: base.slice(0, slashIndex).trim(),
      model: base.slice(slashIndex + 1).trim(),
      thinkingSuffix,
    };
  }

  return { raw, model: base, thinkingSuffix };
}

function formatModelSuggestion(
  model: AvailableModel,
  thinkingSuffix = "",
): string {
  return `${model.provider}/${model.model}${thinkingSuffix}`;
}

function isBannedSubagentModel(model: string): boolean {
  return BANNED_SUBAGENT_MODELS.has(model.trim().toLowerCase());
}

function allowedModelCandidates(models: AvailableModel[]): AvailableModel[] {
  return models.filter((model) => !isBannedSubagentModel(model.model));
}

function uniqueSuggestions(
  models: AvailableModel[],
  thinkingSuffix = "",
): string[] {
  return [
    ...new Set(
      allowedModelCandidates(models).map((model) =>
        formatModelSuggestion(model, thinkingSuffix),
      ),
    ),
  ].slice(0, MAX_MODEL_SUGGESTIONS);
}

export function parseListModelsOutput(output: string): AvailableModel[] {
  const models: AvailableModel[] = [];
  let inTable = false;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^provider\s+model\s+/i.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable || line.startsWith("[") || /^No models matching/i.test(line))
      continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+/);
    if (!match) continue;
    models.push({ provider: match[1], model: match[2] });
  }
  return models;
}

export function resolveModelFromListOutput(
  requestedModel: string,
  listModelsOutput: string,
): ModelResolution {
  const selector = splitModelSelector(requestedModel);
  if (!selector.raw || !selector.model) {
    return {
      ok: false,
      requested: requestedModel,
      diagnostic: "Sub-agent model is blank.",
      blockers: ["invalid_model"],
      suggestions: [],
    };
  }

  const candidates = parseListModelsOutput(listModelsOutput);
  if (isBannedSubagentModel(selector.model)) {
    const suggestions = uniqueSuggestions(candidates, selector.thinkingSuffix);
    const alternative = suggestions.length
      ? ` Use a non-Spark model such as ${suggestions.join(", ")}.`
      : " Use a non-Spark model.";
    return {
      ok: false,
      requested: requestedModel,
      diagnostic: `Sub-agent model "${requestedModel}" is not allowed for subagent_run. GPT-5.3-Codex-Spark is banned for child agents.${alternative}`,
      blockers: ["banned_model"],
      suggestions,
    };
  }

  const allowedCandidates = allowedModelCandidates(candidates);
  const sameModel = allowedCandidates.filter(
    (candidate) => candidate.model === selector.model,
  );
  const matching = selector.provider
    ? sameModel.filter((candidate) => candidate.provider === selector.provider)
    : sameModel;

  if (matching.length === 1) {
    return {
      ok: true,
      requested: requestedModel,
      model: formatModelSuggestion(matching[0], selector.thinkingSuffix),
      suggestions: uniqueSuggestions(
        allowedCandidates,
        selector.thinkingSuffix,
      ),
    };
  }

  if (matching.length > 1) {
    const suggestions = uniqueSuggestions(matching, selector.thinkingSuffix);
    return {
      ok: false,
      requested: requestedModel,
      diagnostic: `Sub-agent model "${requestedModel}" is ambiguous. Use a provider-qualified model id such as ${suggestions.join(", ")}.`,
      blockers: ["ambiguous_model"],
      suggestions,
    };
  }

  const suggestions = uniqueSuggestions(
    sameModel.length ? sameModel : allowedCandidates,
    selector.thinkingSuffix,
  );
  const diagnostic = suggestions.length
    ? `Sub-agent model "${requestedModel}" is not an exact available model. Use a provider-qualified model id such as ${suggestions.join(", ")}.`
    : `Sub-agent model "${requestedModel}" is not available according to Pi's model list.`;
  return {
    ok: false,
    requested: requestedModel,
    diagnostic,
    blockers: ["invalid_model"],
    suggestions,
  };
}

export function resolveSubagentModel(
  model: string | undefined,
): ModelResolution | null {
  if (!model?.trim()) return null;
  const selector = splitModelSelector(model);
  const command = process.env.PI_SUBAGENT_PI_BIN || "pi";
  const args = ["--list-models", selector.model];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error) {
    return {
      ok: false,
      requested: model,
      diagnostic: `Could not validate sub-agent model "${model}": ${replaceHome(result.error.message)}`,
      blockers: ["model_validation_failed"],
      suggestions: [],
      command: `${command} --list-models ${selector.model}`,
    };
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return {
      ok: false,
      requested: model,
      diagnostic: `Could not validate sub-agent model "${model}" because \`${command} --list-models ${selector.model}\` exited with code ${result.status}.`,
      blockers: ["model_validation_failed"],
      suggestions: [],
      command: `${command} --list-models ${selector.model}`,
    };
  }

  const resolution = resolveModelFromListOutput(model, output);
  if (!resolution.ok)
    return {
      ...resolution,
      command: `${command} --list-models ${selector.model}`,
    };
  return resolution;
}
