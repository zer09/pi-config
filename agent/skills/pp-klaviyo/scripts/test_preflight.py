import subprocess
import tempfile
import unittest
from pathlib import Path


PREFLIGHT = Path(__file__).with_name("preflight.sh")


class PreflightTests(unittest.TestCase):
    def test_isolated_branches(self):
        cases = [
            ("missing CLI", False, {}, 1, "klaviyo-pp-cli is not on PATH."),
            ("missing key", True, {}, 1, "KLAVIYO_API_KEY is missing."),
            ("empty key", True, {"KLAVIYO_API_KEY": ""}, 1, "KLAVIYO_API_KEY is missing."),
            (
                "base URL set",
                True,
                {"KLAVIYO_API_KEY": "<api-key>", "KLAVIYO_BASE_URL": "https://example.invalid"},
                1,
                "KLAVIYO_BASE_URL must be unset",
            ),
            (
                "base URL empty",
                True,
                {"KLAVIYO_API_KEY": "<api-key>", "KLAVIYO_BASE_URL": ""},
                1,
                "KLAVIYO_BASE_URL must be unset",
            ),
            ("ready", True, {"KLAVIYO_API_KEY": "<api-key>"}, 0, "KLAVIYO_API_KEY is set"),
            (
                "version fails",
                True,
                {"KLAVIYO_API_KEY": "<api-key>", "FAKE_VERSION_STATUS": "7"},
                7,
                "",
            ),
        ]
        for name, has_cli, variables, status, message in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bin_dir = root / "bin"
                bin_dir.mkdir()
                marker = root / "invoked"
                if has_cli:
                    fake_cli = bin_dir / "klaviyo-pp-cli"
                    fake_cli.write_text(
                        '#!/bin/sh\n'
                        '[ "$#" -eq 1 ] && [ "$1" = --version ] || exit 99\n'
                        'printf invoked > "$HOME/invoked"\n'
                        '[ "${FAKE_VERSION_STATUS:-0}" = 0 ] || exit "$FAKE_VERSION_STATUS"\n'
                        "printf 'klaviyo-pp-cli fake-version\\n'\n"
                    )
                    fake_cli.chmod(0o700)
                # No inherited credentials, real binary, or user configuration.
                env = {"HOME": directory, "PATH": str(bin_dir), **variables}
                result = subprocess.run(
                    ["/bin/sh", str(PREFLIGHT)],
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                self.assertEqual(result.returncode, status)
                output = result.stdout + result.stderr
                self.assertIn(message, output)
                self.assertNotIn("<api-key>", output)
                self.assertNotIn("https://example.invalid", output)
                self.assertEqual(marker.exists(), name in {"ready", "version fails"})
                if name == "ready":
                    self.assertIn("CLI version: klaviyo-pp-cli fake-version", result.stdout)
                else:
                    self.assertNotIn("KLAVIYO_API_KEY is set", output)


if __name__ == "__main__":
    unittest.main()
