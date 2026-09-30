"""Offline Increment 8 regressions. Read source AST; never import the product.

Run with --source pointing to src/notebooklm_tools in the verified source tree.
Coverage is limited to share/export/slides/batch/pipeline/chat/chats examples,
chat registration/prose, runnable batch/pipeline safety, and download roots,
not the complete CLI or shell grammar.
"""

import argparse
import ast
import __future__
from pathlib import Path, PurePosixPath
import re
import shlex
import unittest
from unittest.mock import Mock

REPO = Path(__file__).resolve().parents[3]
SKILL = REPO / "agent/skills/nlm-skill"
SOURCE = None
FAMILIES = {"share", "export", "slides", "batch", "pipeline", "chat", "chats"}


def source_tree(relative):
    return ast.parse((SOURCE / relative).read_text())


def source_function(relative, name):
    return next(node for node in source_tree(relative).body
                if isinstance(node, ast.FunctionDef) and node.name == name)


def fake_function(relative, name, namespace):
    function = source_function(relative, name)
    function.decorator_list = []
    # No product imports, file access, or real clients are available to this body.
    namespace["__builtins__"] = {"Exception": Exception, "str": str}
    module = ast.Module(body=[function], type_ignores=[])
    exec(compile(module, relative, "exec", flags=__future__.annotations.compiler_flag), namespace)
    return namespace[name]


def schemas():
    result = {}
    for family in sorted(FAMILIES):
        module = "studio" if family == "slides" else family
        app = "slides_app" if family == "slides" else "app"
        if family == "chats":
            app = "chats_app"
        for function in source_tree(f"cli/commands/{module}.py").body:
            if not isinstance(function, ast.FunctionDef):
                continue
            for decorator in function.decorator_list:
                if not (isinstance(decorator, ast.Call)
                        and ast.unparse(decorator.func) == f"{app}.command"):
                    continue
                leaf = ast.literal_eval(decorator.args[0])
                positional, options, required = [], {}, set()
                for arg, default in zip(function.args.args, function.args.defaults):
                    kind = ast.unparse(default.func)
                    mandatory = isinstance(default.args[0], ast.Constant) and default.args[0].value is Ellipsis
                    if kind == "typer.Argument":
                        positional.append(mandatory)
                    elif kind == "typer.Option":
                        flags = [ast.literal_eval(value) for value in default.args[1:]]
                        for flag in flags:
                            options[flag] = (arg.arg, ast.unparse(arg.annotation) == "bool")
                        if mandatory:
                            required.add(arg.arg)
                    else:
                        raise AssertionError(f"Unsupported signature: {function.name}")
                result[(family, leaf)] = (positional, options, required)
    return result


def enum_values():
    constants = source_tree("core/constants.py")
    values = {}
    for option, name in (("format", "SLIDE_DECK_FORMATS"), ("length", "SLIDE_DECK_LENGTHS")):
        assignment = next(node for node in constants.body if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == name for target in node.targets))
        values[("slides", "create", option)] = {ast.literal_eval(key) for key in assignment.value.args[0].keys}
    export_type = next(node for node in source_tree("services/exports.py").body
                       if isinstance(node, ast.Assign) and ast.unparse(node.targets[0]) == "ExportType")
    values[("export", "artifact", "export_type")] = set(ast.literal_eval(export_type.value.slice))
    return values


def validate_cli(line, command_schemas, enums):
    template = "[OPTIONS]" in line
    tokens = shlex.split(line.replace("[OPTIONS]", "").replace("[", "").replace("]", ""), comments=True)
    if len(tokens) < 3 or tokens[0] != "nlm" or tuple(tokens[1:3]) not in command_schemas:
        raise ValueError("unknown leaf subcommand")
    family, leaf = tokens[1:3]
    if (family, leaf) in {("batch", "studio"), ("pipeline", "run")}:
        raise ValueError("unsafe runnable recipe: no granular confirmation gate")
    positional, options, required = command_schemas[(family, leaf)]
    seen, arguments = set(), []
    index = 3
    while index < len(tokens):
        token = tokens[index]
        if not token.startswith("-"):
            arguments.append(token)
            index += 1
            continue
        flag, equals, value = token.partition("=")
        if flag not in options:
            raise ValueError(f"unknown option {flag}")
        parameter, boolean = options[flag]
        seen.add(parameter)
        if boolean:
            if equals:
                raise ValueError(f"flag {flag} takes no value")
        else:
            if not equals:
                index += 1
                if index == len(tokens) or tokens[index].startswith("-"):
                    raise ValueError(f"missing value for {flag}")
                value = tokens[index]
            allowed = enums.get((family, leaf, parameter))
            placeholder = re.fullmatch(r"<[^>]+>", value)
            if family == "export" and parameter == "export_type":
                value = value.lower()
            if allowed and not placeholder and not set(value.split("|")) <= allowed:
                raise ValueError(f"unknown enum value {value} for {flag}")
        index += 1
    if not sum(positional) <= len(arguments) <= len(positional):
        raise ValueError("wrong number of positional arguments")
    if not template and not required <= seen:
        raise ValueError("missing required option")
    if not template and (family == "slides" or (family, leaf) == ("batch", "delete")) and "confirm" not in seen:
        raise ValueError("missing confirmation flag")


def fenced_blocks(text):
    return re.finditer(r"^```[^\n]*\n(.*?)^```", text, re.M | re.S)


def document_errors(text, command_schemas, enums):
    errors = []
    # Alias claims in prose must agree with registration, not just fenced examples.
    for match in re.finditer(r"\bnlm\s+(chat|chats)\s+([a-z][a-z-]*)\b", text):
        if match.groups() not in command_schemas:
            number = text[:match.start()].count("\n") + 1
            errors.append(f"line {number}: unknown leaf subcommand {match.group(0)}")
    for block in fenced_blocks(text):
        for offset, line in enumerate(block.group(1).splitlines()):
            if re.match(r"\s*nlm\s+(?:share|export|slides|batch|pipeline|chat|chats)\b", line):
                try:
                    validate_cli(line, command_schemas, enums)
                except ValueError as error:
                    number = text[:block.start(1)].count("\n") + offset + 1
                    errors.append(f"line {number}: {error}")
        if re.search(r"\bbatch\s*\([^)]*\baction\s*=\s*['\"]studio['\"]|\bpipeline\s*\([^)]*\baction\s*=\s*['\"]run['\"]", block.group(1), re.S):
            errors.append("unsafe runnable MCP batch/pipeline recipe")
    return errors


class CommandContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command_schemas = schemas()
        cls.enums = enum_values()

    def test_documented_commands(self):
        errors = []
        for path in sorted(SKILL.rglob("*.md")):
            errors.extend(f"{path.relative_to(SKILL)}:{error}" for error in
                          document_errors(path.read_text(), self.command_schemas, self.enums))
        self.assertFalse(errors, "\n".join(errors))

    def test_chat_registration_and_canonical_list(self):
        main = source_tree("cli/main.py")
        imports = {alias.asname or alias.name: (node.module, alias.name)
                   for node in main.body if isinstance(node, ast.ImportFrom)
                   for alias in node.names}
        registrations = {ast.literal_eval(keyword.value): ast.unparse(node.args[0])
                         for node in ast.walk(main) if isinstance(node, ast.Call)
                         and ast.unparse(node.func) == "app.add_typer"
                         for keyword in node.keywords if keyword.arg == "name"}
        self.assertEqual(registrations["chat"], "chat_app")
        self.assertEqual(registrations["chats"], "chats_app")
        self.assertEqual(imports["chat_app"], ("notebooklm_tools.cli.commands.chat", "app"))
        self.assertEqual(imports["chats_app"], ("notebooklm_tools.cli.commands.chats", "chats_app"))
        self.assertEqual({leaf for family, leaf in self.command_schemas if family == "chat"},
                         {"configure", "start"})
        self.assertIn(("chats", "list"), self.command_schemas)
        reference = (SKILL / "references/command_reference.md").read_text()
        self.assertIn("### nlm chats list", reference)
        self.assertIn("nlm chats list <notebook-id> [OPTIONS]", reference)

    def test_reject_chat_list_in_prose_and_examples(self):
        examples = [
            "List chat sessions for a notebook (alias: `nlm chat list`).",
            "Use nlm chat list to list sessions.",
            "```bash\nnlm chat list nb\n```",
        ]
        for example in examples:
            with self.subTest(example=example):
                errors = document_errors(example, self.command_schemas, self.enums)
                self.assertTrue(any("unknown leaf subcommand nlm chat list" in error for error in errors))
        for command in ("nlm chat configure", "nlm chat start", "nlm chats list"):
            with self.subTest(command=command):
                self.assertFalse(document_errors(f"Use `{command}`.", self.command_schemas, self.enums))

    def test_download_root_precedence_with_fake_paths(self):
        class FakePath(PurePosixPath):
            def expanduser(self):
                if str(self).startswith("~/"):
                    return home / str(self)[2:]
                return self

            def is_dir(self):
                return self == home / "Downloads" and downloads_kind == "directory"

        # Pure paths and a private mapping keep this resolver away from user state.
        home = FakePath("/fake-home")
        storage = FakePath("/fake-storage")
        for configured, expanded in ((None, None), ("", None), (" \t", None),
                                     ("  ~/exports \t", home / "exports"),
                                     (" /configured-downloads ", FakePath("/configured-downloads"))):
            for downloads_kind in ("directory", "missing", "file"):
                with self.subTest(configured=configured, downloads=downloads_kind):
                    environment = {}
                    if configured is not None:
                        environment["NOTEBOOKLM_DOWNLOAD_DIR"] = configured
                    get_home, get_storage = Mock(return_value=home), Mock(return_value=storage)
                    resolver = fake_function("services/downloads.py", "resolve_download_root", {
                        "Path": FakePath, "os": Mock(environ=environment),
                        "get_home_dir": get_home, "get_storage_dir": get_storage,
                    })
                    actual = resolver()
                    if expanded is not None:
                        self.assertEqual(actual, expanded)
                        get_home.assert_not_called()
                        get_storage.assert_not_called()
                    else:
                        get_home.assert_called_once_with()
                        if downloads_kind == "directory":
                            self.assertEqual(actual, home / "Downloads/gemini-notebook")
                            get_storage.assert_not_called()
                        else:
                            self.assertEqual(actual, storage / "downloads")
                            get_storage.assert_called_once_with()

    def test_download_root_documentation(self):
        for name in ("command_reference", "remote-mcp", "troubleshooting"):
            with self.subTest(reference=name):
                text = (SKILL / f"references/{name}.md").read_text()
                self.assertTrue("The root uses `NOTEBOOKLM_DOWNLOAD_DIR` after stripping whitespace "
                                "and expanding `~` if the value is nonempty. Otherwise, it uses "
                                "`~/Downloads/gemini-notebook` only if `~/Downloads` is an existing "
                                "directory; if not, it uses the application storage directory's "
                                "`downloads` subdirectory." in text,
                                "Missing conditional download-root precedence")

    def test_valid_signatures_and_authorized_batch_syntax(self):
        examples = [
            "nlm chat configure nb --goal default -p work", "nlm chat start nb",
            "nlm chats list nb --limit 5 --json -p work",
            "nlm share public nb -p work", "nlm share private nb --profile work",
            "nlm share status nb --json -p work",
            "nlm export to-docs nb artifact", "nlm export to-sheets nb artifact",
            'nlm export to-docs nb artifact --title "My Report" --profile work',
            'nlm export to-sheets nb artifact --title "My Table" -p work',
            'nlm export artifact nb artifact -t docs --title "My Report" -j -p work',
            "nlm export artifact nb artifact --type sheets --json --profile work",
            "nlm export artifact nb artifact --type DOCS",
            "nlm slides create nb --format detailed_deck --confirm",
            "nlm slides create nb -f presenter_slides --length short -y",
            "nlm batch query Summary --notebooks nb1,nb2",
            "nlm batch add-source https://example.com --notebooks nb1,nb2",
            'nlm batch create "Project A, Project B"',
            "nlm batch delete --notebooks nb1,nb2 --confirm",
            "nlm pipeline list", "nlm pipeline create custom --file pipeline.yaml",
        ]
        for example in examples:
            with self.subTest(example=example):
                validate_cli(example, self.command_schemas, self.enums)

    def test_reject_invalid_leaf_options_enums_and_missing_arguments(self):
        examples = [
            ("nlm share public nb --off", "unknown option"),
            ("nlm share private nb --off", "unknown option"),
            ("nlm export docs nb artifact", "unknown leaf"),
            ("nlm export sheets nb artifact", "unknown leaf"),
            ("nlm export to-docs nb artifact --json", "unknown option"),
            ("nlm export to-sheets nb artifact --bogus", "unknown option"),
            ("nlm export to-docs nb", "positional arguments"),
            ("nlm export artifact nb artifact", "required option"),
            ("nlm export artifact nb artifact --type pdf", "unknown enum"),
            ("nlm export artifact nb artifact --type PDF", "unknown enum"),
            ("nlm slides create nb --format detailed --confirm", "unknown enum"),
            ("nlm slides create nb --length long --confirm", "unknown enum"),
            ("nlm slides create nb --format detailed_deck", "confirmation"),
        ]
        for example, error in examples:
            with self.subTest(example=example), self.assertRaisesRegex(ValueError, error):
                validate_cli(example, self.command_schemas, self.enums)

    def test_reject_unsafe_recipes_even_with_invented_confirmation(self):
        examples = ["nlm batch studio audio --tags research"]
        examples += [f"nlm pipeline run {name} --notebook nb" for name in
                     ("ingest-and-podcast", "research-and-report", "multi-format")]
        examples += [example + " --confirm" for example in examples]
        examples += ['batch(action="studio", confirm=True)', 'pipeline(action="run", pipeline_name="multi-format")']
        for example in examples:
            with self.subTest(example=example):
                self.assertTrue(document_errors(f"```\n{example}\n```", self.command_schemas, self.enums))

    def test_presentation_workflow_keeps_confirmation(self):
        workflow = (SKILL / "references/workflows.md").read_text()
        self.assertTrue("nlm slides create pres --format detailed_deck --confirm" in workflow,
                        "Presentation recipe must use detailed_deck and --confirm")

    def test_export_signatures_preserve_optional_title_and_aliases(self):
        reference = (SKILL / "references/command_reference.md").read_text()
        for leaf in ("to-docs", "to-sheets"):
            signature = f"nlm export {leaf} NOTEBOOK ARTIFACT_ID [--title TITLE] [--profile PROFILE]"
            self.assertTrue(signature in reference, f"Missing complete {leaf} signature")
        signature = "nlm export artifact NOTEBOOK ARTIFACT_ID --type docs|sheets [--title TITLE] [--json] [--profile PROFILE]"
        self.assertTrue(signature in reference, "Missing complete artifact export signature")
        for alias in ("-p PROFILE", "-t docs", "`-j`"):
            self.assertTrue(alias in reference, f"Missing export option alias: {alias}")
        workflow = (SKILL / "references/workflows.md").read_text()
        for example in ('nlm export to-sheets <notebook-id> <artifact-id> --title "Extracted Data"',
                        'nlm export to-docs <notebook-id> <artifact-id> --title "My Report"'):
            self.assertTrue(example in workflow, "Export workflow must preserve optional titles")

    def test_cli_batch_and_pipeline_have_no_confirm_option(self):
        for command in (("batch", "studio"), ("pipeline", "run")):
            self.assertNotIn("--confirm", self.command_schemas[command][1])

    def test_mcp_batch_studio_ignores_both_confirmation_values(self):
        service = Mock()
        service.batch_studio.return_value = {}
        batch = fake_function("mcp/tools/batch.py", "batch", {
            "get_client": lambda: "fake-client", "batch_service": service,
            "ServiceError": RuntimeError, "error_result": lambda message: {"error": message},
        })
        for confirm in (False, True):
            with self.subTest(confirm=confirm):
                service.reset_mock()
                self.assertEqual(batch(action="studio", notebook_names="nb", confirm=confirm)["status"], "success")
                service.batch_studio.assert_called_once_with("fake-client", "audio", ["nb"], None, False)
        service.reset_mock()
        self.assertEqual(batch(action="delete", notebook_names="nb")["status"], "error")
        service.batch_delete.assert_not_called()

    def test_direct_mcp_studio_stops_before_client_without_confirmation(self):
        client, service = Mock(), Mock()
        studio = fake_function("mcp/tools/studio.py", "studio_create", {
            "get_client": client, "studio_service": service,
            "coerce_list": lambda value: value, "ValidationError": ValueError,
        })
        result = studio(notebook_id="nb", artifact_type="audio", language="en")
        self.assertEqual(result["status"], "pending_confirmation")
        client.assert_not_called()
        service.create_artifact.assert_not_called()

    def test_pipeline_steps_call_mutations_without_granular_gates(self):
        studio, notebooks, sources = Mock(), Mock(), Mock()
        step = fake_function("services/pipeline.py", "_execute_step", {
            "studio_service": studio, "notebooks_service": notebooks, "sources_service": sources,
        })
        step("fake-client", "nb", "studio_create", {})
        studio.create_artifact.assert_called_once()
        self.assertNotIn("confirm", studio.create_artifact.call_args.kwargs)
        step("fake-client", "nb", "source_add", {"url": "https://example.com"})
        sources.add_source.assert_called_once()
        step("fake-client", "nb", "notebook_delete", {})
        notebooks.delete_notebook.assert_called_once_with("fake-client", "nb")
        pipeline = source_function("mcp/tools/pipeline.py", "pipeline")
        self.assertNotIn("confirm", [arg.arg for arg in pipeline.args.args])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()
    SOURCE = args.source
    unittest.main(argv=[__file__], verbosity=2)
