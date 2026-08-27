# ADR 0014: Route web-search providers behind three agent-selected tools

## Status

Accepted (2026-08-27). An authorized isolated live-provider smoke matrix later passed 9/9; see the Consequences section.

Note on numbering: the handoff that authorized this change referenced ADR 0010. ADRs 0010 and 0011 already existed when implementation started, so the branch initially used 0012. The merge with `master` added ADRs 0012 and 0013 independently, so this decision uses the next free number, 0014.

## Context

The web-search extension exposed two tools, `web_search` and `fetch_contents`. `web_search` sent every query through Gemini with native Exa grounding and, on failure, fell back to a direct Exa web search whose route was chosen by a regex-and-keyword-score classifier (`classifyFallbackRoute` / `selectFallbackRoute`) or by a `mode: "auto" | "web" | "code"` parameter. The classifier was opaque, untestable against real intent, and mixed semantic routing with operational fallback. `fetch_contents` used Exa `/contents` as its only content provider.

At the same time, three provider families became materially better fits for distinct research intents: Parallel for general grounded web research inside Gemini, the Firecrawl Developer Index for typed developer-source artifacts (docs, READMEs, issues, pull requests), and Exa's Context API for implementation-ready code context. Firecrawl Scrape became the stronger full-page Markdown extractor.

## Decision

Replace the two-tool surface with three agent-selected semantic tools and move all provider selection inside the extension:

- `web_search({ query, depth? })`: Gemini + Parallel grounding is always attempted first (`basic` for standard depth, `advanced` for deep). Gemini + Exa grounding runs only after an eligible Parallel failure, with Exa type `fast` and depth-dependent budgets (5 results / 2000 highlight characters standard, 10 / 4000 deep). The `mode` parameter and the direct Exa web-search fallback are removed.
- `web_code_search({ query, focus })`: `focus` is required and selects the route. `developer_sources` runs Firecrawl Developer first with Exa Code as a degraded fallback. `implementation_examples` runs Exa Code first with a Firecrawl Developer fallback restricted to `doc` and `readme` result types.
- `fetch_contents({ uris, maxCharacters?, maxAgeHours? })`: usable local cache first, then Firecrawl Scrape (`formats: ["markdown"]`, `onlyMainContent: true`, no LLM-based formats) with bounded concurrency (default 3), then one batched Exa Contents call for only the Firecrawl-failed URLs. `maxAgeHours` (0..720, default 24) controls freshness; physical cache retention stays one month and separate.

Rejected alternatives:

- Keep the query classifier and route automatically. Rejected: the classifier could not be validated against real intent, mixed semantic and operational concerns, and the tool schema is a strictly more reliable intent signal.
- Add an `auto` code focus or a public provider selector. Rejected: both reintroduce hidden routing decisions and provider names into the model-visible surface.
- Call the Parallel Search API directly. Rejected for this change: Parallel is consumed only through Gemini native grounding, keeping one transport and one billing path for web answers.
- Firecrawl general web search, full-site crawl/map, and LLM extraction formats. Rejected: out of scope for the accepted narrow migration and some carry extra cost.
- Migrate Gemini calls to the documented OAuth/project-location endpoint. Deferred: the current global endpoint with `x-goog-api-key` is operational and was proven against the Exa adapter in the 2026-08 empty-query finding; combining provider routing with an auth migration would make either failure unattributable.
- Provider SDKs. Rejected: direct REST calls through the existing `fetch` transport keep the extension dependency-free.

## Operational fallback and cancellation rules

Fallback starts only for operational causes: missing optional partner credential when the provider cannot operate, transport failure, timeout, HTTP 401/402/403/429/5xx, provider-specific nested adapter errors, malformed responses, empty answers or content, no usable grounding sources, non-`STOP` grounding finishes, and zero usable code-search results. Fallback never starts after caller cancellation or an already-aborted signal, for invalid local input, or for a prompt safety block. A missing Google credential is terminal for `web_search` because both grounding partners share the Google transport. The known nested Exa empty-query failure retries exactly once; no other Exa failure retries automatically.

## Freshness versus retention

Content cache entries keep `expiresAt` as the physical cleanup deadline (one month) while per-call usability additionally requires the fetch age to satisfy the current `maxAgeHours`. Stale entries remain on disk for their TTL and are simply not used for the current request. `maxAgeHours: 0` bypasses local cache reads for satisfaction and forwards `maxAge: 0` / `maxAgeHours: 0` to the providers. No existing cache file is rewritten or deleted as a migration step, and legacy Exa entries without provider metadata remain readable.

## Security

Stored raw requests and responses pass deep redaction covering `GOOGLE_CLOUD_API_KEY`, `PARALLEL_API_KEY`, `EXA_API_KEY`, and `FIRECRAWL_API_KEY`, including nested body copies and `Authorization` headers. Provider errors live in private details and stored records only and never enter model-visible output. All tests stub HTTP, use temporary caches, and use test-only environment-variable names; no live provider call is made by the test suite.

## Consequences

- The agent now expresses research intent explicitly (web answer, developer sources, implementation examples, URL content), and both web tools may be used in one task.
- Tool metadata grows by a measured 463 local `o200k_base` tokens at startup (see `docs/config-context-cost.md`); no provider-calibrated numbers are claimed.
- Parallel, Firecrawl Developer, Firecrawl Scrape, Exa Code, and Exa Contents compatibility is implemented from official request documentation and deterministic mocked HTTP. A separate user-authorized 9/9 live smoke matrix passed on 2026-08-27 using an isolated temporary cache; no live call is part of the automated test suite.
- The Gemini OAuth/project-location endpoint migration remains open and is now the main known transport follow-up.
