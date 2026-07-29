# Web search HTTP 400 empty-query failure and diagnostic output

Date: 2026-07-30

## Executive finding

The HTTP 400 is **not caused by an empty query from Pi**, and it does **not mean that `gemini-3.5-flash` is unsupported**.

The local tool sends a non-empty user query to Google. During native Gemini-to-Exa grounding, the provider path sends Exa a downstream search request whose `query` is empty. Exa rejects that downstream request with:

```text
Invalid request body | Validation error: Too small: expected string to have >=1 characters at "query"
```

The failure boundary is therefore inside the managed native-grounding path:

```text
Pi web_search
  -> Google generateContent with exaAiSearch
    -> Google/Gemini native Exa grounding adapter
      -> Exa Search API receives query=""
```

The available response does not expose whether Gemini generated an empty search query or Google's Exa adapter dropped it. It only proves that the local query was non-empty and Exa received an empty downstream query.

## Is Gemini 3.5 Flash supported?

Yes.

Two independent observations rule out a generally unsupported model:

1. Google's current Grounding with Exa documentation explicitly lists `gemini-3.5-flash` under **Supported models**: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-exa>.
2. The local cache contains 119 successful HTTP 200 native Exa-grounding calls using `gemini-3.5-flash` and the same local request shape.

Google also classifies Gemini 3.5 Flash itself as GA and lists Exa Web Search as a supported tool: <https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash>.

An unsupported model or unsupported tool combination would normally fail consistently. This failure is intermittent and returns a nested Exa request-validation error instead of a model-not-found or unsupported-tool error.

The stronger diagnosis is:

> `gemini-3.5-flash` and Exa grounding are supported, but the request path intermittently constructs or forwards an empty downstream Exa query.

## Local evidence

Snapshot of 233 cached searches after a failure and successful full-tool repeat on 2026-07-30:

| Model | HTTP 200 | Empty-query HTTP 400 | HTTP 429 |
|---|---:|---:|---:|
| `gemini-2.5-flash` | 81 | 0 | 1 |
| `gemini-3.5-flash` | 120 | 24 | 7 |

For Gemini 3.5 Flash, the empty-query failure occurred in 24 of 151 total attempts (15.9%), or 24 of 144 non-rate-limited attempts (16.7%). No equivalent failure appears in the cached Gemini 2.5 Flash attempts.

### Fresh reproduction

A new live search specifically asking about Gemini 3.5 and Exa support reproduced the same failure:

- Raw response: `web_search_cache/responses/wse_ms6khd7p_3db557605947278e.json`.
- The local prompt was non-empty.
- The primary returned HTTP 400 after 12.7 seconds.
- The nested Exa error again reported an empty `query`.
- Direct `exa_search` fallback succeeded with HTTP 200 in 1.8 seconds and returned 5 results.

The exact same query was subsequently run through the complete `web_search` tool again and succeeded without fallback:

- Raw response: `web_search_cache/responses/wse_ms6lh2ig_220add2d33b4b055.json`.
- Primary status: HTTP 200 after 27.1 seconds.
- Finish reason: `STOP`.
- Generated search queries: 8.
- Grounding sources: 14.
- Grounding supports: 14.

The same full tool path and query therefore produced HTTP 400 and then HTTP 200, confirming an active intermittent failure rather than a deterministic query, model, endpoint, or local routing error.

### Git history and controlled manual retest

The shorter publisher endpoint was not introduced by the Gemini 3.5 update:

- It was present in the original extension implementation from commit `fad367421df364de0ebb74d72a1ee4a70eec2cce` on 2026-06-28.
- Commit `a17afa6a2f8591ae3e72918c9ca5a7b1daf246a5` moved the client from `src/api.ts` to `src/gemini.ts` without changing the endpoint, authentication, or Exa request body.
- Commit `abd2c9cb70ccb54d83f3d471a948bfab905fd69c` changed only the default model from `gemini-2.5-flash` to `gemini-3.5-flash`.

Manual calls were then sent directly with `fetch`, bypassing Pi's tool routing, fallback logic, normalization, rendering, and cache storage:

| Variant | Result | Finish | Search queries | Sources |
|---|---:|---|---:|---:|
| Gemini 3.5, current endpoint and request shape | HTTP 200 | `STOP` | 4 | 5 |
| Gemini 3.5, current endpoint with default Exa config | HTTP 200 | `STOP` | 3 | 4 |
| Gemini 2.5, current endpoint and request shape | HTTP 200 | `STOP` | 5 | 8 |
| Gemini 3.5, exact query that had just failed through `web_search` | HTTP 200 | `STOP` | 6 | 9 |

The exact same non-empty query and current request shape therefore produced HTTP 400 once and HTTP 200 on a direct repeat. This confirms nondeterministic behavior in the managed grounding path. It also demonstrates that the shorter publisher endpoint remains operational and that neither the query nor static request body is intrinsically invalid.

The earlier representative raw record proves all three relevant facts:

- The local query is non-empty: `web_search_cache/responses/wse_ms6ic9xh_5bf5865530ba7a3b.json:7`.
- Google returned Exa's nested empty-query validation failure: `web_search_cache/responses/wse_ms6ic9xh_5bf5865530ba7a3b.json:45-63`.
- Direct Exa fallback succeeded with HTTP 200 and reported 10 results: `web_search_cache/responses/wse_ms6ic9xh_5bf5865530ba7a3b.json:150-202`.

The local request builder passes the query to Google at `agent/extensions/web-search/src/gemini.ts:29-52`. The tool also rejects empty local queries before making an HTTP request at `agent/extensions/web-search/src/tools.ts:37-41`.

## What the failure is not

### Not an empty Pi query

The input validation and stored raw request both show a non-empty query.

### Not general Gemini 3.5 model incompatibility

The same model and request path have 119 cached successes.

### Not an Exa API-key or quota failure

The provider returned `INVALID_REQUEST_BODY` for the `query` field, not an authentication or quota error. The direct Exa fallback then succeeded with the same Exa API key.

### Not the local request's Exa configuration casing

The request uses `api_key` and `customConfigs`, matching Google's current REST example. Static field casing does not explain the failure.

### The endpoint was not changed by the last update

The local implementation has used this endpoint and API-key authentication since the extension was introduced:

```text
POST https://aiplatform.googleapis.com/v1/publishers/google/models/MODEL_ID:generateContent
x-goog-api-key: <API key>
```

The last model update changed only `gemini-2.5-flash` to `gemini-3.5-flash`. Controlled manual calls—including an exact repeat of a query that had just failed—returned clean HTTP 200 responses through this endpoint.

Google's current Gemini Enterprise Agent Platform documentation now presents a project- and location-scoped OAuth form instead:

```text
POST https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/LOCATION/publishers/google/models/MODEL_ID:generateContent
Authorization: Bearer <OAuth access token>
```

The documentation difference is real, but the manual tests show that the shorter endpoint remains operational. It is not supported by the evidence as the cause of the intermittent empty query. Migrating to the currently documented path may still be desirable for long-term alignment, but it should not be presented as the root-cause fix.

### Not proven to be Gemini model generation alone

The evidence cannot distinguish between:

- Gemini generating an empty internal tool search query; and
- Google's native Exa adapter losing or incorrectly serializing a valid generated query.

That distinction requires provider-side traces from Google or Exa. The Exa request ID in the raw response can be supplied to provider support.

## Recommended remediation

### Immediate operational mitigation

The repeat test shows that one retry can recover the exact failure. For this specific nested empty-query validation error, either:

- retry Gemini native grounding once, then fall back directly to Exa; or
- skip the retry and immediately use direct Exa when lower latency is more important.

Using `gemini-2.5-flash` remains another mitigation because the local sample has zero empty-query failures with it, but Gemini 3.5 and Exa grounding are officially supported.

Direct Exa bypasses the managed query-generation/forwarding step.

### Strongest architectural fix

Make direct Exa retrieval the deterministic search step:

1. Send the original non-empty query directly to Exa `/search` or `/context`.
2. Optionally pass the returned excerpts and URLs to a normal Gemini generation call for synthesis.
3. Build citations from the known Exa result URLs.
4. Return the direct Exa results if synthesis fails.

This removes native Gemini-to-Exa grounding from the critical path.

### Interactions API migration

Google recommends the Interactions API for new work and classifies `generateContent` as legacy but supported: <https://ai.google.dev/gemini-api/docs/interactions-overview>.

Migrating should be evaluated because new models and tools launch there. It is not, by itself, a proven fix for this error: the Interactions API may still use the same native Exa backend.

### Retry policy

A retry can occasionally succeed because the failure is intermittent, but it should not be the primary remedy:

- The fresh failed primary call took about 12.7 seconds.
- Its direct Exa fallback succeeded in about 1.8 seconds.

A retry increases latency and cost. It is therefore limited to one retry for the exact nested empty-query validation error, followed by direct fallback.

## Why the previous diagnostic line was misleading

Before this change the renderer printed:

```text
Details: sources=0 supports=0 responseId=<id> fallback=code_search
```

`sourceCount` and `supportCount` were calculated only from the failed primary Gemini normalized response in `detailsForSearch()`, now at `agent/extensions/web-search/src/tools.ts:101-130`. They did not describe the fallback response.

When fallback succeeded, zero meant "the failed primary produced no Gemini grounding metadata," not "the successful search found no sources." The renderer lost that distinction in `resultDetailsSummary()`, now at `agent/extensions/web-search/src/render.ts:68-96`.

## Correct diagnostic semantics

Diagnostics describe the provider that supplied the returned answer. These are the
strings the renderer now emits.

### Clean primary success

```text
Details: provider=gemini-exa-grounding attempts=1 sources=5 supports=8 responseId=<id>
```

- `sources`: normalized Gemini grounding sources.
- `supports`: Gemini claim-to-source support spans.

### Clean primary success after one retry

```text
Details: provider=gemini-exa-grounding attempts=2 firstError=EXA_EMPTY_QUERY sources=14 supports=14 responseId=<id>
```

### Successful `exa_search` fallback

```text
Details: provider=exa_search attempts=2 results=5 primaryError=EXA_EMPTY_QUERY responseId=<id>
```

- `results`: direct Exa search results.
- `sources` and `supports`: omitted because Gemini grounding metadata does not exist.
- `firstError` is omitted when it would repeat `primaryError`.

### Fallback after a 2xx primary that was not a clean answer

```text
Details: provider=exa_search attempts=1 results=5 finishReason=MAX_TOKENS responseId=<id>
```

- No `primaryError` is shown, because `HTTP_200` would misdescribe the primary result.
- `finishReason` appears only when the primary reported a non-`STOP` reason.

### Successful `code_search` fallback for the representative response

```text
Details: provider=code_search attempts=1 results=10 primaryError=HTTP_400 responseId=wse_ms6ic9xh_5bf5865530ba7a3b
```

The correct values are:

| Field | Value | Reason |
|---|---|---|
| answer provider | `code_search` | The fallback supplied the returned answer. |
| fallback result count | `10` | Exa Context returned `resultsCount: 10`. |
| primary status | `HTTP 400` | Native Gemini-to-Exa grounding failed. |
| sources | not applicable | No normalized Gemini grounding-source array exists for fallback output. |
| supports | not applicable | No Gemini grounding-support spans exist for fallback output. |

Do **not** relabel `results=10` as `sources=10`. Search results and normalized citation sources are different concepts.

## Implemented behavior

Implemented on 2026-07-30 per `plans/web-search-empty-query-resilience-and-diagnostics.md`.

1. `agent/extensions/web-search/src/primary-failure.ts:38-50` classifies only the exact
   nested Exa empty-query HTTP 400 as `EXA_EMPTY_QUERY`. It reads
   `rawResponse.bodyJson.error.message` first and falls back to `bodyText`, normalizing
   Google's `>` escape and backslash-escaped quotes before matching the Exa
   bad-request phrase, the `>=1 characters` validation phrase, and a validation location
   that is exactly `query` — quoted or unquoted, never a prefix such as `queryType`.
2. `agent/extensions/web-search/src/gemini.ts:89-96` adds
   `callGeminiExaGroundingAttempts()`, which retries `callGeminiExaGrounding()` exactly
   once for that code only, skips the retry when the signal is already aborted, and never
   makes more than two Gemini calls. There is no backoff, because the failure is not rate
   limiting.
3. `agent/extensions/web-search/src/routing.ts:28-31` reports the empty-query failure as
   `Gemini native Exa grounding sent Exa an empty search query.` before generic HTTP
   status handling; all other reasons are unchanged, so fallback-route selection is
   untouched.
4. `agent/extensions/web-search/src/tools.ts:71-100` stores the new optional
   `primaryAttempts` field only when a retry actually produced a second attempt, so
   ordinary one-attempt records are unchanged on disk and `primary` remains the single
   record of that attempt. `primary` and the top-level `request`, `response`,
   `normalized`, and `googleResponseId` always describe the final attempt.
   `primaryAttemptsForRecord()` at `agent/extensions/web-search/src/tools.ts:102-104`
   treats a missing `primaryAttempts` as `[primary]`, so no cache migration is needed.
   Deep redaction in `writeStoredResponse()` covers every attempt because it walks the
   whole record.
5. `agent/extensions/web-search/src/tools.ts:106-135` exports `detailsForSearch()` and
   adds `answerProvider`, `primaryAttemptCount`, `primaryFirstFailureCode`,
   `primaryFinalFailureCode`, `primaryFinalStatus`, and `fallbackResultCount`.
   `sourceCount`, `supportCount`, and `queryCount` are now `null` — never `0` — when the
   fallback supplied the answer.
6. `agent/extensions/web-search/src/exa-search.ts:139` copies the Exa Context response's
   numeric `resultsCount` into `FallbackAttempt.resultCount`.
7. `agent/extensions/web-search/src/render.ts:68-105` renders provider-specific fields:
   `sources`/`supports` only for Gemini answers, `results`/`primaryError`/`finishReason`
   only for fallback answers, `firstError` only when a later attempt exists and the label
   differs from `primaryError`, and no fabricated zeros. An `HTTP_<status>` label is
   derived only from a non-2xx status, so a 2xx primary that still needed fallback is
   described by its non-`STOP` finish reason instead of a misleading `HTTP_200`.

The `/v1/publishers/google/models/{model}:generateContent` endpoint, the default
`gemini-3.5-flash` model, and fallback-route selection were not changed.

### Validation

`bun test` from `agent/extensions/web-search/`: **59 pass, 0 fail, 183 expect() calls**
across 11 files. `git diff --check` from the repository root reports no whitespace
errors. Unit tests make no live Google or Exa calls; `globalThis.fetch` is mocked with
ordered `Response` objects.

New and extended coverage:

- `tests/primary-failure.test.ts` — classifies the nested error from `bodyJson` and from
  `bodyText`, tolerates whitespace/escaped-quote variants, accepts an unquoted `query`
  location, and rejects an unrelated 400, a 429 mentioning `query`, an Exa authorization
  error, and prefix fields (`queryType`, `queryParams`, `query_rewrites`).
- `tests/gemini-retry.test.ts` — one fetch on success, two on empty-query recovery, never
  three, no retry for unrelated 400/429 or an aborted signal, and an identical retry URL
  and body.
- `tests/exa-search.test.ts` — `resultsCount` parsing and unchanged answer selection.
- `tests/tools-details.test.ts` — record construction (one-attempt records omit
  `primaryAttempts`; retry records keep both attempts and final-attempt fields) and the
  details contract, including records without attempt history and a retry that fails with
  a different class.
- `tests/render.test.ts` — the exact detail strings above, the 2xx fallback case asserting
  `HTTP_200` is absent, expanded/collapsed parity, and terminal sanitization.
- `tests/storage.test.ts` — a single-attempt record whose serialized file contains no
  `primaryAttempts` key, plus a two-attempt round trip with API keys redacted in every
  attempt.

Because pi-tui is supplied by the Pi host and is not installed for this extension,
`tests/pi-tui-mock.ts` registers a minimal `Text` stub via `mock.module` so the renderer
and tool modules can be imported under `bun test`.

### Live retry validation

The updated on-disk `executeWebSearchExa()` was run directly in a bounded loop of five
live calls. Runs 1–4 completed with one clean Gemini attempt. Run 5 reproduced the
provider defect and recovered through the new retry:

```text
responseId=wse_ms6nysus_4089add3b05bccb2
attempt 1: HTTP 400, EXA_EMPTY_QUERY
attempt 2: HTTP 200, finishReason=STOP
answerProvider=gemini-exa-grounding
fallback=null
sources=15
supports=14
```

The stored record contains both attempts chronologically, keeps `primary` on the final
successful attempt, and redacts both Google and Exa keys in attempt 1. The real Pi TUI
renderer produced:

```text
Details: provider=gemini-exa-grounding attempts=2 firstError=EXA_EMPTY_QUERY sources=15 supports=14 responseId=wse_ms6nysus_4089add3b05bccb2
```

This validates the complete retry-recovery, storage, redaction, details, and real-renderer
path against the live intermittent provider failure.

## Root-cause confidence

| Conclusion | Confidence |
|---|---|
| Pi supplied a non-empty query | Confirmed |
| Exa received an empty downstream query | Confirmed |
| Gemini 3.5 Flash is generally supported | Confirmed |
| Gemini 3.5 Flash explicitly supports Exa grounding | Confirmed |
| Last model update changed the endpoint or request shape | Disproven |
| Current shorter endpoint remains operational | Confirmed by manual tests |
| Current docs show a different project-scoped request form | Confirmed |
| Endpoint difference causes the empty query | Unsupported by current evidence |
| Failure is nondeterministic inside the managed Gemini-to-Exa path | High |
| Gemini itself generated the empty query | Unproven |
| Google's adapter dropped the query | Unproven |
