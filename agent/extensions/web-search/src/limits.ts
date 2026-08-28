/**
 * Shared public and runtime resource limits for the web-search extension.
 *
 * This module is deliberately dependency-neutral: schemas, config, and the
 * fetch orchestration import the same constants so the public tool contract,
 * runtime validation, and defensive caps can never drift apart.
 */

/** Maximum explicit URLs one fetch_contents call may request. */
export const MAX_FETCH_CONTENT_URLS = 25;
/** Maximum per-URL Markdown characters fetch_contents accepts or requests. */
export const MAX_CONTENT_CHARACTERS = 50_000;
/** Hard ceiling for configured fetch_contents concurrency. */
export const MAX_CONTENT_CONCURRENCY = 10;
/** Maximum Tavily results normalized, retained in diagnostics, or configured. */
export const MAX_TAVILY_RESULTS = 20;
/** Maximum Tavily result URL length; longer URLs drop the whole result instead of truncating. */
export const MAX_TAVILY_RESULT_URL_CHARS = 2_000;
