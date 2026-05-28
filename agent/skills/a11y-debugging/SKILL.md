---
name: a11y-debugging
description: Uses Chrome DevTools MCP for accessibility (a11y) debugging and auditing based on web.dev guidelines. Use when testing semantic HTML, ARIA labels, focus states, keyboard navigation, tap targets, and color contrast.
---

# Accessibility debugging with Chrome DevTools MCP

Use Chrome DevTools MCP to inspect what assistive technologies see, validate keyboard behavior, and audit common accessibility failures.

## Safety and routing

- Treat browser actions on hosted apps as read-only unless the user explicitly authorizes the exact mutation. Do not submit forms, change settings, purchase, delete, or post through the browser by accident.
- Prefer `take_snapshot` for semantic structure and `take_screenshot` only when visual layout matters.
- Save large Lighthouse reports or snapshots with `filePath`/`outputDirPath`, then parse them with code. Do not read full report files into context.
- For public web.dev guidance, fetch the markdown form (`.md.txt`) through the normal web/docs route when exact current guidance is needed.

## Workflow

1. Establish a baseline with `lighthouse_audit` in `navigation` mode. Review the score, failed audit count, and failing selectors/snippets from the saved JSON.
2. Check native browser issues with `list_console_messages` using `types: ["issue"]` and `includePreservedMessages: true`.
3. Capture `take_snapshot` and inspect landmarks, heading order, DOM reading order, interactive names, image alt text, and form labels.
4. Test keyboard flow with `press_key` (`Tab`, `Shift+Tab`, `Enter`, `Escape`) and re-run `take_snapshot` after each important step to confirm focus movement and modal focus trapping.
5. Use targeted `evaluate_script` snippets from `references/a11y-snippets.md` for orphaned inputs, tap target sizes, color contrast, and document-level checks.
6. Compare semantic results with a screenshot when CSS ordering, hidden content, gradients, or visual-only affordances may hide the real issue.
7. Re-run the smallest relevant audit or snapshot after fixes to verify the specific failure is gone.

## Reference snippets

Read `references/a11y-snippets.md` only when you need reusable scripts for:

- orphaned form inputs
- tap target size and spacing
- color contrast
- global page checks

## Maintenance

For future updates to this source, read `../../../docs/skills/chrome-devtools-skills-update-process.md`.
