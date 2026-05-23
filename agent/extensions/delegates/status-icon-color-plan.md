# Delegate status icon and color plan

## Goal

Add Nerd Font icons and status-specific colors to delegate final statuses and writer file statuses, using the color mapping we agreed on:

| Category | Status | Icon | Intended color | Renderer color source |
|---|---|---:|---|---|
| Final delegate | Completed | `󰸞` | green | `success` |
| Final delegate | Timeout | `󰔟` | amber | `warning` |
| Final delegate | Aborted | `󰅖` | orange | custom ANSI orange, fallback `warning` |
| Final delegate | Failed | `󰅙` | red | `error` |
| Writer file | Created | `󰝒` | green | `success` |
| Writer file | Modified | `󰷈` | blue | custom ANSI blue, fallback `accent` |
| Writer file | Deleted | `󰩹` | red | `error` |
| Writer file | Skipped | `󰒭` | gray | `muted` |

## Constraints

- Keep the animated progress spinner behavior unchanged.
- Keep progress phase text colored as it is now.
- Do not change model-visible delegate `content`; this is UI rendering only.
- Do not expose raw child stdout, stderr, tool args, or secrets.
- Preserve existing final status normalization: only `completed`, `timeout`, `aborted`, and `failed` are final delegate statuses.
- Preserve existing writer file status values: `created`, `modified`, `deleted`, and `skipped`.
- Use Pi theme colors where a suitable slot exists.
- Use custom ANSI only for colors Pi's theme does not currently expose clearly enough: orange and blue.
- Keep fallbacks safe if theme coloring or ANSI support is unavailable.

## Implementation plan

1. Update `agent/extensions/delegates/renderers.ts`.

2. Add small rendering helpers near the existing `color()` helper:
   - `ansi256(colorCode, value)`: wraps text in 256-color ANSI escapes.
   - `colorOrAnsi(theme, themeColor, ansiCode, value)`: prefers theme color when requested, or ANSI when a custom color is needed.
   - `renderFinalStatus(status, theme)`: returns colored `icon Status` text for final delegate status.
   - `renderWriterFileStatus(status, theme)`: returns colored `icon Status` text for writer file rows.

3. Final delegate status rendering:
   - Replace the current final result status text built from `statusLabel(details.status)` with `renderFinalStatus(details.status, theme)`.
   - Keep the existing summary text after the final status for writer results, for example:
     - `Implementer 󰸞 Completed 1 changed`
     - `Implementer 󰅙 Failed`
   - For non-writer delegates, render:
     - `Investigator 󰸞 Completed`
     - `Investigator 󰔟 Timeout`
     - `Investigator 󰅖 Aborted`
     - `Investigator 󰅙 Failed`

4. Writer file status rendering:
   - In expanded writer details, replace `displayLabel(file.status)` with `renderWriterFileStatus(file.status, theme)`.
   - Keep file paths and skip reasons as they are, for example:
     - `  󰝒 Created src/new.ts`
     - `  󰷈 Modified src/app.ts`
     - `  󰩹 Deleted src/old.ts`
     - `  󰒭 Skipped src/large.bin (file exceeds max diff size)`

5. Tests in `agent/extensions/delegates/delegates.test.ts`:
   - Update final delegate renderer assertions to expect the chosen icons next to final statuses.
   - Add or update writer expanded details assertions for created, modified, deleted, and skipped file icons.
   - Keep assertions that raw child summaries and secrets do not appear in renderer output.
   - Avoid hardcoding ANSI escape sequences in tests unless necessary. Prefer checking icons and labels so theme implementation can vary.

6. Documentation in `agent/extensions/delegates/README.md`:
   - Add a short table under Progress UI or Result shape documenting final status icons and writer file icons.
   - Note that colors are theme/terminal dependent and custom blue/orange are best-effort ANSI colors.

7. Validation:
   - Run `bun agent/extensions/delegates/delegates.test.ts`.
   - Run the delegates bundle syntax check:
     - `bun build agent/extensions/delegates/index.ts --target=node --external @earendil-works/pi-coding-agent --external @earendil-works/pi-ai --external @earendil-works/pi-tui --external typebox --outfile=/tmp/delegates-check.js`
     - `node --check /tmp/delegates-check.js`
   - Reload Pi.
   - Spawn a reader delegate to verify final status color/icon.
   - Spawn or simulate a writer delegate with file changes to verify writer file icons/colors in expanded output.

## Acceptance criteria

- Final delegate rows show the selected Nerd Font icon next to the final status.
- Expanded writer file rows show the selected Nerd Font icon next to each file status.
- Completed and Created are green.
- Timeout is amber/yellow.
- Aborted is orange or falls back to warning if orange does not render distinctly.
- Failed and Deleted are red.
- Modified is blue or falls back to accent if blue does not render distinctly.
- Skipped is muted gray.
- Existing delegate tests pass.
- No model-visible delegate output changes except existing progress/status wording already committed.
