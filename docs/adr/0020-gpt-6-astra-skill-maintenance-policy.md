# ADR 0020: Capable-model skill maintenance policy

## Status

Accepted. Refines [ADR 0001](0001-skill-slimming-and-maintenance-policy.md). The keep/slim/remove model and all local safety and update rules remain in force.

## Context

OpenAI's [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra.md) recommends precise, short descriptions, progressive disclosure, minimal router roots, and less procedural handholding. It also identifies overly cautious decision boundaries and premature stopping as risks.

These observations refine the existing local policy rather than replace it. Installed skills serve agents with different models and harnesses. Durable guidance must preserve mixed-model compatibility, exact local tool protocols, and safety invariants instead of assuming one model's judgment is sufficient.

Skill updates in this repository are manual. Upstream content is input, not final truth; local invariants determine what is adopted, adapted, or rejected.

## Decision

### Route by intent

- Use the shortest sufficient description that identifies the capability and the user intent that should activate it.
- Disambiguate adjacent skills with concrete scope boundaries and near-miss requests. Avoid broad topic triggers that capture unrelated work.
- Keep procedures, command catalogs, and reference lists out of descriptions. Put execution details in the body or linked resources.
- Judge description length by routing precision and applicable harness constraints, not an arbitrary local character cap.

### Keep runtime guidance selective

- Keep roots compact. For multi-workflow skills, make `SKILL.md` a minimal router with shared constraints and clear pointers to the relevant workflow.
- Use progressive disclosure. Load references, scripts, and assets only when the task needs them; keep safety gates visible before the actions they govern.
- Keep long content in one authoritative location. Do not duplicate it across roots, references, or maintenance docs.
- Remove rigid itineraries and model-era handholding unless correctness, safety, or compatibility requires them. Retain exact commands and ordered procedures when their precision matters.
- Preserve guidance needed by supported models and harnesses. Do not remove a safeguard merely because one model appears capable without it.

### Define proportional boundaries and completion

- Match decision boundaries to risk. Distinguish already-authorized, reversible local work from actions that require clarification or explicit approval.
- Avoid repeated approval for work already within the user's authorization. Preserve every local gate for hosted-service mutations, destructive actions, secrets, and scope changes.
- Define completion where early stopping is likely: the agreed deliverable, relevant checks, and correction of failures caused by the change.
- Identify real stop conditions such as missing authority, evidence, or dependencies. Report incomplete work when blocked; completion guidance never authorizes broader scope or bypasses a gate.

### Validate behavior, not size alone

- Inspect positive triggers, adjacent-skill near misses, workflow selection, decision boundaries, and completion behavior before and after an upstream sync.
- Use checks proportional to the change and risk. Static validation is necessary but cannot prove useful routing or task completion.
- Use representative cases and baseline comparisons when warranted. Reduced context size is a diagnostic, not sufficient evidence of improvement.

## Consequences

- The [local invariants](../skills/local-skill-update-invariants.md) and [slimming process](../skills/skill-slimming-process.md) carry the mandatory checks for future manual updates.
- The [maintenance README](../skills/README.md) remains the entry point. Relevant update-process docs preserve source-specific ownership and local overlays.
- The local [skill-creator update process](../skills/skill-creator-update-process.md) must preserve this policy across both OpenAI and Anthropic syncs.
- Existing safety, browser routing, Figma, Python execution, metadata, and maintenance rules remain unchanged. No automatic updater or model-specific runtime branch is introduced.
- Applying this policy to other installed skills remains separate scoped work; this decision does not itself reclassify or remove skills.

## Validation

- Check agreement between this ADR, canonical maintenance docs, and `skill-creator` guidance.
- Preserve the reusable update prompt verbatim in a clearly labeled copy/paste block in the maintenance README.
- Run target and all Local Skill validators. Verify metadata, changed Markdown links, and absence of generated artifacts in skill folders.
- Review semantics as well as structure. Record untested behavior rather than claiming that static checks prove model compliance.
