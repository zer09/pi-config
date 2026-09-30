# openSUSE Tumbleweed browser compatibility

Load this reference when selecting an engine on the local host or diagnosing a browser launch failure.

## Known local state

The earlier installation assessment for `@playwright/cli@0.1.21` reported:

- Chromium and Firefox resolved their shared-library dependencies on this openSUSE Tumbleweed host.
- WebKit used an Ubuntu fallback build that required unavailable older sonames, including ICU 74 libraries such as `libicuuc.so.74` and `libicui18n.so.74`.
- The assessed host had ICU 78. A newer major version does not satisfy the older ABI.

These are historical shared-library findings, not proof that every browser feature works. The CLI 0.1.22 update changes its Playwright dependency to `1.64.0-alpha-1790635538000`; browser availability and library compatibility were not rechecked. No browser binaries were downloaded or launched. Recheck for the selected build during separately authorized browser work instead of treating the earlier findings as current verification.

## Choose a compatible runtime

Default to isolated Chromium using the configuration in the sessions reference. `open --browser=firefox` is an alternative when Firefox coverage is requested. The CLI's `--browser` help lists Chrome channels, Firefox, and WebKit; the Chromium configuration avoids assuming that `--browser=chromium` is a documented flag value.

If WebKit is specifically required, recommend a supported Ubuntu container with Playwright and browser builds matched to the project or CLI runtime. Verify image/version availability first, especially for a prerelease Playwright dependency. Container setup, image downloads, and package installation require authorization; this skill does not perform them automatically.

Do not run Ubuntu `apt` commands on openSUSE. Do not symlink ICU 78 or other incompatible libraries to older sonames. Those names identify ABI requirements, not filenames that can safely be substituted.

## Diagnose without changing the host

Check the installed CLI version, selected configuration, browser executable path, and the specific missing library names. Read package/browser metadata without exposing environment secrets or profile contents. If further diagnosis is authorized, use `ldd` only on the trusted installed browser binaries; library resolution alone is not a launch test.

Do not download more engines, install dependencies, change system libraries, disable browser security, or access the user's profile as a workaround. Report the compatibility limit and the Chromium or supported-container option.
