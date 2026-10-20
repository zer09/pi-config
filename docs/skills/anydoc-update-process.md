# AnyDoc skill update process

## Source and classification

- Upstream: [firecrawl/anydoc](https://github.com/firecrawl/anydoc).
- Pinned commit: `261fc257d17c3eab0f673be31c408fd9fdc2171a`.
- Skill source: [`skills/convert-documents-to-markdown/SKILL.md`](https://github.com/firecrawl/anydoc/blob/261fc257d17c3eab0f673be31c408fd9fdc2171a/skills/convert-documents-to-markdown/SKILL.md), the only file in that upstream skill folder.
- CLI sources: `node/cli.js`, `node/anydoc.js`, and `node/package.json` at the same commit. The package is `@firecrawl/anydoc` version `0.2.4`, with Node >=20.
- Local tree: [SKILL.md](../../agent/skills/convert-documents-to-markdown/SKILL.md), [agents/openai.yaml](../../agent/skills/convert-documents-to-markdown/agents/openai.yaml), [scripts/convert_document.py](../../agent/skills/convert-documents-to-markdown/scripts/convert_document.py), and [scripts/test_convert_document.py](../../agent/skills/convert-documents-to-markdown/scripts/test_convert_document.py).
- The stdlib wrapper and offline unittest suite are locally authored, not imported from upstream. Local maintainers own their safety contract and tests. The wrapper pins the tested CLI version `0.2.4`; review the CLI source and regressions before changing that pin.
- Classification: **keep it**. The compact skill routes conversion through a reusable wrapper with deterministic retry, endpoint, credential, replay, and output checks. Those details are useful beyond generic Markdown editing.

The skill is adapted from upstream MIT-licensed content. Keep the upstream name. The copyright and full license notice appear below because local frontmatter contains only `name` and `description`. Keep this notice with copies of the adapted skill, including when distributing the runtime separately.

## Local overlays

Preserve these differences during every sync:

- Precise file-conversion and unreadable-document inspection triggers; exclude existing Markdown editing and web scraping.
- Two-key frontmatter and quoted UI metadata. Keep `short_description` within 25-64 characters and `$convert-documents-to-markdown` in `default_prompt`.
- A compact runtime root and the necessary conversion helper/tests. Do not add extra resources or evaluation scaffolds without a real requirement.
- Bounded native shell commands for large stdout/diagnostics, explicit project `cwd`, and native `read` for targeted converted output. Do not restore CodeGraph/Context Mode mandates.
- Read-only inspection prefers stdout. Persistent output and overwriting need authorization. Temporary artifacts follow host policy and stay task-scoped outside the repository; preserve originals.
- Route normal conversion through the wrapper. It starts with explicit `--ocr reject`, removing the key and endpoint from the local child environment. Only exit 3 / `NeedsOcr` permits one hosted invocation, preserving input, format, and authorized output. Stdin bytes are buffered for exact replay; terminal stdin stops with exit 2.
- The user's standing authorization covers one necessary official Firecrawl OCR retry for requested conversion/inspection, not other services or work. Explicit local-only/no-upload/no-hosted-OCR/no-network requests and host sensitive-data/redaction rules still prohibit uploads.
- Require a nonempty environment `FIRECRAWL_API_KEY`; check availability without revealing it. Missing keys stop. No automatic keyless mode or embedded `--api-key`; never print, log, or save secrets.
- The wrapper has no endpoint argument. Check set `FIRECRAWL_API_URL` or the default before retry. Only exact `https://api.firecrawl.dev` with an optional trailing slash is covered. Custom/malformed URLs, including empty configured values, stop for separate named-document/destination/credential approval and manual handling outside the wrapper. Reconfirm for changed documents/destinations and do not silently replace them. Pin the automatic retry with `--api-url https://api.firecrawl.dev`.
- Disclose the whole-PDF upload, including already-text pages, service privacy terms, possible costs, and rate limits before retry. Do not repeat approval for ordinary non-sensitive documents within standing authorization. Report hosted OCR use; stop after any retry failure. Generic conversion, usage, auth, credits, rate-limit, and network errors never trigger fallback.
- Retain the Node/Python/Rust library pointer without treating it as permission for project installs or source changes.
- Keep the short Maintenance pointer, this guide, README entry, and alphabetical inventory row.

Do not copy upstream's unconditional `--ocr hosted` retry or large-document output-file advice. Preserve the narrower wrapper rules, including opt-outs and destination checks. The agent must select `--no-ocr` for explicit opt-outs or known sensitive/prohibited uploads; code cannot infer privacy from document bytes. Use `uv run --no-project python` for standalone wrapper execution so uv does not discover or sync the caller's Python project. For no-network requests, also use uv `--offline` and set `npm_config_offline=true` to block interpreter/package retrieval. Missing offline resources must stop; never retry online. Do not promise current signup requirements, prices, or quotas from this snapshot.

## Wrapper interface and limits

Resolve `<skill-dir>` to the installed skill directory:

```bash
uv run --no-project python <skill-dir>/scripts/convert_document.py <input> [-f <format>] [-o <output>] [--no-ocr] [--overwrite]
npm_config_offline=true uv run --no-project --offline python <skill-dir>/scripts/convert_document.py <input> --no-ocr
```

- Requires uv/Python >=3.9, Node >=20, and npx. Uses stdlib only; no Python packages, SDK, project dependency changes, or executable-bit setup are needed. `--no-project` prevents caller-project discovery/sync and lock/venv changes. Outside no-network mode, uv may retrieve a missing interpreter and npx may retrieve the pinned CLI into its cache.
- One path or `-` stdin; `-f`/`--format`, `-o`/`--output`, `--no-ocr`, and `--overwrite` are the complete interface. Repeated format/output options use the last value. There is no API-key argument, endpoint-approval flag, arbitrary passthrough, or custom-destination implementation.
- Argv lists and absolute path inputs protect spaces and option-like filenames. Use `./-name.pdf` or `-- -name.pdf` at the wrapper boundary.
- Stdin bytes and successful Markdown are held in memory. Both attempts receive identical stdin bytes and format. The wrapper owns output handling rather than passing `-o` to AnyDoc, so both attempts share the same authorized destination and failed conversions cannot overwrite it. No persistent temporary input/output files are created. Piped stdin waits for EOF before the subprocess timer starts; memory use scales with input/output size.
- Output validation runs before conversion and again before writing. Reject the source path and filesystem aliases even with `--overwrite`, including regular-file redirected stdin identified by its descriptor. A pipe does not reveal the producer's source path; the caller must not authorize output to that source file. Reject dangling/live symlinks and symlink parent directories. Existing regular outputs require `--overwrite`; multiply linked outputs remain unsupported. Exclusive creation protects fresh outputs, and descriptor/source checks precede truncation. Use trusted, stable directories and inputs: this is not an adversarial concurrent-filesystem sandbox. An I/O failure after truncation can leave partial authorized output; writes are not atomic.
- Bound each local attempt to 120 seconds and each hosted attempt to 360 seconds, including launcher time. The hosted bound accommodates the native 300-second service timeout. Timeout/interrupt cleanup kills the attempt's process group on POSIX and waits at most five more seconds; other platforms kill only the immediate child. POSIX sandbox tests cover process launch, timeout, and downstream pipe handling; other platforms are not independently verified.
- Return native `0`/`1`/`2`/`3` results, with expected launch/I/O/timeout failures mapped to `1`. `--overwrite` without output and terminal stdin return `2`. Missing/empty key, blocked endpoint, or `--no-ocr` after local `3` returns `3`. Never retry local `1`/`2` or failed hosted calls. Early downstream pipe closure is not a conversion failure.
- Diagnostics stay on stderr; only successful requested Markdown reaches stdout or the authorized file. Recognize credential-bearing HTTP(S) URLs case-insensitively before exact environment masking. Redact the exact case-sensitive environment key and configured endpoint in one longest-first escaped match pass, without rescanning that pass's replacement markers. Mask exact bytes with `os.fsencode` before lossy UTF-8 decoding. Never log environment values or put the key in argv. Print the whole-PDF/privacy/possible-cost/rate-limit notice before retry and a hosted-use result afterward.

## Manual sync

1. Start with the [maintenance README](README.md), [local invariants](local-skill-update-invariants.md), [slimming process](skill-slimming-process.md), and [ADR 0020](../adr/0020-gpt-6-astra-skill-maintenance-policy.md).
2. Load `skill-creator` and `gh-cli`. Inspect local changes before editing. Preserve user changes and the deferred Outpour/Impeccable exclusions.
3. Use authenticated `gh` with native `bash` and bounded output from the repository root. Fetch the pinned source for comparison with these read-only commands:

   ```bash
   gh api 'repos/firecrawl/anydoc/contents/skills/convert-documents-to-markdown?ref=261fc257d17c3eab0f673be31c408fd9fdc2171a' --jq 'map(.path)'
   gh api 'repos/firecrawl/anydoc/contents/skills/convert-documents-to-markdown/SKILL.md?ref=261fc257d17c3eab0f673be31c408fd9fdc2171a' --jq .content | base64 --decode
   gh api 'repos/firecrawl/anydoc/contents/LICENSE?ref=261fc257d17c3eab0f673be31c408fd9fdc2171a' --jq .content | base64 --decode
   gh api 'repos/firecrawl/anydoc/contents/node/package.json?ref=261fc257d17c3eab0f673be31c408fd9fdc2171a' --jq .content | base64 --decode
   gh api 'repos/firecrawl/anydoc/contents/node/cli.js?ref=261fc257d17c3eab0f673be31c408fd9fdc2171a' --jq .content | base64 --decode
   gh api 'repos/firecrawl/anydoc/contents/node/anydoc.js?ref=261fc257d17c3eab0f673be31c408fd9fdc2171a' --jq .content | base64 --decode
   ```

4. For a requested newer sync, resolve and record the new commit first. Inspect the CLI and relevant library behavior, not only the upstream skill. Recheck supported formats, version/runtime requirements, exit codes, OCR defaults, and endpoint/credential handling.
5. Reclassify with the slimming process. Apply only relevant upstream changes with native edit/write tools. Reapply the overlays above. Maintain the locally authored wrapper/tests rather than replacing them with upstream prose. Do not reinitialize an existing skill. The original installation used `init_skill.py` without resource or eval directories; the wrapper increment later added only `scripts/`.
6. Update this source record and acceptance evidence. Keep README and inventory consistent with the actual installed roots.
7. Run the validation and local-fixture checks below. Fix in-scope failures. Remove only task-created temporary artifacts after checking symlink boundaries.
8. Report checks and limits. Leave changes unstaged unless separately authorized. Do not commit, push, install a global CLI, change project dependencies, upload real documents, call real hosted OCR, or mutate hosted services as part of a sync. Standing retry authorization applies to requested conversion/inspection, not maintenance tests.

## Validation

From the repository root, use bounded native shell diagnostics with explicit repository `cwd`. Use `-B`/`PYTHONDONTWRITEBYTECODE=1` to avoid bytecode artifacts. Isolate uv from caller projects and block network access. Use cached PyYAML and Ruff; missing offline resources must stop, never retry online:

```bash
env -u FIRECRAWL_API_KEY -u FIRECRAWL_API_URL UV_PYTHON_DOWNLOADS=never PYTHONDONTWRITEBYTECODE=1 uv run --no-project --offline python -B -m unittest discover -s agent/skills/convert-documents-to-markdown/scripts -p 'test_*.py' -v
uvx --offline ruff check --no-cache agent/skills/convert-documents-to-markdown/scripts
uv run --no-project --offline --with pyyaml python -B agent/skills/skill-creator/scripts/quick_validate.py agent/skills/convert-documents-to-markdown
uv run --no-project --offline --with pyyaml python -B -c '
from pathlib import Path
import sys
sys.path.insert(0, "agent/skills/skill-creator/scripts")
from quick_validate import validate_skill
skills = sorted(Path("agent/skills").glob("*/SKILL.md"))
for skill in skills:
    valid, message = validate_skill(skill.parent)
    print(f"{skill.parent.name}: {message}")
    if not valid:
        raise SystemExit(1)
print(f"Validated {len(skills)} Local Skills")
'
GIT_OPTIONAL_LOCKS=0 git diff --check
```

The helper suite uses mocks and a sandbox fake npx, not the installed AnyDoc CLI or network. Two launcher methods also use installed uv with the existing interpreter, offline safety settings, and blocked Python downloads. Each runs from a nested synthetic caller project with an unresolved dependency, both without and with existing lock/venv markers. Snapshots include symlink text without following interpreter targets; cleanup removes links, never targets. Missing uv skips only the launcher methods. Test children receive a clean environment with no key or a clearly synthetic test credential. The suite covers local stdout/file output, one retry, official-only destinations, missing keys, opt-out, exact stdin replay, argument/format/output preservation, unsafe outputs, error boundaries, redaction, standalone invocation, timeout, and closed downstream pipes. Fake calls do not prove live service behavior or agent privacy judgment.

Also check all skill frontmatter/UI metadata, changed local Markdown links, the inventory/root count, and the exact four-file tree. Scan changed files and staged diff for home paths, secret-like values, placeholders, and generated artifacts without displaying secret values. Confirm that the Git index and unrelated user changes remain unchanged. Preserve the 39-root/38-classified inventory and deferred Outpour/Impeccable exclusions.

For future CLI source/version changes, repeat native local regressions with synthetic CSV, RTF, DOCX, image-only/mixed PDF, stdin, format overrides, output, and generic usage/read failures. Use an already cached pinned package, strip the real key, and block external OCR fetches; do not retrieve packages without separate authority. A hosted simulation requires separately authorized test-only loopback interception and a synthetic credential. Verify whole-PDF bytes, multipart fields, environment-key authentication, and exactly one request; test auth, credits, rate-limit, service, network, and missing-Markdown failures. Production endpoint restrictions must remain official-only.

No real document upload, real credential, service request, charge, or model benchmark is required or authorized for maintenance. Remove only task-created temporary artifacts after symlink checks. Do not save private document names, paths, or content as acceptance evidence.

## Historical installation acceptance evidence

This section records the original approval-only installation, before the user's standing automatic-retry authorization. Its policy observations and test restrictions are historical, not the current runtime contract.

Tested package: **`@firecrawl/anydoc@0.2.4`** via `npx -y`, on Node `v24.18.0`, npx `12.0.2`, and uv `0.12.21`. A temporary Python runner used `uv run python -B` and subprocess input for stdin. All 17 cases passed after suppressing npm notices. The initial runner assertion rejected npm notice lines before the expected `anydoc:` error; it was an output-isolation issue, not a conversion failure.

Each table entry uses `npx -y @firecrawl/anydoc@0.2.4` followed by the arguments shown:

| Arguments / case | Observed result |
| --- | --- |
| `--version` | Exit 0; exact version `0.2.4`. |
| `data.csv` | Exit 0; Markdown table contains both rows. |
| `- --format csv` with CSV stdin | Exit 0; byte-identical to path conversion. |
| `data-no-extension --format csv`, `data.wrong --format csv` | Two cases; exit 0; same Markdown. |
| `-` with CSV stdin, without format | Exit 1; unrecognized content; asks for an explicit format. |
| `sample.rtf` | Exit 0; both synthetic text strings present. |
| `data.csv -o out.md` with a fresh output path | Exit 0; empty stdout; file bytes equal stdout conversion. |
| `data.csv -o .` | Exit 1; output directory rejected. |
| `invalid.bin`, `absent.csv` | Two cases; exit 1 for unsupported input and missing file. |
| No arguments; `data.csv --unknown`; `data.csv --format unknown`; `data.csv sample.rtf` | Four cases; exit 2 for usage failures, including one-file-only behavior. |
| `image-only.pdf`, `image-only.pdf --ocr reject` | Two cases; exit 3; `anydoc: page 1 of 1 needs OCR`. |

Original fixture hashes stayed unchanged. Native `read` confirmed the four-line CSV table in `out.md`. The loopback Parse endpoint received **zero requests** across the successful suite; no test invoked hosted mode or used an API key. No real user document or real hosted OCR service was used.

Target validation and all **39** installed Local Skill validators passed, including the deferred Outpour root for validation only. The inventory has **38** classified roots plus one blank Outpour row. Metadata, 13 changed-file local Markdown links, changed-file scans, the two-file runtime tree, and whitespace checks passed. The Git index stayed unchanged. Check these again on every later sync rather than treating this installation record as future proof.

Context Mode rejected a bare shell loop before execution because its environment prefix preceded `for`. A Python launcher then ran the same validators successfully. The inventory audit initially compared the authorized count/date change as if it were exclusion text; correcting that matcher confirmed unchanged Outpour and Impeccable exclusions.

### Semantic review and evidence limits

- Positive triggers: convert a DOCX to Markdown, inspect an unreadable PDF, extract spreadsheet contents, or convert CSV stdin. Review found these inside the conversion scope.
- Near misses: edit an existing Markdown README, scrape a website, query Notion, or upload a document to NotebookLM. Review found these outside the scope; browser, Notion, and NotebookLM skills retain their own workflows.
- Decision boundaries: read-only inspection stays nonpersistent; output writes need authority; OCR-needed input stops; whole-document/custom-destination approval precedes hosted mode; a library pointer does not authorize project changes.
- Routing and privacy compliance are **semantic review**, not proven agent behavior. No comparative model evaluation or benchmark ran.
- Fixtures cover CSV, RTF, and one image-only PDF, not every advertised format, malformed-document variant, platform, or large-document workload.
- The loopback counter and reject-mode results support the local OCR boundary. They are not network-wide monitoring or evidence of hosted OCR correctness, billing, quotas, or service privacy. Hosted OCR tests against a real service are prohibited for this installation.
- At installation, runtime examples preserved upstream's unpinned npm command. The later wrapper pins `0.2.4`; repeat native regressions before updating that pin.
- The artifact scan found pre-existing `impeccable/node_modules` and `skill-creator/scripts/__pycache__/quick_validate.cpython-314.pyc` (August/September timestamps). These remain untouched. No generated artifacts exist in the new skill; Python checks used `-B`.
- Outpour remediation and Impeccable removal remain deferred and untouched.

## Historical declarative automatic-retry policy evidence

This section predates the bundled wrapper. The source commit and CLI default stayed unchanged. That increment updated only local skill policy, metadata, and maintenance descriptions; it did not add a wrapper, install packages, or synchronize upstream.

The cached **`@firecrawl/anydoc@0.2.4`** package reproduced the pinned source behavior: fallback requires `needsOcr` plus hosted mode; `parseHosted` sends the whole PDF to `/v2/parse`. An empty configured URL is not a default: the library uses nullish fallback, so local policy treats it as malformed. The runtime checks the exact destination before pinning the automatic retry.

A task-created temporary reference harness ran **37 passing checks** with **9 loopback POSTs**:

- Image-only and mixed PDFs: default and explicit reject returned exit 3 with no key and zero requests.
- One retry after exit 3: original mixed-PDF bytes, multipart fields, fake environment-key authentication, stdout/newline, explicit format, authorized temporary output, and explicit URL precedence passed.
- CSV/RTF local success and generic read/conversion/usage/output errors made no requests. Native hosted mode also did not upload generic failures.
- Stub 401, 402, 429, 500, missing-Markdown, and disconnected-service failures each returned exit 1 after one POST, without another retry.
- Missing key, all four opt-outs, sensitive-data prohibition, custom destinations, and an already-used retry stopped without POSTs. Twelve malformed/custom URL variants were checked for both argument and environment configuration; default/official URLs and optional trailing slash were accepted.
- Consumed unreplayable stdin stopped for replay; replayable synthetic stdin retained the original bytes and format. All fixture hashes stayed unchanged.

Every test launcher removed the real key; test children received no key or only a clearly synthetic credential. A Node fetch guard allowed only the isolated loopback Parse URL. No real Firecrawl request, real user document, source fetch, package retrieval, or installation occurred. Test artifacts stayed outside the repository and were removed after symlink checks.

The policy cases and routing/opt-out review are reference-harness tests plus semantic review, not proof of model execution. No model benchmark or real hosted OCR test ran. The historical format/platform/large-document and unpinned-runtime-version limits above still apply. Outpour and Impeccable remain deferred and untouched.

## Bundled-wrapper acceptance evidence

The local stdlib helper and its repeatable suite replace ad hoc agent OCR orchestration. Source commit and CLI package version remain unchanged; UI metadata remains accurate. The installed tree now contains the root, metadata, wrapper, and test file only.

The current suite passed **41 unittest methods**, including subcases for 17 forbidden endpoint variants and 15 hosted error combinations. Six methods retain actual subprocess behavior with a sandbox fake npx, redirected-file stdin, or a missing executable. Two more methods cover four installed-uv launcher cases; uv `0.12.21` ran all four without skips. The tests demonstrate deterministic wrapper decisions, replay, output safety, argv/environment separation, diagnostics/redaction, bounded waits, and downstream pipe behavior. They do not prove live Firecrawl service correctness. The target validator, all **39** Local Skill validators (including metadata and skill-local links), and focused offline Ruff lint passed.

The first run found whitespace endpoint redaction that obscured diagnostics, a missing-executable fixture whose empty PATH selected the sandbox executable, and scoped lint errors. Targeted fixes restored readable endpoint diagnostics, used a nonexistent PATH directory, and corrected imports/test bindings. The corrected tests and lint passed. A further output-safety check added descriptor-based protection for regular-file stdin aliases and verified authorized existing output remains unchanged until hosted success. No real key, real document, real hosted request, package retrieval, or project install was used. Temporary test sandboxes were removed after root symlink checks; no new skill artifacts remained.

Focused remediation added relative/absolute symlink-plus-`..` regressions with distinct target/decoy files. Inputs select the filesystem target without modifying either original; outputs stop before conversion without modifying either existing file. Direct string/byte tests cover `http`, `https`, `HTTP`, `HTTPS`, `hTtP`, and `hTtPs`; both-attempt tests cover uppercase/mixed URLs, exact-key controls, unchanged diagnostic text, and successful Markdown. The four affected methods produced 14 expected subcase failures before the two fixes; all 32 methods, focused offline Ruff, target validation, and all 39 Local Skill validators passed afterward.

Redaction-order remediation applies the existing case-insensitive credential-URL pattern to original bytes/strings before exact environment substitutions. Byte-level exact masking still precedes lossy UTF-8 decoding. Four added methods cover eight overlapping key/endpoint combinations in both representations, official/non-overlap controls, local success and blocked endpoints, invalid UTF-8, and empty/whitespace values. The two overlap methods failed 48 subcases before the fix: 16 direct, 16 local-success, and 16 blocked-endpoint cases. Afterward, all 36 methods, focused offline Ruff, target validation, and all 39 Local Skill validators passed. Blocked endpoints still return 3 after one local call without hosted retry; successful stdout Markdown remains unchanged.

Exact-value overlap remediation replaces sequential substitutions with one escaped, longest-first alternation per byte/string stage and callback replacements. Three added methods cover key prefixes, interior path/query overlaps, reverse/identical values, replacement-marker text, regex metacharacters, repeated endpoint occurrences, and invalid UTF-8. The three methods failed 48 subcases before the fix; all passed afterward. The first corrected run found two test assertions that incorrectly exempted URL-stage marker text from existing exact-key masking, plus a Ruff loop-binding error in the snapshot fixture. Correcting those assertions and binding the fixture's project retained the two-stage contract; tests and lint passed. Existing URL/key, whitespace, path, endpoint, retry, and unchanged-Markdown controls still pass. The two launcher methods first rejected the old documented examples, then passed with isolated normal and explicit offline/no-network launchers. All caller snapshots, including existing lock/venv markers and interpreter links, stayed unchanged. No sync, download, network access, real service request, or real key was used. Focused offline Ruff, target/all 39 validators, metadata/local-link/scans/artifact/whitespace checks passed; staging stayed unchanged.

Human/agent selection of `--no-ocr` for sensitive data or explicit opt-outs remains a policy boundary, not automatic content classification. Buffering, stable-filesystem, non-atomic output, non-POSIX cleanup, native-format coverage, and live-service limits remain as documented above. Independent review is a separate parent gate, not implementation approval. Outpour and Impeccable remain excluded and untouched.

## Upstream MIT notice

From [`LICENSE`](https://github.com/firecrawl/anydoc/blob/261fc257d17c3eab0f673be31c408fd9fdc2171a/LICENSE) at the pinned commit:

```text
MIT License

Copyright (c) 2026 Sideguide Technologies Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
