# Notion workflow recipes

Apply only the section matching the request. Search before creating, preserve source links, and use the workspace's existing structure and terminology.

## Knowledge capture

1. Extract decisions, rationale, procedures, definitions, insights, examples, and actions from the supplied context.
2. Classify the result, search for an existing home, and update it when that is clearer than creating a duplicate.
3. Use the lightest useful structure:
   - Decision: Context → Decision → Rationale → Alternatives → Consequences → Actions
   - How-to: Overview → Prerequisites → Steps → Verification → Troubleshooting
   - Learning: Event → What worked/didn't → Causes → Lessons → Actions
   - FAQ: Short answer → Detail → Example → Related links
4. Place it in the relevant project/wiki/database, set known metadata, and link it from a hub or related page when requested. Avoid orphan pages and invented metadata.

## Workspace research

1. Search broadly, refine terms, then fetch only relevant pages.
2. Track each source URL, recency, key evidence, conflicts, and gaps.
3. Distinguish sourced Notion facts from inference or external research; never fabricate missing facts.
4. Produce the requested depth: quick brief, research summary, or full report. Include an executive summary, findings, source links/citations, gaps, and actionable next steps as appropriate.
5. Save to Notion only if requested, under the supplied parent/database or a resolved destination.

## Meeting intelligence

1. Gather topic, purpose, date, attendees, audience, desired decisions, and related project.
2. Search project pages, previous notes, tasks, specs, recent updates, and metrics; fetch only high-value sources.
3. For important meetings, prepare:
   - Internal pre-read: background, status, evidence, risks, open questions, desired outcomes.
   - Shared agenda: objective, timed topics, decisions needed, actions placeholder, related links.
4. Keep confidential/internal context out of external agendas. Label general analysis separately from workspace facts.
5. Cross-link materials and project pages when requested. Afterward, capture decisions, owners, due dates, and next steps.

## Specs and implementation tasks

1. Resolve and fetch the spec plus linked requirements. Extract functional/non-functional requirements, constraints, acceptance criteria, dependencies, ambiguities, and risks.
2. Build a phased plan with technical approach, testable success criteria, and tasks small enough to complete independently (typically 1–2 days).
3. Resolve the task database and inspect its schema before creating rows. Map only existing properties/options; link spec, plan, tasks, and deliverables bidirectionally when requested.
4. For spec changes, compare source and plan, record impact, update affected tasks, and preserve a concise change note.

## Task-board agent mode

Use this only when the user asks to plan/build through a Notion board.

- Expected concepts: Status plus optional `Agent status` text and `Agent blocked` checkbox. Map to the board's actual schema; do not create or rename fields/options unless requested.
- Planning: mark Planning → write a brief activity status → append a `Plan` section → mark Ready after ambiguities are resolved.
- Building: mark In Progress → update activity status only at meaningful milestones → implement and verify → mark Done only after success.
- If blocked, add one concise comment/question, mark blocked, and wait for user input. Poll only when the user says Notion is the sole communication channel; keep polling output out of context.
- On completion, summarize changes and verification in the task. Link code, PRs, or supporting docs when available.

## Code-change explanation

When asked to document a diff, inspect the actual surrounding code and verification evidence, then create a linked page with:

1. Background (beginner context, then change-specific context)
2. Intuition (concrete example; Mermaid diagram only if it clarifies flow)
3. Code walkthrough grouped by behavior
4. Verification and manual QA steps
5. One or two genuinely orthogonal alternatives with pros/cons, if any
6. Five medium-difficulty multiple-choice questions with answer explanations, only when a teaching document or quiz is requested

Prefer clear, compact prose over decorative depth. Never claim tests that were not run.

## Result presentation

Return concise, human-readable results rather than raw JSON. Include titles, types, key properties, parent/location, source links, and any inferred or skipped fields. For empty queries, say so and suggest one useful refinement.
