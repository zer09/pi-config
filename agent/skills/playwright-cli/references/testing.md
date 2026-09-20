# Playwright test generation, repair, and debugging

Inspect the project's Playwright configuration, fixtures, hooks, and target URLs before running tests. Tests can mutate hosted services; use authorized local/test targets and preserve the exact hosted-service mutation gate.

## Use the project's runner

Prefer the existing package-manager test script and fixtures. Do not bootstrap a project or upgrade dependencies just to enable this workflow. With an existing npm-based Playwright installation:

```bash
npx --no-install playwright --version
PLAYWRIGHT_HTML_OPEN=never npx --no-install playwright test tests/example.spec.ts
```

Use the real target file, test title filter, or `file:line` to narrow the run. `PLAYWRIGHT_HTML_OPEN=never` prevents an automatic interactive HTML report.

## Debug through a test-owned session

The bundled upstream workflow uses `--debug=cli`. Confirm that the project's installed Playwright supports it; the global CLI version does not establish the project's runner version. If unsupported, use the project's existing debugger or report the version limit. Do not silently upgrade.

Start this command as a managed background job and retain its process/job handle:

```bash
PLAYWRIGHT_HTML_OPEN=never npx --no-install playwright test tests/example.spec.ts --debug=cli
```

Wait for `Debugging Instructions` and the printed session name. Attach only to that test-owned session, using the actual name in place of `tw-XXXX`:

```bash
playwright-cli attach tw-XXXX --session=task-test
playwright-cli -s=task-test snapshot
```

The test pauses at the start. Resume or step according to the printed debugging instructions until the relevant setup and target state are reached. Keep the test process alive while inspecting it. This attachment is not user-profile access and does not authorize CDP or extension attachment to the user's browser.

For test generation that depends on fixtures or login setup, explore through the existing seed/test session instead of opening the URL in an unrelated session. Preserve hooks and fixtures. Do not share one paused session between independent scenarios.

## Generate useful tests

CLI actions emit equivalent Playwright TypeScript unless output is suppressed. Collect the relevant actions and reuse the project's test layout and fixtures. Snapshot refs such as `e5` are not test locators.

```bash
playwright-cli -s=task-test generate-locator e5 --raw
playwright-cli -s=task-test eval "el => el.textContent" e5
```

Add assertions for the requested observable outcomes; generated actions alone do not verify success. Avoid circular text assertions where the locator already matches the expected text. Use a stable test ID or label for `toHaveText`, or assert visibility for a text-based locator.

Write a separate plan only when requested or useful to resolve an unclear scenario. Do not impose upstream's one-test-per-file rule or mandatory spec template on an existing project.

## Repair without weakening coverage

Distinguish locator/timing drift from an application regression. Rehearse the corrected interaction, apply the smallest authorized fix, and rerun the affected test. Preserve intended behavior and assertions; do not silently change requirements to match a broken app, skip hooks, disable tests, add sleeps, or wait for `networkidle` to make a failure disappear.

If intended behavior is unclear, report the expected and observed outcomes and ask before changing the expectation. Application fixes outside the requested scope remain separate work.

Detach and stop only the background test process owned by this task before the verification run:

```bash
playwright-cli -s=task-test detach
PLAYWRIGHT_HTML_OPEN=never npx --no-install playwright test tests/example.spec.ts
```

Stop the retained job between these commands; detaching alone leaves the test process running. Verify the test result after the fix and report failures or checks that could not run. Close any additional isolated sessions opened for the task unless the user requested otherwise.
