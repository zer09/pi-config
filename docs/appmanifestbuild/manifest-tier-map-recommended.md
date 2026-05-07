# Manifest Tier Map (Recommended)

## Context

Use case: programming, planning, and design with providers available in Manifest:

- OpenAI
- Anthropic
- Gemini
- MiniMax

Cursor should not be the only dependency in routing tiers unless Manifest has a stable first-class Cursor integration in your account. Keep Cursor as optional/custom until reliability is proven.

## Tier Map

### 1) Simple

- Primary: Gemini Flash (cheapest fast model)
- Fallback 1: MiniMax fast/cheap model
- Fallback 2: OpenAI mini/nano class model

Use for:

- quick rewrites
- naming
- tiny refactors
- short Q&A

### 2) Standard

- Primary: Claude Sonnet class model
- Fallback 1: GPT-5 mini class
- Fallback 2: Gemini Pro class

Use for:

- routine coding tasks
- medium code generation
- test writing
- moderate debugging

### 3) Complex

- Primary: GPT-5 class model
- Fallback 1: Claude Opus class model
- Fallback 2: Gemini strongest Pro class model

Use for:

- multi-file implementation plans
- deep refactors
- architecture tradeoff analysis
- difficult debugging

### 4) Reasoning

- Primary: Claude Opus class model
- Fallback 1: GPT-5 class model
- Fallback 2: MiniMax strongest reasoning model

Use for:

- architecture/design docs
- system decomposition
- ambiguous problem solving
- high-stakes technical decisions

## Task-to-Tier Overrides

- Architecture/design docs -> Reasoning
- Implementation planning/breakdown -> Complex
- Boilerplate/code transforms/tests -> Standard
- Small edits and quick refactors -> Simple

## Reliability Rules

- Keep at least 2 fallbacks per tier.
- Do not put the same provider in every slot of a tier.
- Ensure each tier has cross-provider fallback.

## Cost and Latency Guardrails

- Provider timeout per attempt: 45-90s
- Budget alerts: 50%, 80%, 100%
- Avoid premium models in Simple and Standard by default
- Keep chain length >= 2 in all tiers

## Rollout Plan

1. Configure tiers and fallbacks.
2. Run 20-30 real prompts across your workload.
3. Inspect routing logs for selected model, latency, and cost.
4. Adjust Simple/Standard first for cost; Complex/Reasoning for quality.
5. Re-check weekly until stable.
