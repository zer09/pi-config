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

Legacy settings from `google.cloudApiKeyEnv`, `exa.apiKeyEnv`, and `geminiExaGrounding` (`model`, `cacheDir`, `rawResponseTtlMs`, `contentCacheTtlMs`, `numResults`, `maxHighlightCharacters`) keep loading when the new sections are absent. The legacy single Exa budget applies to both depth budgets; the legacy `searchType` value is ignored because the extension uses Exa type `fast` only.

## Provider request contracts

- Gemini grounding: `POST https://aiplatform.googleapis.com/v1/publishers/google/models/<model>:generateContent` with `x-goog-api-key`. The raw REST tool is `parallelAiSearch` (optional `api_key`, `customConfigs.mode`) or `exaAiSearch` (`api_key`, `customConfigs` with `type`, `numResults`, `contents.highlights.maxCharacters`). This API-key transport is retained from the previous design; the documented OAuth/project-location endpoint migration is deferred.
- Firecrawl Developer Index: `POST https://api.firecrawl.dev/v2/search/developer` with `query`, `k`, `passages`, and optional `types`.
- Exa Code: `POST https://api.exa.ai/context` with `query` and `tokensNum: "dynamic"`.
- Firecrawl Scrape: `POST https://api.firecrawl.dev/v2/scrape` with `formats: ["markdown"]`, `onlyMainContent: true`, `maxAge` (milliseconds), and `timeout`. No LLM-based cleaning or extraction formats are enabled.
- Exa Contents: `POST https://api.exa.ai/contents` with `urls`, `text.maxCharacters`, and `maxAgeHours`. The deprecated `context` and `livecrawl` fields are not used.

## Fallback rules

Fallback is operational, never a second opinion. It starts for missing optional partner credentials when the provider cannot operate, transport failures, timeouts, HTTP 401/402/403/429/5xx, nested adapter errors, malformed responses, empty answers or content, no usable grounding sources, non-`STOP` grounding finishes, and zero usable code-search results. It never starts for caller cancellation, invalid local input, or a prompt safety block. A missing Google credential is terminal for `web_search` because both grounding partners share the Google transport. The intermittent nested Exa empty-query failure is retried exactly once; no other Exa failure retries automatically.

## Cache behavior

- Raw provider exchanges are stored under `<cacheDir>/responses/` for one month, keyed by response ID.
- Content is cached under `<cacheDir>/contents/` by normalized-URL SHA-256 for one month of physical retention.
- Freshness is separate from retention: an entry is usable only when its fetch age satisfies the current `maxAgeHours`. Stale entries stay on disk but are not used for the current request, and unrelated cache files are never deleted as a migration step.
- `maxAgeHours: 0` skips local cache reads for satisfaction and forwards `maxAge: 0` (Firecrawl) and `maxAgeHours: 0` (Exa).
- Cache entries record their original provider (`firecrawl_scrape` or `exa_contents`); legacy entries without provider metadata remain readable.
- Only non-empty successful content is cached. Duplicate input URLs are fetched once and reproduced in output order; partial success is returned.

## Privacy and redaction

Every stored request and response passes deep redaction covering `GOOGLE_CLOUD_API_KEY`, `PARALLEL_API_KEY`, `EXA_API_KEY`, and `FIRECRAWL_API_KEY`, including nested body copies and headers. Provider errors stay in private details and stored records; they never enter model-visible output.

## Tests

Deterministic, no network:

```bash
cd agent/extensions/web-search && bun test
```

All HTTP calls are stubbed, caches use temporary directories, and environment variables use test-only names.

## Live smoke testing

Live provider compatibility was not tested in this change. Any smoke test is a separate user-authorized action with real credentials supplied through the normal environment and an isolated cache directory.
