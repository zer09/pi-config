---
name: debug-optimize-lcp
description: Guides debugging and optimizing Largest Contentful Paint (LCP) using Chrome DevTools MCP tools. Use this skill whenever the user asks about LCP performance, slow page loads, Core Web Vitals optimization, or wants to understand why their page's main content takes too long to appear. Also use when the user mentions "largest contentful paint", "page load speed", "CWV", or wants to improve how fast their hero image or main content renders.
---

# Debug and optimize LCP

Use Chrome DevTools MCP to find the Largest Contentful Paint element, split LCP into subparts, identify the bottleneck, and verify the fix.

## Targets

- Good LCP: <= 2.5 seconds.
- Needs improvement: 2.5 to 4.0 seconds.
- Poor: > 4.0 seconds.

LCP has four ordered subparts: TTFB, resource load delay, resource load duration, and element render delay. The delay subparts should be near zero; optimize the largest bottleneck first.

## Workflow

1. Navigate to the target page and record a reload trace with `performance_start_trace` using `reload: true` and `autoStop: true`.
2. Run `performance_analyze_insight` on the relevant insight set. Start with `LCPBreakdown`, then check `DocumentLatency`, `RenderBlocking`, and `LCPDiscovery` as needed.
3. Identify the actual LCP element with the snippet in `references/lcp-snippets.md`. Note the tag, resource URL, and timing data.
4. Inspect the network waterfall with `list_network_requests` and `get_network_request`, focusing on the LCP resource, HTML document, images, fonts, and render-blocking assets.
5. Audit common HTML issues with `references/lcp-snippets.md`: lazy-loaded viewport images, missing `fetchpriority`, late discovery through CSS or JS, and blocking scripts/styles.
6. Recommend the smallest fix that targets the bottleneck, then rerun the trace to verify the subpart improved.

## Optimization map

- High TTFB: reduce redirects, cache HTML at the edge, improve server response, and check bfcache eligibility.
- Resource load delay: expose the LCP resource in initial HTML, remove lazy loading from the LCP image, add preload or `fetchpriority="high"` when appropriate.
- Resource load duration: shrink or transcode the resource, use responsive images, serve from a CDN, and improve caching.
- Element render delay: inline critical CSS, defer non-critical scripts/styles, reduce long tasks, and ensure server-rendered or initial HTML content exists early.

## References

- `references/lcp-snippets.md` - reusable scripts for LCP element detection and common issue audits.
- `references/lcp-breakdown.md` - subpart interpretation.
- `references/optimization-strategies.md` - fix selection.
- `references/elements-and-size.md` - LCP element type and size notes.

## Maintenance

For future updates to this source, read `../../../docs/skills/chrome-devtools-skills-update-process.md`.
