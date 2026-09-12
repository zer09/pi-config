# Using grill-with-docs

Use `grill-with-docs` as a guided planning and domain decision session. Review-only is the default: the agent compares the plan with code/docs and asks one material question at a time, with a recommendation. It stops when the requested plan decisions are resolved or remaining uncertainties are explicit.

Agreement on a term or decision does not authorize a repository write. Explicitly request documentation changes when you want them; the initialization prompts below do so. This skill does not implement the plan.

## Initialize CONTEXT.md in another repo

Run from the target repository root and ask:

```text
Use grill-with-docs to initialize CONTEXT.md for this repo.

First inspect the README, existing docs, package structure, and key domain modules. Then ask me one question at a time to clarify the domain language. Do not add implementation details. When terms are resolved, create or update CONTEXT.md using the grill-with-docs format.
```

## Initialize docs for a monorepo

Use this when the repo may contain multiple bounded contexts:

```text
Use grill-with-docs to decide whether this repo needs one CONTEXT.md or a CONTEXT-MAP.md with multiple bounded contexts.

Inspect the repo structure first. Recommend the setup, ask me to confirm unclear boundaries, then create the initial CONTEXT.md or CONTEXT-MAP.md.
```

## Normal workflow

1. Start from the target repo root.
2. Ask the agent to use `grill-with-docs` with a concrete plan, feature idea, or initialization request.
3. Let the agent inspect existing docs and code.
4. Answer one question at a time.
5. Keep resolved terms and proposed documentation changes in chat unless you explicitly requested repository changes. When authorized, update `CONTEXT.md` only for resolved terms within that scope.
6. Consider an ADR only when a decision is hard to reverse, surprising without context, and the result of a real trade-off. Explicitly request recording it before the agent creates it; a glossary-write request does not authorize unrelated ADRs.

## What belongs in CONTEXT.md

Use `CONTEXT.md` as a domain glossary:

```md
**Customer**:
A person or organization that buys the product.
_Avoid_: user, account, client
```

Include:

- Domain-specific terms.
- Relationships between domain concepts.
- Resolved ambiguous language.
- Short example dialogue that shows the terms in use.

Do not include:

- Implementation details.
- Framework/library concepts.
- Roadmaps, specs, or scratch notes.
- Generic programming terms.

Bad example:

```md
**Button Component**:
A reusable React component in src/components.
```

That is implementation detail, not domain language.

## ADR guidance

Do not create placeholder ADRs. Create `docs/adr/` lazily only when the first real ADR is ready and its creation is explicitly requested. Passing the test below makes an ADR worth offering, not automatically authorized.

An ADR is appropriate only when all three are true:

1. The decision is hard to reverse.
2. The decision would be surprising without context.
3. The decision involved a real trade-off.

Good ADR examples:

- Choosing an auth provider that would be expensive to replace.
- Choosing event-driven integration instead of synchronous HTTP between bounded contexts.
- Explicitly owning customer data in one context and referencing it by ID elsewhere.

Poor ADR examples:

- Adding a small utility library.
- Following the obvious framework default.
- Recording a decision that is easy to reverse.
