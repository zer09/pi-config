"""Offline basics contracts. Read package source and previously isolated help only."""

import argparse
import json
import re
import shlex
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SKILL = REPO / "agent/skills/firebase-basics"
PACKAGE = None
HELP = None


def adjacent_gate_errors(text):
    gates = {
        "projects:create": ("explicit authorization", "exact", "project", "target"),
        "apps:create": ("explicit authorization", "exact", "app", "project", "target"),
    }
    errors = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if not line.startswith("firebase "):
            continue
        for command, terms in gates.items():
            if command in line:
                context = "\n".join(lines[max(0, index - 6):index]).lower()
                if not all(term in context for term in terms):
                    errors.append(command)
    return errors


class FirebaseBasicsContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = (SKILL / "SKILL.md").read_text()
        cls.refs = {p.stem: p.read_text() for p in (SKILL / "references").glob("*.md")}

    def test_package_identity_runtime_and_lifecycle(self):
        package = json.loads((PACKAGE / "package.json").read_text())
        self.assertEqual(package["name"], "firebase-tools")
        self.assertEqual(package["version"], "15.32.0")
        self.assertEqual(package["bin"], {"firebase": "./lib/bin/firebase.js"})
        self.assertEqual(package["engines"]["node"], ">=20.0.0 || >=22.0.0 || >=24.0.0")
        self.assertFalse(package.get("scripts"))

    def test_grouped_help_and_leaf_syntax(self):
        guide = self.refs["firebase-cli-guide"]
        progressive = (PACKAGE / "lib/bin/progressiveHelp.js").read_text()
        self.assertIn('!name.includes(":")', progressive)
        self.assertIn('name.startsWith(prefix + ":")', progressive)
        for example in ("firebase --help", "firebase apps --help", "firebase apps:sdkconfig --help"):
            self.assertIn(example, guide)
        for filename, expected in {
            "root.txt": ("--project <alias_or_project_id>", "apps", "projects"),
            "apps.txt": ("apps:sdkconfig", "apps:create", "apps:list"),
            "apps_sdkconfig.txt": ("[platform] [appId]", "--out [file]"),
            "apps_create.txt": ("--package-name <packageName>", "--bundle-id <bundleId>"),
            "projects_create.txt": ("--display-name <displayName>",),
            "login.txt": ("--no-localhost",),
        }.items():
            with self.subTest(help=filename):
                text = (HELP / filename).read_text()
                self.assertIn("Usage:", text)
                for term in expected:
                    self.assertIn(term, text)
        self.assertEqual((HELP / "version.txt").read_text().strip(), "15.32.0")

    def test_android_command_shapes_and_config_output(self):
        android = self.refs["android_setup"]
        commands = [shlex.split(line) for line in android.splitlines() if line.startswith("firebase ")]
        self.assertEqual(len(commands), 3)
        for tokens in commands:
            name = tokens[1]
            source = (PACKAGE / "lib/commands" / (name.replace(":", "-") + ".js")).read_text()
            declaration = re.search(r'new command_1.Command\("([^\"]+)"\)', source)
            self.assertIsNotNone(declaration)
            self.assertEqual(declaration.group(1).split()[0], name)
            flags = set(re.findall(r'--[a-z][a-z-]*', source)) | {"--project"}
            self.assertTrue({t for t in tokens if t.startswith("--")} <= flags)
        config = (PACKAGE / "lib/commands/apps-sdkconfig.js").read_text()
        self.assertIn("fs.writeFileSync(filename, fileInfo.fileContents)", config)
        self.assertIn("if (options.nonInteractive)", config)
        self.assertIn("already exists", config)
        self.assertIn("--out app/google-services.json", android)
        self.assertIn("Do not delete an existing config", android)

    def test_no_mandatory_live_state_or_automatic_cli_install(self):
        for name in ("local-env-setup", "android_setup", "ios_setup", "web_setup",
                     "firebase-service-init", "flutter_setup"):
            with self.subTest(reference=name):
                text = self.refs[name]
                for term in ("Dependency-only and existing-config tasks do not require",
                             "installed or repository-pinned", "ask before download/install",
                             "user request or agreement"):
                    self.assertIn(term, text)
                self.assertNotIn("firebase-tools@latest", text)
        for text in (self.root, self.refs["firebase-cli-guide"], self.refs["android_setup"],
                     self.refs["local-env-setup"]):
            self.assertIn("live account/project inspection", text)
        self.assertNotRegex(self.root, r"(?m)^firebase (login:list|projects:list|use)\s*$")
        self.assertNotIn("npx", self.refs["firebase-cli-guide"])
        self.assertIn("separately requested agent tooling changes", self.root)
        self.assertIn("Do not run its installers", self.refs["local-env-setup"])

    def test_adjacent_creation_gates_reject_ungated_examples(self):
        android = self.refs["android_setup"]
        self.assertFalse(adjacent_gate_errors(android))
        for command in ("projects:create <PROJECT_ID>", "apps:create ANDROID example"):
            self.assertTrue(adjacent_gate_errors(f"```bash\nfirebase {command}\n```"))
        self.assertIn("Service enablement needs separate explicit authorization", android)

    def test_android_reuse_plugin_pins_and_local_completion(self):
        android = self.refs["android_setup"]
        for term in ("applicationId", "variant-specific", "do not create a Firebase project",
                     "not the Firebase App ID", "Preserve a compatible pinned plugin version",
                     "version catalog", "apply false", "Local completion"):
            self.assertIn(term, android)
        self.assertEqual(android.count('id("com.google.gms.google-services")'), 2)
        self.assertIn("Do not deploy as validation", self.root)
        self.assertIn("not application user sign-in", self.root)
        self.assertIn("firebase-auth-basics", self.root)

    def test_help_startup_needs_isolation(self):
        cli = (PACKAGE / "lib/bin/cli.js").read_text()
        # Help parsing occurs after config, logging, and MOTD setup.
        self.assertLess(cli.index("useFileLogger)()"), cli.index("const hasHelpFlag"))
        self.assertLess(cli.index("fetchMOTD)()"), cli.index("const hasHelpFlag"))
        motd = (PACKAGE / "lib/fetchMOTD.js").read_text()
        self.assertLess(motd.index("if (process.env.CI)"), motd.index('c.get("/cli.json")'))
        notifier = (PACKAGE / "node_modules/update-notifier-cjs/index.js").read_text()
        self.assertIn("'NO_UPDATE_NOTIFIER' in process.env", notifier)
        self.assertIn("network/credential/config isolation", self.refs["firebase-cli-guide"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-dir", type=Path, required=True)
    parser.add_argument("--help-dir", type=Path, required=True)
    args, remaining = parser.parse_known_args()
    PACKAGE = args.package_dir.resolve(strict=True)
    HELP = args.help_dir.resolve(strict=True)
    unittest.main(argv=[__file__, *remaining])
