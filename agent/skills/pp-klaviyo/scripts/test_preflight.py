import os
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path


PREFLIGHT = Path(__file__).with_name("preflight.sh")
SHOW_ARGS = "client show klaviyo --json --select sources.klaviyo"
MISSING = 'client profile "klaviyo" bound to env:KLAVIYO_API_KEY is missing'


def selected(*fields):
    # The JSON `client show --select sources.klaviyo` prints: one key per line.
    body = ",\n".join(f"      {field}" for field in fields)
    return '{\n  "sources": {\n    "klaviyo": {\n' + body + "\n    }\n  }\n}"


REF = '"credential_ref": "env:KLAVIYO_API_KEY"'
ACCOUNT = '"expected_account_id": "ABC123"'
ORG = '"expected_org_name": "Fixture"'
# Fake `client show` results. None means the CLI rejects the profile.
SHOW = {
    "env": selected(REF, ACCOUNT, ORG),
    "op": selected('"credential_ref": "op://Vault/Klaviyo/key"', ACCOUNT, ORG),
    # The reference exists only outside [sources.klaviyo], so nothing is selected.
    "unselected": "{}",
    "missing": None,
    # Any extra setting can change the key the CLI uses, so only the three known keys pass.
    "additional credential": selected(
        REF, '"additional_credential_refs": {\n        "credential": "env:OTHER_KEY"\n      }', ACCOUNT, ORG
    ),
    "username reference": selected(REF, '"username_ref": "env:OTHER_USER"', ACCOUNT, ORG),
    "missing identity": selected(REF, ACCOUNT),
    "duplicate reference": selected(REF, REF, ACCOUNT, ORG),
}


def run_preflight(home, bin_dir, variables):
    # No inherited credentials, real user configuration, or PATH tools.
    return subprocess.run(
        ["/bin/sh", str(PREFLIGHT)],
        env={"HOME": str(home), "PATH": str(bin_dir), **variables},
        capture_output=True,
        text=True,
        timeout=30,
    )


class PreflightTests(unittest.TestCase):
    def test_isolated_branches(self):
        key = {"KLAVIYO_API_KEY": "<api-key>"}
        cases = [
            ("missing CLI", False, {}, 1, "klaviyo-pp-cli is not on PATH."),
            ("missing key", True, {}, 1, "KLAVIYO_API_KEY is missing."),
            ("empty key", True, {"KLAVIYO_API_KEY": ""}, 1, "KLAVIYO_API_KEY is missing."),
            (
                "base URL set",
                True,
                {**key, "KLAVIYO_BASE_URL": "https://example.invalid"},
                1,
                "KLAVIYO_BASE_URL must be unset",
            ),
            ("base URL empty", True, {**key, "KLAVIYO_BASE_URL": ""}, 1, "KLAVIYO_BASE_URL must be unset"),
            (
                "other client profile selected",
                True,
                {**key, "PRINTING_PRESS_CLIENT_PROFILE": "posthog"},
                1,
                "selects a different client profile",
            ),
            *[
                (f"profile {kind}", True, {**key, "FAKE_SHOW": kind}, 1, MISSING)
                for kind in (
                    "missing",
                    "op",
                    "unselected",
                    "additional credential",
                    "username reference",
                    "missing identity",
                    "duplicate reference",
                )
            ],
            ("ready", True, key, 0, "KLAVIYO_API_KEY is set"),
            (
                "ready with matching selector",
                True,
                {**key, "PRINTING_PRESS_CLIENT_PROFILE": "klaviyo"},
                0,
                "Client profile: klaviyo",
            ),
            ("version fails", True, {**key, "FAKE_VERSION_STATUS": "7"}, 7, ""),
        ]
        for name, has_cli, variables, status, message in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bin_dir = root / "bin"
                bin_dir.mkdir()
                marker = root / "invoked"
                if has_cli:
                    show = SHOW[variables.pop("FAKE_SHOW", "env")]
                    if show is None:
                        show_body = "printf '%s\\n' 'Error: profile not found' >&2\nexit 1\n"
                    else:
                        show_body = f"printf '%s\\n' {shlex.quote(show)}\n"
                    fake_cli = bin_dir / "klaviyo-pp-cli"
                    # Answer only the two invocations preflight is allowed to make.
                    fake_cli.write_text(
                        "#!/bin/sh\n"
                        'if [ "$#" -eq 1 ] && [ "$1" = --version ]; then\n'
                        '  printf invoked > "$HOME/invoked"\n'
                        '  [ "${FAKE_VERSION_STATUS:-0}" = 0 ] || exit "$FAKE_VERSION_STATUS"\n'
                        "  printf 'klaviyo-pp-cli fake-version\\n'\n"
                        "  exit 0\n"
                        "fi\n"
                        f'[ "$*" = {shlex.quote(SHOW_ARGS)} ] || exit 99\n' + show_body
                    )
                    fake_cli.chmod(0o700)
                result = run_preflight(root, bin_dir, variables)
                self.assertEqual(result.returncode, status)
                output = result.stdout + result.stderr
                self.assertIn(message, output)
                self.assertNotIn("<api-key>", output)
                self.assertNotIn("https://example.invalid", output)
                self.assertEqual(marker.exists(), name.startswith("ready") or name == "version fails")
                if name.startswith("ready"):
                    self.assertIn("CLI version: klaviyo-pp-cli fake-version", result.stdout)
                else:
                    self.assertNotIn("KLAVIYO_API_KEY is set", output)

    @unittest.skipUnless(os.environ.get("PP_KLAVIYO_TEST_CLI"), "set PP_KLAVIYO_TEST_CLI to a real klaviyo-pp-cli")
    def test_real_cli_parses_profiles(self):
        # Offline: `client show` reads only the synthetic profile and never the key.
        cli = Path(os.environ["PP_KLAVIYO_TEST_CLI"]).resolve()
        header = "schema_version = 1\nname = 'klaviyo'\n\n[sources]\n"
        identity = "expected_account_id = 'ABC123'\nexpected_org_name = 'Fixture'\n"
        profiles = {
            "written by client add": (header + "[sources.klaviyo]\ncredential_ref = 'env:KLAVIYO_API_KEY'\n" + identity, 0),
            "double-quoted": (header + '[sources.klaviyo]\ncredential_ref = "env:KLAVIYO_API_KEY"\n' + identity, 0),
            "comment on table header": (
                header + "[sources.klaviyo] # note\ncredential_ref = 'env:KLAVIYO_API_KEY'\n" + identity,
                0,
            ),
            "other reference": (header + "[sources.klaviyo]\ncredential_ref = 'op://Vault/Klaviyo/key'\n" + identity, 1),
            "reference only in another table": (
                header
                + "[sources.posthog]\ncredential_ref = 'env:KLAVIYO_API_KEY'\n"
                + "[sources.klaviyo]\ncredential_ref = 'op://Vault/Klaviyo/key'\n"
                + identity,
                1,
            ),
            "reference only inside a multiline string": (
                "schema_version = 1\nname = 'klaviyo'\nnote = '''\n[sources.klaviyo]\n"
                "credential_ref = 'env:KLAVIYO_API_KEY'\n'''\n\n[sources]\n[sources.klaviyo]\n"
                "credential_ref = 'op://Vault/Klaviyo/key'\n" + identity,
                1,
            ),
            # An additional credential named "credential" replaces the primary key.
            "additional credential": (
                header
                + "[sources.klaviyo]\ncredential_ref = 'env:KLAVIYO_API_KEY'\n"
                + identity
                + "\n[sources.klaviyo.additional_credential_refs]\ncredential = 'env:OTHER_KEY'\n",
                1,
            ),
            "base URL override": (
                header
                + "[sources.klaviyo]\ncredential_ref = 'env:KLAVIYO_API_KEY'\n"
                + identity
                + "expected_base_url = 'https://example.invalid'\n",
                1,
            ),
            # The Klaviyo table has no reference; only the string text looks like one.
            "multiline string and no real reference": (
                "schema_version = 1\nname = 'klaviyo'\nnote = '''\n[sources.klaviyo]\n"
                "credential_ref = 'env:KLAVIYO_API_KEY'\n'''\n\n[sources]\n[sources.klaviyo]\n" + identity,
                1,
            ),
        }
        for name, (body, status) in profiles.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bin_dir = root / "bin"
                bin_dir.mkdir()
                (bin_dir / "klaviyo-pp-cli").symlink_to(cli)
                profile_dir = root / ".config" / "printing-press" / "clients" / "klaviyo"
                profile_dir.mkdir(parents=True)
                # The CLI refuses profiles that other users can read.
                for directory_path in (profile_dir, profile_dir.parent, profile_dir.parent.parent):
                    directory_path.chmod(0o700)
                (profile_dir / "profile.toml").write_text(body)
                (profile_dir / "profile.toml").chmod(0o600)
                result = run_preflight(root, bin_dir, {"KLAVIYO_API_KEY": "<api-key>"})
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertNotIn("<api-key>", result.stdout + result.stderr)
                if status:
                    self.assertIn(MISSING, result.stderr)


if __name__ == "__main__":
    unittest.main()
