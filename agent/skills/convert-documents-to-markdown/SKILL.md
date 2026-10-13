---
name: convert-documents-to-markdown
description: "Convert Word (.doc, .docx), PowerPoint (.ppt, .pptx), Excel (.xls, .xlsx), OpenDocument (.odt, .ods, .odp), RTF, EPUB, CSV, and PDF files to GitHub-Flavored Markdown. Use when asked to convert these files to Markdown or inspect an office document, spreadsheet, presentation, ebook, or PDF that cannot be read directly. Not for editing existing Markdown or scraping web pages."
---

# Convert Documents to Markdown

Use the bundled [conversion wrapper](scripts/convert_document.py) with uv, Python >=3.9, Node >=20, and npx. It invokes the tested `@firecrawl/anydoc@0.2.4` CLI. Use `--no-project` to avoid discovering or syncing the caller's Python project. Process one document per command; preserve the original. Resolve `<skill-dir>` to this skill's directory.

## Convert

Select `--no-ocr` before execution for **local only**, **no upload**, **no hosted OCR**, or **no network** requests, known unredacted sensitive data, or other host-prohibited uploads. The wrapper cannot infer document privacy from bytes. For no-network requests, also use uv `--offline` and set `npm_config_offline=true` to block interpreter/package retrieval. Missing offline resources must stop; never retry online.

```bash
uv run --no-project python <skill-dir>/scripts/convert_document.py "report.docx"
uv run --no-project python <skill-dir>/scripts/convert_document.py "report.docx" -o out.md
uv run --no-project python <skill-dir>/scripts/convert_document.py - --format csv < data.csv
uv run --no-project python <skill-dir>/scripts/convert_document.py "scan.pdf" --no-ocr
npm_config_offline=true uv run --no-project --offline python <skill-dir>/scripts/convert_document.py "scan.pdf" --no-ocr
```

- Supported inputs: `.doc`, `.docx`, `.docm`, `.odt`, `.rtf`, `.epub`, `.pdf`, `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.odp`, `.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.ods`, `.csv`.
- Detection uses content, with extension fallback for signature-less CSV. Use `-f` / `--format csv` for CSV stdin or CSV with a missing/wrong extension. Use `--format <name>` when detection cannot identify the intended format. For option-like filenames, use `./-name.pdf` or place the input after `--`.
- Prefer stdout for read-only inspection. Use Context Mode for potentially large stdout or diagnostics, with explicit project `cwd` and focused queries. Use native `read` with targeted ranges for converted files.
- Persistent `-o` / `--output` requires requested or authorized output. Add `--overwrite` only for explicitly authorized replacement. The wrapper refuses output aliases of path/regular-file stdin inputs, output symlinks (including parent directories), and multiply linked existing outputs, even with `--overwrite`. For piped input, do not authorize output to the producer's source file: the wrapper cannot identify that file. Use stable, trusted directories. Markdown is buffered and written only after successful conversion; an output I/O failure can leave a partial authorized file.
- The wrapper buffers original stdin bytes for replay, without temporary input files. Terminal stdin returns usage error. Markdown also stays in memory until success. Subprocess limits are **120 seconds local / 360 seconds hosted**; the hosted limit covers AnyDoc's native 300-second timeout. See the maintenance guide for platform and buffering limits.
- For large-document inspection, use Context Mode stdout or, only if host policy permits, a task-scoped temporary directory outside the repository. Remove only task-created artifacts after checking symlink boundaries. Do not turn inspection into persistent repository changes.

## Retry and recovery

The wrapper first uses explicit `--ocr reject`, without the environment key. Only exit `3` / `NeedsOcr` permits one hosted invocation. It requires nonempty `FIRECRAWL_API_KEY` and an unset `FIRECRAWL_API_URL` or exact `https://api.firecrawl.dev` with an optional trailing slash. It then pins the official URL, replays input, preserves format/output, and prints the whole-PDF/privacy/possible-cost/rate-limit notice on stderr before retry. It reports hosted use and redacts the exact environment key from upstream stderr. Never print, log, or save secrets.

The user's standing authorization covers this necessary official retry for requested conversion/inspection, not other services or work. Do not repeat approval for ordinary non-sensitive documents within that authorization. Explicit opt-outs and host sensitive-data/redaction rules still win. Do not upload real documents as tests.

- Exit `0`: verify the requested content or authorized output.
- Exit `1`: inspect the read/conversion/service, dependency, timeout, or output error; correct the local problem or report the limit.
- Exit `2`: correct usage or format. The wrapper accepts no API-key, endpoint, OCR-mode, or arbitrary passthrough flags.
- Exit `3`: OCR remains needed because `--no-ocr`, a missing/empty key, a blocked destination, or a hosted result stopped conversion. Report the boundary; do not add another hosted attempt.

Custom, empty, malformed, or credential-bearing endpoint configuration stops rather than redirecting credentials. Separate named-document/destination/credential approval and manual handling are required; the wrapper intentionally has no custom-destination approval flag. Do not silently clear explicit configuration. No local exit `1`/`2` or failed hosted call permits retry. Diagnostics stay on stderr; requested Markdown stays on stdout or in the authorized file.

## Project integration

For requested Node, Python, or Rust integration, prefer the library over shelling out: `@firecrawl/anydoc` (npm), `firecrawl-anydoc` (PyPI), or `anydoc` (crates.io), with `toMarkdown` / `to_markdown`. This pointer does not authorize dependency installation or source changes.

Finish with the requested content or authorized output path and the conversion result. Report when hosted OCR was used. Report failures, missing dependencies, opt-outs, or approval needs without claiming conversion succeeded.

## Maintenance

See the [AnyDoc update process](../../../docs/skills/anydoc-update-process.md) for provenance, the MIT notice, local overlays, and validation evidence.
