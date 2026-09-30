"""Offline skill contracts. Read package source; never import or run the CLI.

Pass --package-dir for the verified @playwright/cli installation. Shell and
JavaScript syntax checks use parsers only, not browsers or project test runners.
These checks do not establish browser behavior or model compliance.
"""

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SKILL = REPO / "agent/skills/playwright-cli"
PACKAGE = None
VERSION = "1.64.0-alpha-1790635538000"


def shell_commands(block):
    pending = ""
    for line in block.splitlines():
        pending += line + "\n"
        try:
            tokens = shlex.split(pending, comments=True)
        except ValueError:
            continue
        pending = ""
        if tokens:
            yield tokens
    if pending.strip():
        raise ValueError("Unclosed shell quotation")


def validate_command(tokens, commands):
    tokens = list(tokens)
    while tokens and "=" in tokens[0] and not tokens[0].startswith("-"):
        tokens.pop(0)
    if not tokens or tokens.pop(0) != "playwright-cli":
        raise ValueError("Not a CLI example")
    session = None
    if tokens and tokens[0].startswith("-s="):
        session = tokens.pop(0).split("=", 1)[1]
    if not tokens:
        raise ValueError("Missing command")
    command = tokens.pop(0)
    if command not in commands:
        raise ValueError("Unknown command")
    if command in {"install", "install-browser", "close-all", "kill-all", "delete-data", "show"}:
        raise ValueError("Unsafe runtime recipe")
    schema = commands[command]
    flags = {**schema["flags"], "session": "string", "raw": "boolean", "json": "boolean"}
    arguments = []
    while tokens:
        token = tokens.pop(0)
        if not token.startswith("--"):
            if token.startswith("-"):
                raise ValueError("Unsupported short flag")
            arguments.append(token)
            continue
        name, equals, value = token[2:].partition("=")
        if name not in flags:
            raise ValueError("Unknown flag")
        if name in {"cdp", "endpoint", "extension", "profile", "persistent"}:
            raise ValueError("User-profile or persistent runtime recipe")
        if flags[name] != "boolean" and not equals:
            if not tokens or tokens[0].startswith("-"):
                raise ValueError("Missing flag value")
            value = tokens.pop(0)
        if name == "session":
            session = value
    if session not in {"task-name", "task-test"}:
        raise ValueError("Missing task-specific session")
    if len(arguments) > len(schema["args"]):
        raise ValueError("Too many arguments")
    return command, arguments


class PlaywrightSkillContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.core = PACKAGE / "node_modules/playwright-core"
        cls.help = json.loads((cls.core / "lib/tools/cli-client/help.json").read_text())
        cls.docs = {p.name: p.read_text() for p in SKILL.rglob("*.md")}
        cls.blocks = [block for text in cls.docs.values()
                      for block in re.findall(r"```bash\n(.*?)```", text, re.DOTALL)]
        cls.examples = [tokens for block in cls.blocks for tokens in shell_commands(block)
                        if "playwright-cli" in tokens]

    def test_exact_package_and_dependency_versions(self):
        package = json.loads((PACKAGE / "package.json").read_text())
        self.assertEqual(package["name"], "@playwright/cli")
        self.assertEqual(package["version"], "0.1.22")
        self.assertEqual(package["dependencies"], {"playwright": VERSION, "playwright-core": VERSION})
        for name in ("playwright", "playwright-core"):
            dependency = json.loads((PACKAGE / "node_modules" / name / "package.json").read_text())
            self.assertEqual(dependency["version"], VERSION)
            self.assertFalse(dependency.get("scripts"))
        self.assertEqual(set(package.get("scripts", {})), {"test"})

    def test_documented_commands_and_task_scope(self):
        self.assertGreater(len(self.examples), 30)
        for tokens in self.examples:
            with self.subTest(command=tokens[:3]):
                validate_command(tokens, self.help["commands"])

    def test_find_file_output(self):
        example = 'find "Search" --filename=matches.md'
        self.assertIn(f"`{example}`", self.docs["sessions-and-snapshots.md"])
        validate_command(["playwright-cli", "-s=task-name", *shlex.split(example)], self.help["commands"])
        self.assertEqual(self.help["commands"]["find"]["flags"]["filename"], "string")

    def test_invalid_or_unsafe_examples_fail(self):
        for example in (
            "playwright-cli snapshot",
            "playwright-cli -s=task-name find Search --output=matches.md",
            "playwright-cli -s=task-name find Search --filename",
            "playwright-cli -s=task-name goto one two",
            "playwright-cli -s=task-name install --skills",
            "playwright-cli -s=task-name close-all",
            "playwright-cli attach --cdp=chrome --session=task-test",
        ):
            with self.subTest(example=example), self.assertRaises(ValueError):
                validate_command(shlex.split(example), self.help["commands"])

    def test_shell_and_function_expression_syntax(self):
        # Parser-only subprocesses cannot execute the documented browser actions.
        env = {"PATH": os.defpath}
        for block in self.blocks:
            result = subprocess.run([shutil.which("bash"), "--noprofile", "--norc", "-n"],
                                    input=block, text=True, capture_output=True, env=env, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
        snippets = 0
        for tokens in self.examples:
            command, arguments = validate_command(tokens, self.help["commands"])
            if command == "run-code" and arguments:
                result = subprocess.run([shutil.which("node"), "--check"],
                                        input=f"({arguments[0]});", text=True, capture_output=True, env=env, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                snippets += 1
        self.assertEqual(snippets, 2)

    def test_run_code_globals_match_source(self):
        source = (self.core / "lib/coreBundle.js").read_text()
        exposed = re.search(r"exposedGlobals = \[(.*?)\];", source, re.DOTALL)
        self.assertIsNotNone(exposed)
        names = set(re.findall(r'"([A-Za-z]+)"', exposed.group(1)))
        for name in ("fetch", "URL", "Buffer", "crypto", "AbortController", "TextEncoder", "TextDecoder"):
            self.assertIn(name, names)
            self.assertIn(f"`{name}`", self.docs["code-and-mocking.md"])
        self.assertTrue({"setTimeout", "setInterval"} <= names)
        self.assertFalse({"require", "process"} & names)
        self.assertIn('context[name] = globalThis[name]', source)
        self.assertIn('toolName: "browser_run_code_unsafe"', source)

    def test_help_and_version_exit_before_session_loading(self):
        source = (self.core / "lib/tools/cli-client/program.js").read_text()
        start = source.index("async function program(")
        load = source.index("await import_registry.Registry.load()", start)
        for marker in ("if (args.version || args.v)", "if (args.help || args.h || !commandName)"):
            branch = source.index(marker, start)
            self.assertLess(branch, source.index("process.exit(0)", branch))
            self.assertLess(source.index("process.exit(0)", branch), load)
        entry = (PACKAGE / "playwright-cli.js").read_text()
        check = entry.index("async function checkForUpdates()")
        guard = entry.index("if (process.env.NO_UPDATE_NOTIFIER || process.env.CI)", check)
        self.assertLess(entry.index("return;", guard), entry.index("const cache = readCache()", check))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-dir", type=Path, required=True)
    args, remaining = parser.parse_known_args()
    PACKAGE = args.package_dir.resolve(strict=True)
    unittest.main(argv=[__file__, *remaining])
