# web-search

Pi extension exposing three agent-selected research tools with internal provider routing:

| Tool | Purpose | Provider routing |
| --- | --- | --- |
| `web_search` | Current, source-backed answers with inline citations | Gemini + Parallel grounding, then Gemini + Exa grounding after an eligible Parallel failure |
| `web_code_search` | Public developer sources and implementation context | `focus="developer_sources"`: Firecrawl Developer Index, then Exa Code (degraded). `focus="implementation_examples"`: Exa Code, then Firecrawl Developer restricted to `doc`/`readme` types |
| `fetch_contents` | Full Markdown for explicit public URLs | Usable local cache, then Firecrawl Scrape per URL, then Exa Contents for the Firecrawl-failed URLs |

The agent selects semantic intent through the public tool schemas. Internal routing handles only provider availability and operational failure. There is no query classifier, no `auto` code focus, and no public provider selector. A single task may call both `web_search` and `web_code_search`.

## Public schemas

```ts
web_search({ query: string, depth?: "standard" | "deep" })
web_code_search({ query: string, focus: "developer_sources" | "implementation_examples" })
fetch_contents({ uris: string[], maxCharacters?: number, maxAgeHours?: number })
```

- `depth` omitted or `"standard"` uses Parallel mode `basic` and, on fallback, Exa `fast` with 5 results and 2000 highlight characters.
- `depth: "deep"` uses Parallel mode `advanced` and, on fallback, Exa `fast` with 10 results and 4000 highlight characters.
- `focus` is required and selects the provider order; it is never inferred from the query.
- `fetch_contents` accepts at most 25 explicit URLs per call and `maxCharacters` at most 50000; the runtime rejects larger inputs as `invalid_input` before any config load, cache read, provider call, or cache write, so invalid input always wins over a failing config loader. Exceeding the URL cap fails with `uris must contain at most 25 URLs` and exceeding the character cap with `maxCharacters must be a positive integer no greater than 50000`; only safe metadata (the URL count and any valid numeric limit fields supplied) is stored for these preflight failures. Input validation is config-independent (`validateFetchContentsInput`); the absent `maxAgeHours` default resolves only after the config loads from `contents.defaultMaxAgeHours`.
- `maxAgeHours` accepts integers from 0 through 720 and defaults to 24. `0` bypasses the local content cache and requests fresh provider content.

## Environment variables

Default names (all optional to set; `web_search` requires the Google key at call time):

```text
GOOGLE_CLOUD_API_KEY   Google transport key, shared by both grounding partners
PARALLEL_API_KEY       optional Parallel partner key; omitted from the request when unset
EXA_API_KEY            Exa key for Exa grounding, Exa Code, and Exa Contents
FIRECRAWL_API_KEY      optional Firecrawl bearer key; requests may run unauthenticated
```

`PARALLEL_API_KEY` stays optional because Google Cloud Marketplace subscriptions can ground without a bring-your-own key. Firecrawl requests include `Authorization: Bearer` only when configured.

## Optional config

An optional `config.json` next to `index.ts` (not tracked; never put credentials in it) supports provider-neutral sections with defaults:

```json
{
  "google": { "cloudApiKeyEnv": "GOOGLE_CLOUD_API_KEY" },
  "parallel": { "apiKeyEnv": "PARALLEL_API_KEY" },
  "exa": { "apiKeyEnv": "EXA_API_KEY" },
  "firecrawl": { "apiKeyEnv": "FIRECRAWL_API_KEY" },
  "webSearch": {
    "model": "gemini-3.5-flash",
    "defaultDepth": "standard",
    "parallel": { "standardMode": "basic", "deepMode": "advanced" },
    "exaGrounding": {
      "standard": { "type": "fast", "numResults": 5, "maxHighlightCharacters": 2000 },
      "deep": { "type": "fast", "numResults": 10, "maxHighlightCharacters": 4000 }
    }
  },
  "codeSearch": {
    "firecrawl": { "k": 10, "passages": 2 },
    "exaCode": { "tokensNum": "dynamic" }
  },
  "contents": { "defaultMaxAgeHours": 24, "concurrency": 3, "scrapeTimeoutMs": 60000 },
  "cache": { "dir": "~/.pi/web_search_cache", "rawResponseTtlMs": 2592000000, "contentCacheTtlMs": 2592000000 }
}
```

Legacy settings from `google.cloudApiKeyEnv`, `exa.apiKeyEnv`, and `geminiExaGrounding` (`model`, `cacheDir`, `rawResponseTtlMs`, `contentCacheTtlMs`, `numResults`, `maxHighlightCharacters`) keep loading when the new sections are absent. The legacy single Exa budget applies to both depth budgets; the legacy `searchType` value is ignored because the extension uses Exa type `fast` only. `contents.concurrency` is honored only for integers 1 through 10 (default 3); every other value silently falls back to 3, and the orchestrator additionally hard-caps concurrent scrapes at 10 even for injected configurations.

## Provider request contracts

- Gemini grounding: `POST https://aiplatform.googleapis.com/v1/publishers/google/models/<model>:generateContent` with `x-goog-api-key`. The raw REST tool is `parallelAiSearch` (optional `api_key`, `customConfigs.mode`) or `exaAiSearch` (`api_key`, `customConfigs` with `type`, `numResults`, `contents.highlights.maxCharacters`). This API-key transport is retained from the previous design; the documented OAuth/project-location endpoint migration is deferred.
- Firecrawl Developer Index: `POST https://api.firecrawl.dev/v2/search/developer` with `query`, `k`, `passages`, and optional `types`.
- Exa Code: `POST https://api.exa.ai/context` with `query` and `tokensNum: "dynamic"`.
- Firecrawl Scrape: `POST https://api.firecrawl.dev/v2/scrape` with `formats: ["markdown"]`, `onlyMainContent: true`, `maxAge` (milliseconds), and `timeout`. No LLM-based cleaning or extraction formats are enabled.
- Exa Contents: `POST https://api.exa.ai/contents` with `urls`, `text.maxCharacters`, and `maxAgeHours`. The deprecated `context` and `livecrawl` fields are not used.

## Fallback rules

Fallback is operational, never a second opinion. It starts for missing optional partner credentials when the provider cannot operate, transport failures, timeouts, HTTP 401/402/403/429/5xx, nested adapter errors, malformed responses, empty answers or content, no usable grounding sources, non-`STOP` grounding finishes, zero usable code-search results, and Firecrawl Scrape target pages whose own status (`metadata.statusCode`) is 4xx or 5xx even when the Firecrawl wrapper response is 2xx with non-empty error-page Markdown. Such target pages are recorded as `unusable_response`, their error-page Markdown is never returned or cached, and the URL moves to the Exa Contents fallback; absent, 2xx, and 3xx target statuses stay usable. Fallback never starts for caller cancellation, invalid local input, or a prompt safety block. A missing Google credential is terminal for `web_search` because both grounding partners share the Google transport. The intermittent nested Exa empty-query failure is retried exactly once; no other Exa failure retries automatically.

## Exa Contents result identity

A requested URL receives Exa Contents content only from the result carrying the same normalized URL. Result identity precedence is the normalized `url`, then `uri`, then a URL-like `id`, and status entries are matched through the same normalized identity, never by position. Positional attribution survives only as legacy tolerance when exactly one URL was requested and the single returned result carries no identity of its own. In unordered or partial multi-URL batches an unidentified result is never assigned to any request, a lone unidentified result is never applied to several requested URLs, and unmatched URLs stay empty, non-cacheable failures that are never written under another URL's cache key.

## Cache behavior

- Raw provider exchanges are stored under `<cacheDir>/responses/` for one month, keyed by response ID.
- Content is cached under `<cacheDir>/contents/` by normalized-URL SHA-256 for one month of physical retention.
- Freshness is separate from retention: an entry is usable only when its fetch age satisfies the current `maxAgeHours`. Stale entries stay on disk but are not used for the current request, and unrelated cache files are never deleted as a migration step.
- `maxAgeHours: 0` skips local cache reads for satisfaction and forwards `maxAge: 0` (Firecrawl) and `maxAgeHours: 0` (Exa).
- Cache entries record their original provider (`firecrawl_scrape` or `exa_contents`); legacy entries without provider metadata remain readable.
- Only non-empty successful content is cached. Duplicate input URLs are fetched once and reproduced in output order; partial success is returned.

## Diagnostic records

Every tool call gets a `responseId` (form `wse_<time>_<random>`) generated at execution start, and every completed call persists one redacted JSON diagnostic record under the existing `<cacheDir>/responses/` path with the existing `rawResponseTtlMs` retention and cleanup policy.

- `web_search` and `web_code_search` records (`schemaVersion: 2`, `tool` discriminator) keep their existing shape: selected provider, chronological `attempts`, and legacy mirrored fields for `web_search`.
- `fetch_contents` records (`schemaVersion: 2`, `tool: "fetch_contents"`) carry safe request metadata (URL count, unique normalized URL count, effective `maxCharacters`, effective `maxAgeHours`), per-URL result metadata (provider, cache-hit status, bounded status label), and provider attempts in canonical dispatch order: one Firecrawl Scrape attempt per unique URL, one Exa Contents attempt per fallback batch, plus explicit `skipped` attempts when the Exa fallback is skipped for a missing Exa key or an abort. Every attempt receives a strictly increasing dispatch ordinal before it starts; stored attempts, tool details, and TUI attempt lists use that dispatch order, never completion order, and the Exa fallback always follows all Firecrawl attempts of the call. Each attempt records provider, affected URLs, `requestStartedAt`, `elapsedMs`, raw request/response when available, safe normalized metadata (status codes and character counts only), and a status class (`success`, `http_error`, `transport_error`, `unusable_response`, `aborted`, `skipped`). Full fetched Markdown is never duplicated into attempt metadata beyond the single retained raw provider body.
- Preflight records (`phase: "preflight"`) are persisted when a tool fails locally after execution begins: invalid input (`category: "invalid_input"`, limited to invalid parameters and URL normalization failures), a terminal missing credential such as the Google key for `web_search` (`category: "missing_credentials"`), or a configuration-load failure (`category: "config_load_failure"`). Operational failures after validation (corrupt cache JSON, cache read failures other than a missing entry, cache write failures, and unexpected operational rejections) are rethrown unchanged: they get no preflight record and no diagnostic suffix. Preflight records store only the tool name, category, bounded sanitized error text, safe metadata available at the failure stage (never raw invalid parameter values), and an empty attempt list. When the configuration itself failed to load, the record uses the default cache directory, the default raw-response TTL, and the default credential env names for redaction.
- Diagnostic writes are best-effort for every record a tool persists: a failed write never masks the original tool error, never fails a `fetch_contents` call that already produced entries, and never fails a `web_search` or `web_code_search` call that already produced a usable answer or an unavailable-provider outcome. Only diagnostic persistence failures are swallowed; provider, configuration, validation, and orchestration failures still surface unchanged. Preflight errors still throw through the normal tool error path with a stable generic suffix `Diagnostic responseId=<id>` attached (the ID contains only safe identifier characters).
- Tool details and the TUI summary include the `responseId` for `fetch_contents`, and all three tools expose safe summaries: selected provider (or none), provider list/attempt count, failure categories, and elapsed time. Raw provider errors never appear in model-visible output, tool details, or TUI summaries; failed fetch entries keep the generic `fetch failed` label.
- Failure categories classify by cause, checking the numeric HTTP status before any normalized body: `null` exactly when the same usability predicate that routes providers accepts the attempt (a parsed clean Gemini grounding answer, a Firecrawl success with artifacts, or an Exa Code response with non-empty text and an absent or nonzero `resultsCount`). Any non-2xx status is `http_<status>` even when the body parsed, a 2xx body that did not parse is `unparsed`, grounding prompt blocks and non-`STOP` finishes are `blocked_<reason>` and `finish_<reason>`, and remaining causes are `no_results`, `provider_failure`, `empty_response`, `error`, `unusable`, or `skipped_missing_credentials`/`transport_error` when no HTTP status exists.

### Retention bounds and inspection

- Diagnostic strings (errors, skipped reasons, header values) are truncated at 500 characters and raw provider bodies at 20 000 characters, each ending with the deterministic marker `[truncated at <n> characters]` when applied. The same bounds apply to every stored attempt of all three tools. Attempt request bodies of all three tools are stored as bounded serialized strings, and the parsed `bodyJson` copy of a raw response is dropped from every stored attempt so a page is stored once. Stored main-record queries and preflight query metadata are bounded at 2 000 characters with complete secret values replaced before truncation.
- Stored normalized responses are explicit bounded copies, never raw references: `web_search` answers at 20 000 characters with finish/block/model/ID/domain/title/URL/support-text/query strings bounded at 500 (URLs through the 500-character prefix-plus-digest bound), at most 25 sources, 25 supports, 25 generated search queries, and at most 25 grounding chunk indices per support, each with retained total/omitted counters. Arbitrary `usageMetadata` keeps its ordinary shape only when its redacted serialized form fits 20 000 characters; anything larger becomes an explicit `{ diagnosticPreview, diagnosticPreviewTruncated }` bounded wrapper, and deeply nested, cyclic, or otherwise unserializable values (whose recursive redaction or serialization fails) become the constant omission wrapper, so provider-controlled metadata can never throw out of record construction and mask a usable tool outcome. `web_code_search` stores the Exa Code response at 20 000 characters, at most 25 Firecrawl artifacts with at most 25 passages each and total/omitted counters, every non-response field bounded at 500, and arbitrary coverage/cost values serially bounded to 500 characters through the same small-shape-or-preview-wrapper rule with the same hardening against pathological values. The top-level `web_search` normalized field references the bounded copy of the selected attempt, never an unbounded duplicate.
- Every persisted URL copy in fetch records (attempt URL lists, per-URL results, normalized per-URL metadata, request URLs of all tools including `web_search`/`web_code_search` raw requests) is bounded at 500 characters: complete secret values are replaced on the full URL before truncation, URLs at or under the bound stay readable verbatim, and longer URLs keep a readable prefix plus a deterministic `[+sha256:<12 hex>]` digest of the complete redacted URL so distinct long URLs remain distinguishable. Model-visible `fetch_contents` URL copies (tool output text, tool details, and the TUI fetched-URL list) reuse the same redacted, bounded copies; provider calls and cache identity keep the full normalized URL, and the renderer reads only the bounded details copies so raw values are never reintroduced.
- Fetch result status labels are provider-controlled strings: every stored copy is redacted, stripped of terminal control sequences, and bounded at 500 characters, `fetch_contents` tool details reuse those redacted stored statuses, and every model-visible status copy is likewise stripped and bounded at 500.
- Collection cardinality in fetch records is capped to the reachable maximum of the 25-URL input limit: 26 attempts (25 Firecrawl Scrape plus one Exa Contents batch), 25 per-URL results, 25 URLs per attempt, and 25 per-URL normalized entries per attempt. Each capped collection carries retained total/omitted counts in the record schema (`attemptsTotal`/`attemptsOmitted`, `resultsTotal`/`resultsOmitted`, `urlsTotal`/`urlsOmitted`, `perUrlTotal`/`perUrlOmitted`), and the earliest attempts in canonical dispatch order are the ones retained. The deterministic worst-case serialized record size stays under approximately 2 MB compact (roughly 3 MB pretty-printed), far below the previous ~9.5 MB bound.
- Model-visible `fetch_contents` output and `web_code_search` output are each capped at 50 000 characters with a deterministic truncation marker; the code cap covers both the Exa Code response document and Firecrawl artifact/passage lists without changing provider selection or details.
- `web_search` tool details may include a bounded, redacted `fallbackReason` derived from the bounded stored attempt (embedded provider error text is already redacted and capped at the 500-character diagnostic string bound); raw provider errors remain absent from model-visible content and the TUI.
- The stored schema version stays `2`: every change above is an in-field bound or an additive counter, previously written records remain readable, and readers tolerate records without the new fields (stored-body compatibility). No stored field changed its name or required shape.
- An Exa Contents attempt that returned 2xx is `success` only when at least one requested URL produced usable content (non-empty trimmed text and no failure-like provider status, the same predicate as returned and cacheable entries); otherwise the attempt is `unusable_response` with `normalized.success=false`, while one usable URL in a mixed batch keeps the attempt successful and failed URLs stay generic failed entries.
- Records are plain redacted JSON named `<responseId>.json`. Inspection is manual filesystem access only: read `<cacheDir>/responses/<responseId>.json` with any local file reader. No inspector command, tool, script, or slash command exists or will be added for this purpose.

## Privacy and redaction

Every stored request and response passes deep redaction covering `GOOGLE_CLOUD_API_KEY`, `PARALLEL_API_KEY`, `EXA_API_KEY`, and `FIRECRAWL_API_KEY`, including nested body copies and headers; preflight records use the configured (or default) credential env names for the same redaction. Complete secret values are replaced before any control stripping or truncation is applied, so a secret crossing a 500- or 20 000-character cutoff cannot survive as a partial fragment; storage-level deep redaction remains as defense in depth. Provider errors stay in private details and stored records; they never enter model-visible output.

## Tests

Deterministic, no network:

```bash
cd agent/extensions/web-search && bun test
```

All HTTP calls are stubbed, caches use temporary directories, and environment variables use test-only names.

## Live smoke testing

An authorized isolated live smoke matrix for PR #13 passed 9/9 on 2026-08-27 using a temporary cache directory and real credentials supplied through the normal environment; the live checkout and live cache were verified unchanged afterward. The first deep `web_search` request received a transient Parallel HTTP 429: the Exa fallback succeeded for that answer, and a retry roughly 65 seconds later reached Parallel successfully in `advanced` mode. Any future smoke test is likewise a separate user-authorized action with an isolated cache directory.
