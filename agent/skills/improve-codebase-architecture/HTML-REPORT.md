# HTML Report Format

Use this when an architecture review needs visual comparison. Render a single self-contained HTML file in the OS temp directory, not in the repository. Tailwind and Mermaid may come from CDNs. Mermaid handles graph-shaped diagrams; hand-built divs and inline SVG handle editorial visuals such as mass diagrams and cross-sections. Mix the two.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review — {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Repo name, date, and a compact legend: solid box = module, dashed line = seam, red arrow = leakage, thick dark box = deep module. No introduction paragraph; go straight to candidates.

## Candidate card

The diagrams carry the weight. Prose is sparse, plain, and uses the architecture vocabulary from [LANGUAGE.md](LANGUAGE.md).

Each candidate is one `<article>`:

- **Title** — short, names the deepening, e.g. "Collapse the Order intake pipeline".
- **Badge row** — recommendation strength (`Strong`, `Worth exploring`, `Speculative`) plus a dependency category tag (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
- **Files** — monospaced list, `font-mono text-sm`.
- **Before / after diagram** — two columns, side by side.
- **Problem** — one sentence: what hurts.
- **Solution** — one sentence: what changes.
- **Wins** — bullets, ≤6 words each, e.g. "Tests hit one interface", "Pricing logic stops leaking", "Delete 4 shallow wrappers".
- **ADR callout** — if applicable, one line in an amber-tinted box.

No paragraphs of explanation. If a diagram needs a paragraph to be understood, redraw the diagram.

## Diagram patterns

### Mermaid graph

Use a Mermaid `flowchart` or `graph` when the point is dependency or call-flow shape.

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### Hand-built boxes-and-arrows

Use modules as `<div>`s with borders and labels. Use inline SVG arrows over a relative container. Reach for this when the after diagram should feel like one thick-bordered deep module with greyed-out internals.

### Cross-section

Use stacked horizontal bands to show layered shallowness. Before: many thin pass-through layers. After: one thick band labelled with the consolidated responsibility.

### Mass diagram

Use two rectangles per module: interface surface area and implementation. Before: interface nearly as tall as implementation. After: short interface, tall implementation.

### Call-graph collapse

Before: a tree of function calls rendered as nested boxes. After: the same tree collapsed into one box, with internal calls faded inside it.

## Style guidance

- Lean editorial, not corporate-dashboard. Generous whitespace.
- Colour sparingly: one accent plus red for leakage and amber for warnings.
- Keep diagrams around 320px tall so before/after sits side by side without scrolling.
- Use `text-xs uppercase tracking-wider` for schematic module labels.
- Keep scripts limited to Tailwind CDN and Mermaid ESM import. Otherwise static HTML.

## Top recommendation

One larger card with the candidate name, one sentence on why, and an anchor link to its card.

## Tone

Use exactly: module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

Avoid substituting: component, service, unit for module; API/signature for interface; boundary for seam.

Fit the style:

- "Order intake module is shallow — interface nearly matches the implementation."
- "Pricing leaks across the seam."
- "Deepen: one interface, one place to test."
- "Two adapters justify the seam: HTTP in prod, in-memory in tests."

Wins bullets should name the gain in glossary terms: "locality: bugs concentrate", "leverage: one interface, N call sites", "interface shrinks; implementation absorbs wrappers".
