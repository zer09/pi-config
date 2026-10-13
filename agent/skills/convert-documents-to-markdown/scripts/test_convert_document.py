import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import convert_document as converter

SYNTHETIC_KEY = "synthetic-test-key"
OVERLAPPING_ENV_VALUES = (
    (SYNTHETIC_KEY, "https"),
    (SYNTHETIC_KEY, "@"),
    (SYNTHETIC_KEY, "https://synthetic-user:"),
    ("https", "synthetic-config.invalid"),
    ("@", "https://configured.invalid/"),
    ("https://synthetic-user:", "https://configured.invalid/"),
    ("https", "@"),
    ("@", "https://synthetic-user:"),
)
EXACT_OVERLAPPING_ENV_VALUES = (
    ("https", "https://configured.invalid/private-path"),
    ("private", "https://configured.invalid/private-path"),
    ("synthetic-query-key", "https://configured.invalid/private-path?token=synthetic-query-key&other=private-query"),
    ("https://configured.invalid/", "https://configured.invalid/private-path"),
    ("https://configured.invalid/private-path?token=synthetic-query-key", "https://configured.invalid/private-path"),
    ("https://configured.invalid/identical", "https://configured.invalid/identical"),
    ("redacted", "https://configured.invalid/redacted?other=private-query"),
    ("[redacted]", "https://configured.invalid/[redacted]/private-path"),
    (r"synthetic.+[key](x)?\path", r"https://configured.invalid/synthetic.+[key](x)?\path&other=private-query"),
    ("Private", "https://configured.invalid/Private-path?other=private-query"),
)
MARKDOWN = b"# Synthetic document\n\nConverted text.\n"
SCRIPT = Path(__file__).with_name("convert_document.py")


class ConvertDocumentTests(unittest.TestCase):
    def setUp(self):
        self.sandbox = tempfile.TemporaryDirectory(prefix="anydoc-wrapper-test-")
        self.root = Path(self.sandbox.name)
        self.source = self.root / "synthetic input.csv"
        self.source.write_bytes(b"name,value\nexample,1\n")
        self.output = self.root / "authorized output.md"

    def tearDown(self):
        self.assertFalse(self.root.is_symlink())
        for path in self.root.rglob("*"):
            if path.is_symlink():
                path.unlink()
        self.sandbox.cleanup()

    def invoke(self, args=None, results=None, environment=None, data=b"", tty=False, runner=None):
        calls = []
        results = iter(results or [(0, MARKDOWN, b"")])
        stdin = io.TextIOWrapper(io.BytesIO(data))
        stdout = io.TextIOWrapper(io.BytesIO())
        stderr = io.StringIO()

        def run(command, original, child_env, timeout):
            calls.append((command, original, child_env.copy(), timeout))
            if runner is not None:
                return runner(command, original, child_env, timeout, stderr)
            return next(results)

        with (
            patch.dict(os.environ, environment or {}, clear=True),
            patch.object(sys, "stdin", stdin),
            patch.object(sys, "stdout", stdout),
            patch.object(sys, "stderr", stderr),
            patch.object(stdin, "isatty", return_value=tty),
            patch.object(converter, "run_anydoc", side_effect=run),
        ):
            try:
                code = converter.main(args if args is not None else [str(self.source)])
            except SystemExit as error:
                code = error.code
        stdout.flush()
        return code, stdout.buffer.getvalue(), stderr.getvalue(), calls

    def test_local_stdout_success_strips_credentials_and_endpoint(self):
        code, stdout, stderr, calls = self.invoke(environment={
            "FIRECRAWL_API_KEY": SYNTHETIC_KEY,
            "FIRECRAWL_API_URL": "https://custom.invalid",
            "npm_config_offline": "true",
        })
        self.assertEqual((code, stdout, stderr), (0, MARKDOWN, ""))
        self.assertEqual(len(calls), 1)
        argv, data, environment, timeout = calls[0]
        self.assertEqual(argv, ["npx", "-y", converter.PACKAGE, "--ocr", "reject", "--", str(self.source)])
        self.assertIsNone(data)
        self.assertNotIn("FIRECRAWL_API_KEY", environment)
        self.assertNotIn("FIRECRAWL_API_URL", environment)
        self.assertEqual(environment["npm_config_offline"], "true")
        self.assertEqual(timeout, 120)
        self.assertEqual(self.source.read_bytes(), b"name,value\nexample,1\n")

    def test_local_output_only_after_success(self):
        def run(*unused):
            self.assertFalse(self.output.exists())
            return 0, MARKDOWN, b"anydoc: synthetic warning\n"

        code, stdout, stderr, calls = self.invoke(
            [str(self.source), "-o", str(self.output)], runner=run
        )
        self.assertEqual((code, stdout), (0, b""))
        self.assertIn("synthetic warning", stderr)
        self.assertEqual(self.output.read_bytes(), MARKDOWN)
        self.assertNotIn("--output", calls[0][0])

    def test_one_hosted_retry_pins_url_and_preserves_format_output(self):
        self.output.write_bytes(b"authorized old output")

        def run(command, data, environment, timeout, stderr):
            self.assertEqual(self.output.read_bytes(), b"authorized old output")
            if command[4] == "reject":
                return 3, b"discard failed partial output", b"anydoc: needs OCR\n"
            self.assertIn("WHOLE PDF", stderr.getvalue())
            self.assertIn("privacy terms, possible costs and rate limits", stderr.getvalue())
            self.assertEqual(environment["FIRECRAWL_API_KEY"], SYNTHETIC_KEY)
            self.assertNotIn("FIRECRAWL_API_URL", environment)
            self.assertEqual(timeout, 360)
            return 0, MARKDOWN, b""

        code, stdout, stderr, calls = self.invoke(
            [str(self.source), "--format", "pdf", "--output", str(self.output), "--overwrite"],
            environment={"FIRECRAWL_API_KEY": SYNTHETIC_KEY, "FIRECRAWL_API_URL": converter.OFFICIAL_URL + "/"},
            runner=run,
        )
        self.assertEqual((code, stdout), (0, b""))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][0], [
            "npx", "-y", converter.PACKAGE, "--ocr", "hosted", "--api-url",
            converter.OFFICIAL_URL, "--format", "pdf", "--", str(self.source),
        ])
        self.assertNotIn(SYNTHETIC_KEY, str([call[0] for call in calls]))
        self.assertIn("hosted OCR used; result exit 0", stderr)
        self.assertEqual(self.output.read_bytes(), MARKDOWN)

    def test_no_ocr_opt_out_wins_over_key_and_endpoint(self):
        code, stdout, stderr, calls = self.invoke(
            [str(self.source), "--no-ocr"], [(3, b"", b"")],
            {"FIRECRAWL_API_KEY": SYNTHETIC_KEY, "FIRECRAWL_API_URL": converter.OFFICIAL_URL},
        )
        self.assertEqual((code, stdout, len(calls)), (3, b"", 1))
        self.assertIn("--no-ocr prohibits", stderr)
        self.assertNotIn("retrying", stderr)

    def test_missing_and_empty_key_stop(self):
        for environment in ({}, {"FIRECRAWL_API_KEY": ""}):
            with self.subTest(environment=environment):
                code, stdout, stderr, calls = self.invoke(results=[(3, b"", b"")], environment=environment)
                self.assertEqual((code, stdout, len(calls)), (3, b"", 1))
                self.assertIn("nonempty FIRECRAWL_API_KEY", stderr)

    def test_official_default_and_optional_slash(self):
        for url in (None, converter.OFFICIAL_URL, converter.OFFICIAL_URL + "/"):
            with self.subTest(url=url):
                environment = {"FIRECRAWL_API_KEY": SYNTHETIC_KEY}
                if url is not None:
                    environment["FIRECRAWL_API_URL"] = url
                code, stdout, _, calls = self.invoke(results=[(3, b"", b""), (0, MARKDOWN, b"")], environment=environment)
                self.assertEqual((code, stdout, len(calls)), (0, MARKDOWN, 2))
                self.assertEqual(calls[1][0][6], converter.OFFICIAL_URL)

    def test_forbidden_endpoint_variants_stop_without_echoing_url(self):
        for url in (
            "", " ", "https://custom.invalid", "http://api.firecrawl.dev",
            "HTTPS://api.firecrawl.dev", "https://API.firecrawl.dev",
            "https://api.firecrawl.dev:443", "https://api.firecrawl.dev/v2",
            "https://api.firecrawl.dev?key=private", "https://api.firecrawl.dev#private",
            "https://api.firecrawl.dev//", "https://api.firecrawl.dev.evil.invalid",
            "https://user:password@api.firecrawl.dev", "https://api.firecrawl.dev@evil.invalid",
            "https://[api.firecrawl.dev", "api.firecrawl.dev", "https://api.firecrawl.dev\n",
        ):
            with self.subTest(url=url):
                code, stdout, stderr, calls = self.invoke(results=[(3, b"", b"")], environment={
                    "FIRECRAWL_API_KEY": SYNTHETIC_KEY, "FIRECRAWL_API_URL": url,
                })
                self.assertEqual((code, stdout, len(calls)), (3, b"", 1))
                self.assertIn("separate approval/manual handling", stderr)
                if url.strip():
                    self.assertNotIn(url, stderr)

    def test_stdin_original_bytes_replayed(self):
        data = b"%PDF-synthetic\x00\xff\r\n"
        code, stdout, _, calls = self.invoke(
            ["-", "-f", "pdf"], [(3, b"", b""), (0, MARKDOWN, b"")],
            {"FIRECRAWL_API_KEY": SYNTHETIC_KEY}, data=data,
        )
        self.assertEqual((code, stdout), (0, MARKDOWN))
        self.assertEqual([call[1] for call in calls], [data, data])
        for argv, *_ in calls:
            self.assertEqual(argv[-4:], ["--format", "pdf", "--", "-"])

    def test_terminal_stdin_is_usage_error_without_attempt(self):
        code, stdout, stderr, calls = self.invoke(["-"], tty=True)
        self.assertEqual((code, stdout, len(calls)), (2, b"", 0))
        self.assertIn("stdin is a terminal", stderr)

    def test_option_like_and_space_filenames(self):
        for name in ("--ocr", "--api-url=custom", "-document with spaces.pdf"):
            with self.subTest(name=name), patch("os.getcwd", return_value=str(self.root)):
                code, _, _, calls = self.invoke(["--", name])
                self.assertEqual(code, 0)
                self.assertEqual(calls[0][0][-2:], ["--", str(self.root / name)])

    def test_symlink_dotdot_input_preserves_filesystem_selection(self):
        target = self.root / "target"
        nested = target / "nested"
        nested.mkdir(parents=True)
        (self.root / "link").symlink_to(nested, target_is_directory=True)
        selected = target / "input.csv"
        decoy = self.root / "input.csv"
        selected.write_bytes(b"name,value\ntarget,1\n")
        decoy.write_bytes(b"name,value\ndecoy,2\n")

        def run(command, *unused):
            return 0, Path(command[-1]).read_bytes(), b""

        for absolute in (False, True):
            argument = Path("link") / ".." / "input.csv"
            if absolute:
                argument = self.root / argument
            with self.subTest(absolute=absolute), patch("os.getcwd", return_value=str(self.root)):
                code, stdout, stderr, calls = self.invoke([str(argument)], runner=run)
                self.assertEqual((code, stdout, stderr, len(calls)), (0, b"name,value\ntarget,1\n", "", 1))
                self.assertEqual(calls[0][0][-1], str(self.root / "link" / ".." / "input.csv"))
                self.assertEqual(selected.read_bytes(), b"name,value\ntarget,1\n")
                self.assertEqual(decoy.read_bytes(), b"name,value\ndecoy,2\n")

    def test_symlink_dotdot_output_refused_before_conversion(self):
        target = self.root / "target"
        nested = target / "nested"
        nested.mkdir(parents=True)
        (self.root / "link").symlink_to(nested, target_is_directory=True)
        selected = target / "output.md"
        decoy = self.root / "output.md"
        selected.write_bytes(b"original target output")
        decoy.write_bytes(b"original decoy output")
        for absolute in (False, True):
            argument = Path("link") / ".." / "output.md"
            if absolute:
                argument = self.root / argument
            with self.subTest(absolute=absolute), patch("os.getcwd", return_value=str(self.root)):
                code, stdout, stderr, calls = self.invoke([
                    str(self.source), "-o", str(argument), "--overwrite",
                ])
                self.assertEqual((code, stdout, len(calls)), (1, b"", 0))
                self.assertIn("output symlinks", stderr)
                self.assertEqual(selected.read_bytes(), b"original target output")
                self.assertEqual(decoy.read_bytes(), b"original decoy output")
                self.assertEqual(self.source.read_bytes(), b"name,value\nexample,1\n")

    def test_supported_argument_precedence_and_no_passthrough(self):
        first = self.root / "unused.md"
        code, stdout, _, calls = self.invoke([
            str(self.source), "-f", "csv", "--format", "rtf",
            "-o", str(first), "--output", str(self.output),
        ])
        self.assertEqual((code, stdout), (0, b""))
        self.assertEqual(calls[0][0][-4:-2], ["--format", "rtf"])
        self.assertFalse(first.exists())
        self.assertEqual(self.output.read_bytes(), MARKDOWN)
        for option in ("--api-key", "--api-url", "--ocr", "--no-o"):
            code, _, stderr, calls = self.invoke([str(self.source), option, "https://user:password@custom.invalid"])
            self.assertEqual((code, len(calls)), (2, 0))
            self.assertNotIn("password", stderr)

    def test_no_retry_on_local_conversion_or_usage_failure(self):
        for code in (1, 2):
            with self.subTest(code=code):
                result, stdout, stderr, calls = self.invoke(results=[(code, b"partial", b"anydoc: failed\n")], environment={"FIRECRAWL_API_KEY": SYNTHETIC_KEY})
                self.assertEqual((result, stdout, len(calls)), (code, b"", 1))
                self.assertIn("failed", stderr)
                self.assertNotIn("retrying", stderr)

    def test_hosted_errors_never_repeat(self):
        for code in (1, 2, 3):
            for error in (b"auth", b"credits", b"rate limit", b"network", b"service"):
                with self.subTest(code=code, error=error):
                    result, stdout, stderr, calls = self.invoke(results=[(3, b"", b""), (code, b"partial", error)], environment={"FIRECRAWL_API_KEY": SYNTHETIC_KEY})
                    self.assertEqual((result, stdout, len(calls)), (code, b"", 2))
                    self.assertIn(f"hosted OCR used; result exit {code}", stderr)

    def test_timeouts_and_missing_executable_have_no_traceback(self):
        for failure in (subprocess.TimeoutExpired(["npx"], 120), FileNotFoundError("synthetic missing executable")):
            run = Mock(side_effect=failure)
            with self.subTest(failure=type(failure).__name__):
                code, stdout, stderr, calls = self.invoke(runner=run)
                self.assertEqual((code, stdout, len(calls)), (1, b"", 1))
                self.assertNotIn("Traceback", stderr)

    def test_hosted_timeout_stops_and_reports_use(self):
        def run(command, *unused):
            if command[4] == "reject":
                return 3, b"", b""
            raise subprocess.TimeoutExpired(command, 360)
        code, _, stderr, calls = self.invoke(runner=run, environment={"FIRECRAWL_API_KEY": SYNTHETIC_KEY})
        self.assertEqual((code, len(calls)), (1, 2))
        self.assertIn("360 seconds", stderr)
        self.assertIn("hosted OCR used; result exit 1", stderr)

    def test_output_exists_requires_overwrite_and_failures_preserve_it(self):
        self.output.write_bytes(b"original output")
        code, _, _, calls = self.invoke([str(self.source), "-o", str(self.output)])
        self.assertEqual((code, len(calls)), (1, 0))
        for failure in (1, 2, 3):
            code, stdout, _, _ = self.invoke([str(self.source), "-o", str(self.output), "--overwrite", "--no-ocr"], results=[(failure, b"partial", b"")])
            self.assertEqual((code, stdout), (failure, b""))
            self.assertEqual(self.output.read_bytes(), b"original output")
        code, _, _, _ = self.invoke([str(self.source), "-o", str(self.output), "--overwrite"])
        self.assertEqual(code, 0)
        self.assertEqual(self.output.read_bytes(), MARKDOWN)

    def test_source_same_path_and_aliases_refused_even_with_overwrite(self):
        hardlink = self.root / "source-hardlink.csv"
        os.link(self.source, hardlink)
        symlink = self.root / "source-symlink.csv"
        symlink.symlink_to(self.source)
        for output in (self.source, self.root / "./synthetic input.csv", hardlink, symlink):
            with self.subTest(output=output):
                code, _, _, calls = self.invoke([str(self.source), "-o", str(output), "--overwrite"])
                self.assertEqual((code, len(calls)), (1, 0))
                self.assertEqual(self.source.read_bytes(), b"name,value\nexample,1\n")

    def test_dangling_symlink_and_symlink_parents_are_refused(self):
        self.output.symlink_to(self.root / "missing.md")
        parent = self.root / "alias"
        parent.symlink_to(self.root, target_is_directory=True)
        for output in (self.output, parent / "fresh.md"):
            for overwrite in ([], ["--overwrite"]):
                with self.subTest(output=output, overwrite=overwrite):
                    code, _, _, calls = self.invoke([str(self.source), "-o", str(output), *overwrite])
                    self.assertEqual((code, len(calls)), (1, 0))
        self.assertFalse((self.root / "missing.md").exists())
        self.assertFalse((self.root / "fresh.md").exists())
        self.assertTrue(self.output.is_symlink())

    def test_multiply_linked_output_directory_and_invalid_overwrite(self):
        self.output.write_bytes(b"original")
        os.link(self.output, self.root / "other.md")
        for output in (self.output, self.root):
            code, _, _, calls = self.invoke([str(self.source), "-o", str(output), "--overwrite"])
            self.assertEqual((code, len(calls)), (1, 0))
        code, _, _, calls = self.invoke([str(self.source), "--overwrite"])
        self.assertEqual((code, len(calls)), (2, 0))

    def test_output_race_is_rechecked_before_write(self):
        for alias in (False, True):
            def run(*unused, make_alias=alias):
                if make_alias:
                    os.link(self.source, self.output)
                else:
                    self.output.write_bytes(b"appeared during conversion")
                return 0, MARKDOWN, b""
            with self.subTest(alias=alias):
                code, _, _, _ = self.invoke([str(self.source), "-o", str(self.output)], runner=run)
                self.assertEqual(code, 1)
                self.assertNotEqual(self.output.read_bytes(), MARKDOWN)
                self.output.unlink()

    def test_credential_url_redaction_all_scheme_cases_strings_and_bytes(self):
        for scheme in ("http", "https", "HTTP", "HTTPS", "hTtP", "hTtPs"):
            for as_bytes in (False, True):
                message = (
                    f"AnyDoc WARNING: {SYNTHETIC_KEY} "
                    f"{scheme}://synthetic-user:synthetic-password@custom.invalid/path "
                    f"{SYNTHETIC_KEY.upper()} https://configured.invalid/ "
                    "https://public.invalid/ Keep MiXeD text.\n"
                )
                if as_bytes:
                    message = message.encode()
                stderr = io.StringIO()
                stdout = io.StringIO()
                with (
                    self.subTest(scheme=scheme, as_bytes=as_bytes),
                    patch.dict(os.environ, {
                        "FIRECRAWL_API_KEY": SYNTHETIC_KEY,
                        "FIRECRAWL_API_URL": "https://configured.invalid/",
                    }, clear=True),
                    patch.object(sys, "stderr", stderr),
                    patch.object(sys, "stdout", stdout),
                ):
                    converter.diagnostic(message)
                    self.assertEqual(stderr.getvalue(), (
                        f"AnyDoc WARNING: [redacted] [redacted URL] {SYNTHETIC_KEY.upper()} "
                        "[redacted] https://public.invalid/ Keep MiXeD text.\n"
                    ))
                    self.assertEqual(stdout.getvalue(), "")

    def test_credential_url_redaction_precedes_overlapping_environment_values(self):
        for key, url in (
            *OVERLAPPING_ENV_VALUES,
            (SYNTHETIC_KEY, converter.OFFICIAL_URL),
            (SYNTHETIC_KEY, "https://configured.invalid/"),
        ):
            for as_bytes in (False, True):
                message = (
                    "AnyDoc WARNING: https://synthetic-user:synthetic-password@custom.invalid/path "
                    f"key={key} endpoint={url} Keep MiXeD text.\tNext line.\n\n"
                )
                if as_bytes:
                    message = message.encode()
                stderr = io.StringIO()
                with (
                    self.subTest(key=key, url=url, as_bytes=as_bytes),
                    patch.dict(os.environ, {
                        "FIRECRAWL_API_KEY": key, "FIRECRAWL_API_URL": url,
                    }, clear=True),
                    patch.object(sys, "stderr", stderr),
                ):
                    converter.diagnostic(message)
                    self.assertEqual(stderr.getvalue(), (
                        "AnyDoc WARNING: [redacted URL] key=[redacted] endpoint=[redacted] "
                        "Keep MiXeD text.\tNext line.\n"
                    ))

    def test_overlapping_redaction_preserves_local_success_and_blocked_endpoint(self):
        for key, url in OVERLAPPING_ENV_VALUES:
            for as_bytes in (False, True):
                for local_code in (0, 3):
                    message = (
                        "anydoc: https://synthetic-user:synthetic-password@custom.invalid/path "
                        f"key={key} endpoint={url} Keep MiXeD text.\n"
                    )
                    if as_bytes:
                        message = message.encode()
                    with self.subTest(key=key, url=url, as_bytes=as_bytes, local_code=local_code):
                        code, stdout, stderr, calls = self.invoke(
                            results=[(local_code, MARKDOWN, message)],
                            environment={"FIRECRAWL_API_KEY": key, "FIRECRAWL_API_URL": url},
                        )
                        expected_stdout = MARKDOWN if local_code == 0 else b""
                        self.assertEqual((code, stdout, len(calls)), (local_code, expected_stdout, 1))
                        self.assertEqual(calls[0][0][3:5], ["--ocr", "reject"])
                        self.assertNotIn("FIRECRAWL_API_KEY", calls[0][2])
                        self.assertNotIn("FIRECRAWL_API_URL", calls[0][2])
                        expected_stderr = (
                            "anydoc: [redacted URL] key=[redacted] endpoint=[redacted] Keep MiXeD text.\n"
                        )
                        if local_code == 3:
                            expected_stderr += (
                                "convert_document: OCR needed; configured endpoint is not the exact official URL; "
                                "separate approval/manual handling is required\n"
                            )
                        self.assertEqual(stderr, expected_stderr)
                        self.assertNotIn("synthetic-user", stderr)
                        self.assertNotIn("synthetic-password", stderr)
                        self.assertNotIn(key, stderr)
                        self.assertNotIn(url, stderr)
                        self.assertNotIn("retrying", stderr)

    def test_exact_environment_overlaps_mask_whole_values_once(self):
        for key, url in EXACT_OVERLAPPING_ENV_VALUES:
            for as_bytes in (False, True):
                message = (
                    "anydoc: hTtPs://synthetic-user:synthetic-password@custom.invalid/path "
                    f"key={key}; endpoint={url}; repeated={url}; Keep MiXeD text.\n"
                )
                if as_bytes:
                    message = message.encode()
                stderr = io.StringIO()
                with (
                    self.subTest(key=key, url=url, as_bytes=as_bytes),
                    patch.dict(os.environ, {
                        "FIRECRAWL_API_KEY": key, "FIRECRAWL_API_URL": url,
                    }, clear=True),
                    patch.object(sys, "stderr", stderr),
                ):
                    converter.diagnostic(message)
                    credential_marker = "[redacted URL]"
                    if key == "redacted":
                        # The exact stage still masks key text in the URL stage's marker.
                        credential_marker = "[[redacted] URL]"
                    self.assertEqual(stderr.getvalue(), (
                        f"anydoc: {credential_marker} key=[redacted]; endpoint=[redacted]; "
                        "repeated=[redacted]; Keep MiXeD text.\n"
                    ))

    def test_exact_environment_overlaps_preserve_success_and_blocked_endpoint(self):
        for key, url in EXACT_OVERLAPPING_ENV_VALUES:
            for as_bytes in (False, True):
                for local_code in (0, 3):
                    message = f"anydoc: key={key}; endpoint={url}; repeated={url}; Keep MiXeD text.\n"
                    if as_bytes:
                        message = message.encode()
                    with self.subTest(key=key, url=url, as_bytes=as_bytes, local_code=local_code):
                        code, stdout, stderr, calls = self.invoke(
                            results=[(local_code, MARKDOWN, message)],
                            environment={"FIRECRAWL_API_KEY": key, "FIRECRAWL_API_URL": url},
                        )
                        expected_stdout = MARKDOWN if local_code == 0 else b""
                        self.assertEqual((code, stdout, len(calls)), (local_code, expected_stdout, 1))
                        self.assertEqual(calls[0][0][3:5], ["--ocr", "reject"])
                        self.assertNotIn("FIRECRAWL_API_KEY", calls[0][2])
                        self.assertNotIn("FIRECRAWL_API_URL", calls[0][2])
                        expected_stderr = (
                            "anydoc: key=[redacted]; endpoint=[redacted]; repeated=[redacted]; Keep MiXeD text.\n"
                        )
                        if local_code == 3:
                            expected_stderr += (
                                "convert_document: OCR needed; configured endpoint is not the exact official URL; "
                                "separate approval/manual handling is required\n"
                            )
                        self.assertEqual(stderr, expected_stderr)

    def test_invalid_utf8_environment_overlaps_mask_before_decoding(self):
        for raw_key, raw_url in (
            (b"https", b"https://configured.invalid/private-\xff-path?other=\xfe-query"),
            (b"private-\xff", b"https://configured.invalid/private-\xff-path?other=\xfe-query"),
            (b"synthetic-\xff-key", b"https://configured.invalid/private-path?token=synthetic-\xff-key&other=\xfe-query"),
            (b"https://configured.invalid/private-\xff-path", b"https://configured.invalid/"),
        ):
            key, url = os.fsdecode(raw_key), os.fsdecode(raw_url)
            for as_bytes in (False, True):
                message = f"anydoc: key={key}; endpoint={url}; repeated={url}; keep=\ufffd.\n"
                if as_bytes:
                    message = (
                        b"anydoc: key=" + raw_key + b"; endpoint=" + raw_url
                        + b"; repeated=" + raw_url + b"; keep=\xfc.\n"
                    )
                stderr = io.StringIO()
                with (
                    self.subTest(raw_key=raw_key, raw_url=raw_url, as_bytes=as_bytes),
                    patch.dict(os.environ, {
                        "FIRECRAWL_API_KEY": key, "FIRECRAWL_API_URL": url,
                    }, clear=True),
                    patch.object(sys, "stderr", stderr),
                ):
                    converter.diagnostic(message)
                    self.assertEqual(stderr.getvalue(), (
                        "anydoc: key=[redacted]; endpoint=[redacted]; repeated=[redacted]; keep=\ufffd.\n"
                    ))

    def test_byte_exact_environment_masking_precedes_lossy_decoding(self):
        key = os.fsdecode(b"synthetic-\xff-key")
        url = os.fsdecode(b"synthetic-\xfe-endpoint")
        message = (
            b"anydoc: https://synthetic-\xff-user:synthetic-\xfe-password@custom.invalid/ "
            b"key=" + os.fsencode(key) + b" endpoint=" + os.fsencode(url) + b" keep=\xfc.\n"
        )
        stderr = io.StringIO()
        with (
            patch.dict(os.environ, {"FIRECRAWL_API_KEY": key, "FIRECRAWL_API_URL": url}, clear=True),
            patch.object(sys, "stderr", stderr),
        ):
            converter.diagnostic(message)
        self.assertEqual(stderr.getvalue(), (
            "anydoc: [redacted URL] key=[redacted] endpoint=[redacted] keep=\ufffd.\n"
        ))

    def test_empty_and_whitespace_environment_redaction_is_preserved(self):
        for key in ("", " \t"):
            for url in ("", " \t"):
                for as_bytes in (False, True):
                    message = (
                        "anydoc: https://synthetic-user:synthetic-password@custom.invalid/\n"
                        f"key={key}; endpoint={url}; Keep MiXeD text.\n"
                    )
                    expected = f"anydoc: [redacted URL]\nkey={key}; endpoint={url}; Keep MiXeD text.\n"
                    if key:
                        expected = expected.replace(key, "[redacted]")
                    if as_bytes:
                        message = message.encode()
                    stderr = io.StringIO()
                    with (
                        self.subTest(key=key, url=url, as_bytes=as_bytes),
                        patch.dict(os.environ, {
                            "FIRECRAWL_API_KEY": key, "FIRECRAWL_API_URL": url,
                        }, clear=True),
                        patch.object(sys, "stderr", stderr),
                    ):
                        converter.diagnostic(message)
                        self.assertEqual(stderr.getvalue(), expected)

    def test_exact_key_and_credential_url_redaction_on_both_attempts(self):
        error = (
            f"anydoc: {SYNTHETIC_KEY} https://user:password@custom.invalid/ "
            "HTTP://upper-user:upper-password@custom.invalid/ "
            "hTtPs://mixed-user:mixed-password@custom.invalid/ "
            f"{SYNTHETIC_KEY} {SYNTHETIC_KEY.upper()} Keep MiXeD text.\n"
        ).encode()
        for hosted_code in (1, 0):
            with self.subTest(hosted_code=hosted_code):
                code, stdout, stderr, calls = self.invoke(
                    results=[(3, b"", error), (hosted_code, MARKDOWN, error)],
                    environment={"FIRECRAWL_API_KEY": SYNTHETIC_KEY},
                )
                expected_stdout = MARKDOWN if hosted_code == 0 else b""
                self.assertEqual((code, stdout, len(calls)), (hosted_code, expected_stdout, 2))
                self.assertNotIn(SYNTHETIC_KEY, stderr)
                self.assertNotIn("user:", stderr)
                self.assertNotIn("password", stderr)
                self.assertEqual(stderr.count("[redacted]"), 4)
                self.assertEqual(stderr.count("[redacted URL]"), 6)
                self.assertEqual(stderr.count(SYNTHETIC_KEY.upper()), 2)
                self.assertEqual(stderr.count("Keep MiXeD text."), 2)

    def test_subprocess_argv_environment_and_process_group_timeout(self):
        process = Mock()
        process.communicate.return_value = (MARKDOWN, b"warning")
        process.returncode = 0
        with patch.object(converter.subprocess, "Popen", return_value=process) as popen:
            self.assertEqual(converter.run_anydoc(["npx", "arg with spaces"], b"bytes", {}, 120), (0, MARKDOWN, b"warning"))
            self.assertEqual(popen.call_args.args[0], ["npx", "arg with spaces"])
            self.assertNotIn("shell", popen.call_args.kwargs)
            self.assertEqual(popen.call_args.kwargs["env"], {})
            process.communicate.assert_called_once_with(input=b"bytes", timeout=120)
        process.communicate.side_effect = subprocess.TimeoutExpired(["npx"], 120)
        with patch.object(converter.subprocess, "Popen", return_value=process), patch.object(converter.os, "killpg") as killpg:
            with self.assertRaises(subprocess.TimeoutExpired):
                converter.run_anydoc(["npx"], b"bytes", {}, 120)
            if os.name == "posix":
                killpg.assert_called_once_with(process.pid, converter.signal.SIGKILL)
            process.wait.assert_called_once_with(timeout=5)
            process.stdout.close.assert_called_once()
            process.stderr.close.assert_called_once()

    def test_expected_output_io_and_unexpected_process_exit(self):
        with patch.object(converter, "write_output", side_effect=OSError("synthetic I/O failure")):
            code, stdout, stderr, _ = self.invoke([str(self.source), "-o", str(self.output)])
            self.assertEqual((code, stdout), (1, b""))
            self.assertIn("cannot write", stderr)
        code, stdout, stderr, calls = self.invoke(results=[(-9, b"", b"")])
        self.assertEqual((code, stdout, len(calls)), (1, b"", 1))
        self.assertIn("terminated unexpectedly", stderr)


@unittest.skipUnless(os.name == "posix", "sandbox npx uses a POSIX executable")
class StandaloneTests(unittest.TestCase):
    def setUp(self):
        self.sandbox = tempfile.TemporaryDirectory(prefix="anydoc-wrapper-cli-")
        self.root = Path(self.sandbox.name)
        self.log = self.root / "calls.jsonl"
        self.fake = self.root / "npx"
        self.fake.write_text("#!" + sys.executable + "\n" + '''import json
import os
from pathlib import Path
import sys
import time
args = sys.argv[1:]
mode = args[args.index("--ocr") + 1]
source = args[-1]
data = sys.stdin.buffer.read() if source == "-" else Path(source).read_bytes()
with open(os.environ["FAKE_LOG"], "a") as stream:
    stream.write(json.dumps({"argv": args, "bytes": data.hex(), "has_key": bool(os.environ.get("FIRECRAWL_API_KEY")), "has_url": "FIRECRAWL_API_URL" in os.environ}) + "\\n")
case = os.environ.get("FAKE_CASE", "local")
if case == "sleep":
    time.sleep(10)
if case == "ocr" and mode == "reject":
    sys.stderr.write("anydoc: synthetic PDF needs OCR\\n")
    raise SystemExit(3)
if case == "large":
    sys.stdout.buffer.write(b"x" * 1000000)
else:
    sys.stdout.buffer.write(b"# Synthetic standalone\\n")
''')
        self.fake.chmod(0o700)
        self.environment = {
            "PATH": str(self.root), "PYTHONDONTWRITEBYTECODE": "1",
            "FAKE_LOG": str(self.log),
        }

    def tearDown(self):
        self.assertFalse(self.root.is_symlink())
        # Remove links themselves, never their external interpreter targets.
        for path in self.root.rglob("*"):
            if path.is_symlink():
                path.unlink()
        self.sandbox.cleanup()

    def run_cli(self, args, data=None, environment=None):
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), *args], input=data,
            capture_output=True, env=environment or self.environment,
            cwd=self.root, timeout=15, check=False,
        )

    def records(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def check_uv_help(self, offline):
        uv = shutil.which("uv")
        if uv is None:
            self.skipTest("installed uv is required for launcher regressions")
        examples = (SCRIPT.parent.parent / "SKILL.md").read_text().splitlines()
        if offline:
            self.assertTrue(any(
                line.startswith("npm_config_offline=true uv run --no-project --offline python ")
                and line.endswith("--no-ocr") for line in examples
            ))
        else:
            normal_examples = [line for line in examples if line.startswith("uv run ")]
            self.assertTrue(normal_examples)
            for line in normal_examples:
                self.assertTrue(line.startswith("uv run --no-project python "), line)
        for existing in (False, True):
            with self.subTest(offline=offline, existing=existing):
                project = self.root / f"caller-{existing}"
                nested = project / "nested" / "working-directory"
                nested.mkdir(parents=True)
                (project / "pyproject.toml").write_text(
                    '[project]\nname = "synthetic-caller"\nversion = "0.0.0"\n'
                    'requires-python = ">=3.9"\n'
                    'dependencies = ["anydoc-synthetic-unresolvable-dependency==0.0.0"]\n'
                )
                if existing:
                    (project / "uv.lock").write_bytes(b"synthetic existing lock marker\n")
                    venv = project / ".venv"
                    (venv / "bin").mkdir(parents=True)
                    (venv / "marker").write_bytes(b"synthetic existing venv marker\n")
                    (venv / "bin" / "python").symlink_to(sys.executable)

                def snapshot(project=project):
                    entries = []
                    for path in (project, *sorted(project.rglob("*"))):
                        info = path.lstat()
                        content = None
                        if path.is_symlink():
                            content = os.readlink(path)
                        elif path.is_file():
                            content = path.read_bytes()
                        entries.append((
                            str(path.relative_to(project)), info.st_mode, info.st_ino,
                            info.st_size, info.st_mtime_ns, content,
                        ))
                    return entries

                before = snapshot()
                interpreter = Path(sys.executable).stat()
                environment = dict(
                    self.environment, HOME=str(self.root), UV_PYTHON=sys.executable,
                    UV_PYTHON_DOWNLOADS="never", UV_OFFLINE="true",
                    UV_CACHE_DIR=str(self.root / "uv-cache"), npm_config_offline="true",
                )
                command = [uv, "run", "--no-project"]
                if offline:
                    command.append("--offline")
                command += ["python", "-B", str(SCRIPT), "--help"]
                if offline:
                    command.append("--no-ocr")
                result = subprocess.run(
                    command, capture_output=True, env=environment,
                    cwd=nested, timeout=15, check=False,
                )
                self.assertEqual((result.returncode, result.stderr), (0, b""))
                self.assertIn(b"Convert one document locally", result.stdout)
                self.assertEqual(snapshot(), before)
                self.assertEqual(Path(sys.executable).stat(), interpreter)
                self.assertFalse(self.log.exists())

    def test_uv_no_project_help_preserves_caller_project(self):
        self.check_uv_help(offline=False)

    def test_uv_no_project_offline_help_preserves_caller_project(self):
        self.check_uv_help(offline=True)

    def test_standalone_stdin_replay_and_hosted_file_output(self):
        data = b"%PDF-synthetic\x00\xff\r\n"
        output = self.root / "standalone.md"
        environment = dict(self.environment, FAKE_CASE="ocr", FIRECRAWL_API_KEY=SYNTHETIC_KEY, FIRECRAWL_API_URL=converter.OFFICIAL_URL + "/")
        result = self.run_cli(["-", "-f", "pdf", "-o", str(output)], data, environment)
        self.assertEqual((result.returncode, result.stdout), (0, b""))
        self.assertEqual(output.read_bytes(), b"# Synthetic standalone\n")
        self.assertIn(b"hosted OCR used; result exit 0", result.stderr)
        records = self.records()
        self.assertEqual(len(records), 2)
        self.assertEqual([r["bytes"] for r in records], [data.hex(), data.hex()])
        self.assertEqual([r["has_key"] for r in records], [False, True])
        self.assertEqual([r["has_url"] for r in records], [False, False])
        self.assertIn(converter.OFFICIAL_URL, records[1]["argv"])
        self.assertNotIn(SYNTHETIC_KEY, self.log.read_text())

    def test_standalone_local_filename_with_leading_hyphen(self):
        source = self.root / "--document with spaces.csv"
        source.write_bytes(b"a,b\n1,2\n")
        result = self.run_cli(["--", source.name])
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b"# Synthetic standalone\n", b""))
        self.assertEqual(self.records()[0]["argv"][-2:], ["--", str(source)])
        self.assertEqual(source.read_bytes(), b"a,b\n1,2\n")

    def test_redirected_stdin_cannot_replace_original_or_aliases(self):
        source = self.root / "redirected.csv"
        original = b"a,b\n1,2\n"
        source.write_bytes(original)
        alias = self.root / "alias.csv"
        os.link(source, alias)
        for output in (source, alias):
            with self.subTest(output=output), source.open("rb") as stdin:
                result = subprocess.run(
                    [sys.executable, "-B", str(SCRIPT), "-", "-f", "csv", "-o", str(output), "--overwrite"],
                    stdin=stdin, capture_output=True, env=self.environment,
                    cwd=self.root, timeout=15, check=False,
                )
                self.assertEqual((result.returncode, result.stdout), (1, b""))
                self.assertIn(b"aliases redirected stdin", result.stderr)
                self.assertEqual(source.read_bytes(), original)
                self.assertFalse(self.log.exists())

    def test_standalone_missing_npx(self):
        result = self.run_cli(["-", "--format", "csv"], b"a,b\n", dict(self.environment, PATH=str(self.root / "missing-bin")))
        self.assertEqual((result.returncode, result.stdout), (1, b""))
        self.assertIn(b"cannot launch", result.stderr)
        self.assertNotIn(b"Traceback", result.stderr)
        self.assertFalse(self.log.exists())

    def test_real_subprocess_timeout_is_bounded(self):
        stdin = io.TextIOWrapper(io.BytesIO(b"a,b\n"))
        with (
            patch.dict(os.environ, dict(self.environment, FAKE_CASE="sleep"), clear=True),
            patch.object(converter, "LOCAL_TIMEOUT", 0.1),
            patch.object(sys, "stdin", stdin),
            patch.object(sys, "stderr", io.StringIO()) as stderr,
        ):
            self.assertEqual(converter.main(["-", "--no-ocr"]), 1)
            self.assertIn("timed out", stderr.getvalue())

    def test_closed_downstream_pipe_is_not_failure(self):
        process = subprocess.Popen(
            [sys.executable, "-B", str(SCRIPT), "-", "--no-ocr"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=dict(self.environment, FAKE_CASE="large"), cwd=self.root,
        )
        process.stdout.close()
        process.stdin.write(b"a,b\n")
        process.stdin.close()
        self.assertEqual(process.wait(timeout=15), 0)
        self.assertNotIn(b"Traceback", process.stderr.read())
        process.stderr.close()


if __name__ == "__main__":
    unittest.main()
