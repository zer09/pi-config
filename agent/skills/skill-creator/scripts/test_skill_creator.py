#!/usr/bin/env python3
"""Adversarial regression tests for the unified skill creator."""

from __future__ import annotations

import json
import os
import random
import shutil
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from aggregate_benchmark import (  # noqa: E402
    benchmark_output_paths,
    generate_benchmark,
    main as aggregate_main,
)
from eval_utils import (  # noqa: E402
    atomic_write_text,
    parse_pi_jsonl,
    run_bounded_process,
    validate_pi_args,
)
from generate_openai_yaml import (  # noqa: E402
    main as openai_yaml_main,
    write_openai_yaml,
)
from generate_review import (  # noqa: E402
    atomic_write_feedback,
    generate_html,
    load_workspace_runs,
    main as review_main,
    safe_output_files,
    scrub_blind_strings,
)
from quick_validate import validate_skill  # noqa: E402
from run_skill_evals import (  # noqa: E402
    configuration_order,
    forced_skill_context,
    normalize_assertions,
    prepare_workspace,
    resolve_inputs,
    run_one,
    validate_eval_set,
)
from run_trigger_evals import (  # noqa: E402
    aggregate as aggregate_triggers,
    counterbalanced_registry_orders,
    ensure_unique_skill_names,
    load_queries,
    validate_run_count,
)


def valid_events(text: str = "OK", stop_reason: str = "stop") -> str:
    message = {
        "role": "assistant",
        "content": [{"type": "text", "text": text}],
        "responseId": "response-1",
        "timestamp": 1,
        "usage": {
            "input": 10,
            "output": 2,
            "cacheRead": 3,
            "cacheWrite": 0,
            "totalTokens": 15,
        },
        "stopReason": stop_reason,
    }
    events = [
        {"type": "session", "version": 3},
        {"type": "agent_start"},
        {"type": "message_end", "message": message},
        {"type": "agent_end", "messages": [message], "willRetry": False},
        {"type": "agent_settled"},
    ]
    return "\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n"


class SkillCreatorTests(unittest.TestCase):
    def test_eval_ids_are_safe_and_unique(self) -> None:
        for invalid in ["false", 0, None]:
            with self.assertRaises(ValueError):
                normalize_assertions([{"text": "x", "critical": invalid}])
        with self.assertRaises(ValueError):
            normalize_assertions({"text": "x"})
        self.assertEqual(
            normalize_assertions([{"text": "x", "critical": False}]),
            [{"text": "x", "critical": False}],
        )
        base = {"prompt": "x", "name": "x", "files": [], "assertions": []}
        for bad in ["../x", "a/b", "/tmp/x", "a..b", True, -1, "x\n"]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_eval_set({"evals": [{"id": bad, **base}]})
        with self.assertRaises(ValueError):
            validate_eval_set({"evals": [{"id": 1, **base}, {"id": "1", **base}]})

    def test_workspace_overwrite_requires_owned_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            arbitrary = root / "arbitrary"
            arbitrary.mkdir()
            with self.assertRaises(ValueError):
                prepare_workspace(arbitrary, overwrite=True, protected=[])
            owned = root / "owned"
            prepare_workspace(owned, overwrite=False, protected=[])
            (owned / "old.txt").write_text("old")
            prepare_workspace(owned, overwrite=True, protected=[])
            self.assertFalse((owned / "old.txt").exists())
            with self.assertRaises(ValueError):
                prepare_workspace(Path.home(), overwrite=True, protected=[])
            if hasattr(os, "symlink"):
                link = root / "link"
                link.symlink_to(owned, target_is_directory=True)
                with self.assertRaises(ValueError):
                    prepare_workspace(link, overwrite=True, protected=[])
                with self.assertRaises(ValueError):
                    prepare_workspace(link / "nested", overwrite=False, protected=[])

    def test_fixtures_are_contained_regular_and_collision_free(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "a.txt").write_text("a")
            (root / "nested").mkdir()
            (root / "nested" / "a.txt").write_text("b")
            resolved = resolve_inputs(["a.txt", "nested/a.txt"], root)
            self.assertEqual(
                [item["destination_name"] for item in resolved],
                ["001-a.txt", "002-a.txt"],
            )
            for bad in ["../secret", str((root / "a.txt").resolve())]:
                with self.assertRaises(ValueError):
                    resolve_inputs([bad], root)
            if hasattr(os, "symlink"):
                (root / "link").symlink_to(root / "a.txt")
                with self.assertRaises(ValueError):
                    resolve_inputs(["link"], root)

    def test_strict_pi_jsonl_and_null_usage(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "events.jsonl"
            path.write_text(valid_events("line\u2028separator"))
            parsed = parse_pi_jsonl(path)
            self.assertTrue(parsed["valid"])
            self.assertEqual(parsed["final_response"], "line\u2028separator")
            self.assertEqual(parsed["usage"]["total_tokens"], 15)
            event_lines = valid_events().splitlines()
            event_lines.insert(3, event_lines[2])
            path.write_text("\n".join(event_lines) + "\n")
            self.assertEqual(parse_pi_jsonl(path)["usage"]["total_tokens"], 15)

            path.write_text(valid_events(stop_reason="error"))
            self.assertFalse(parse_pi_jsonl(path)["valid"])
            path.write_text(valid_events().rstrip("\n"))
            self.assertFalse(parse_pi_jsonl(path)["valid"])
            malformed_order = valid_events().splitlines()
            malformed_order[0], malformed_order[1] = (
                malformed_order[1],
                malformed_order[0],
            )
            path.write_text("\n".join(malformed_order) + "\n")
            self.assertFalse(parse_pi_jsonl(path)["valid"])
            trailing_start = valid_events().splitlines()
            trailing_start.append(json.dumps({"type": "agent_start"}))
            path.write_text("\n".join(trailing_start) + "\n")
            self.assertFalse(parse_pi_jsonl(path)["valid"])
            path.write_text('{"type":"session"}\nnot-json\n')
            self.assertFalse(parse_pi_jsonl(path)["valid"])

            message = {
                "role": "assistant",
                "content": [{"type": "text", "text": "OK"}],
                "responseId": "r",
                "stopReason": "stop",
            }
            path.write_text(
                "\n".join(
                    json.dumps(event)
                    for event in [
                        {"type": "session"},
                        {"type": "agent_start"},
                        {"type": "message_end", "message": message},
                        {"type": "agent_end", "messages": [message]},
                    ]
                )
            )
            self.assertIsNone(parse_pi_jsonl(path)["usage"]["total_tokens"])

    def test_process_output_limit_and_process_group_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            result = run_bounded_process(
                [sys.executable, "-c", "print('x' * 200000)"],
                cwd=root,
                stdout_path=root / "large.out",
                stderr_path=root / "large.err",
                timeout=10,
                max_output_bytes=2048,
            )
            self.assertEqual(result.status, "output_limit")
            self.assertLessEqual((root / "large.out").stat().st_size, 2048)

            pid_file = root / "child.pid"
            code = (
                "import subprocess,sys,time,pathlib;"
                "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);"
                f"pathlib.Path({str(pid_file)!r}).write_text(str(p.pid));"
                "time.sleep(60)"
            )
            result = run_bounded_process(
                [sys.executable, "-c", code],
                cwd=root,
                stdout_path=root / "timeout.out",
                stderr_path=root / "timeout.err",
                timeout=1,
                max_output_bytes=2048,
            )
            self.assertEqual(result.status, "timed_out")
            child_pid = int(pid_file.read_text())
            time.sleep(0.1)
            with self.assertRaises(ProcessLookupError):
                os.kill(child_pid, 0)

            detached_pid = root / "detached.pid"
            detached_code = (
                "import subprocess,sys,pathlib;"
                "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True);"
                f"pathlib.Path({str(detached_pid)!r}).write_text(str(p.pid))"
            )
            started = time.monotonic()
            detached_result = run_bounded_process(
                [sys.executable, "-c", detached_code],
                cwd=root,
                stdout_path=root / "detached.out",
                stderr_path=root / "detached.err",
                timeout=5,
                max_output_bytes=2048,
            )
            self.assertEqual(detached_result.status, "failed")
            self.assertLess(time.monotonic() - started, 3)
            detached_child_pid = int(detached_pid.read_text())
            try:
                os.kill(detached_child_pid, 9)
            except ProcessLookupError:
                pass

    def test_pi_args_are_allowlisted_and_schedule_is_balanced(self) -> None:
        self.assertEqual(validate_pi_args(["--offline"]), ["--offline"])
        for value in ["--approve", "--api-key=secret", "--extension", "--tools"]:
            with self.assertRaises(ValueError):
                validate_pi_args([value])
        orders = [configuration_order(index, True) for index in range(4)]
        self.assertEqual(sum(order[0] == "with_skill" for order in orders), 2)
        self.assertEqual(sum(order[0] == "baseline" for order in orders), 2)

    def test_behavior_run_forces_body_without_persisting_arm_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fake = root / "fake-pi.py"
            fake.write_text(
                "#!/usr/bin/env python3\n"
                "import json,sys\n"
                "context=sys.argv[sys.argv.index('--append-system-prompt')+1] if '--append-system-prompt' in sys.argv else ''\n"
                "text='NONCE' if 'NONCE' in context else 'BASE'\n"
                "m={'role':'assistant','content':[{'type':'text','text':text}],'responseId':'r','usage':{'totalTokens':1},'stopReason':'stop'}\n"
                "events=[{'type':'session'},{'type':'agent_start'},{'type':'message_end','message':m},{'type':'agent_end','messages':[m]}]\n"
                "[print(json.dumps(e)) for e in events]\n"
            )
            fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
            eval_item = {"prompt": "respond", "resolved_inputs": []}
            treatment = root / "arm-a" / "run-1"
            baseline = root / "arm-b" / "run-1"
            common = {
                "pi_command": str(fake),
                "eval_item": eval_item,
                "run_number": 1,
                "provider": None,
                "model": None,
                "thinking": None,
                "tools": "read",
                "timeout": 10,
                "max_output_bytes": 10000,
                "pi_args": [],
            }
            run_one(
                **common,
                run_dir=treatment,
                skill_context=forced_skill_context(root, "Body NONCE"),
            )
            run_one(**common, run_dir=baseline, skill_context=None)
            self.assertEqual(
                (treatment / "outputs" / "final_response.md").read_text().strip(),
                "NONCE",
            )
            self.assertEqual(
                (baseline / "outputs" / "final_response.md").read_text().strip(),
                "BASE",
            )
            run_data = json.loads((treatment / "run.json").read_text())
            self.assertNotIn("configuration", run_data)
            self.assertNotIn("command", run_data)

    def test_feedback_and_output_symlinks_are_safe(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target.txt"
            target.write_text("original")
            feedback = root / "feedback.json"
            atomic_write_feedback(feedback, {"reviews": []})
            self.assertEqual(json.loads(feedback.read_text()), {"reviews": []})
            feedback.unlink()
            feedback.symlink_to(target)
            with self.assertRaises(ValueError):
                atomic_write_feedback(feedback, {"reviews": [1]})
            with self.assertRaises(ValueError):
                atomic_write_text(feedback, "replacement")
            self.assertEqual(target.read_text(), "original")
            feedback.unlink()
            feedback.mkdir()
            with self.assertRaises(ValueError):
                atomic_write_feedback(feedback, {"reviews": []})
            feedback.rmdir()
            if hasattr(os, "mkfifo"):
                os.mkfifo(feedback)
                with self.assertRaises(ValueError):
                    atomic_write_feedback(feedback, {"reviews": []})
                feedback.unlink()

            outputs = root / "outputs"
            outputs.mkdir()
            secret = root / "secret.txt"
            secret.write_text("DO_NOT_EMBED")
            (outputs / "leak.txt").symlink_to(secret)
            files = safe_output_files(outputs, 10000, [10000])
            self.assertNotIn("DO_NOT_EMBED", json.dumps(files))
            self.assertEqual(files[0]["type"], "omitted")

    def test_matched_aggregation_and_critical_failures(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            jobs = []
            for config, passed in [("with_skill", True), ("baseline", False)]:
                run_dir = root / "eval-1-x" / f"arm-{config}" / "run-1"
                run_dir.mkdir(parents=True)
                (run_dir / "run.json").write_text(
                    json.dumps(
                        {
                            "status": "completed",
                            "configuration": config,
                            "run_number": 1,
                            "tool_calls": 1,
                            "tool_errors": 0,
                        }
                    )
                )
                (run_dir / "timing.json").write_text(
                    json.dumps({"total_duration_seconds": 1, "total_tokens": 10})
                )
                (run_dir / "grading.json").write_text(
                    json.dumps(
                        {
                            "expectations": [
                                {
                                    "text": "critical",
                                    "critical": True,
                                    "passed": passed,
                                    "evidence": "fixture",
                                }
                            ]
                        }
                    )
                )
                jobs.append(
                    {
                        "eval_id": 1,
                        "eval_name": "x",
                        "configuration": config,
                        "run_number": 1,
                        "relative_run_path": str(run_dir.relative_to(root)),
                        "review_id": f"review-{config}",
                    }
                )
            (root / "manifest.json").write_text(
                json.dumps(
                    {
                        "skill_name": "x",
                        "primary_configuration": "with_skill",
                        "baseline_configuration": "baseline",
                        "configurations": ["with_skill", "baseline"],
                        "runs_per_configuration": 1,
                        "expected_jobs": jobs,
                    }
                )
            )
            benchmark = generate_benchmark(root, None)
            self.assertEqual(
                benchmark["run_summary"]["delta"]["pass_rate"]["mean"], 1.0
            )
            self.assertEqual(len(benchmark["critical_failures"]), 1)
            manifest_path = root / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            invalid_manifest = {
                **manifest,
                "baseline_configuration": "with_skill",
                "configurations": ["with_skill"],
            }
            manifest_path.write_text(json.dumps(invalid_manifest))
            with self.assertRaises(ValueError):
                generate_benchmark(root, None)
            manifest_path.write_text(json.dumps(manifest))
            for invalid_manifest in [
                {
                    **manifest,
                    "expected_jobs": [
                        manifest["expected_jobs"][0],
                        {
                            **manifest["expected_jobs"][1],
                            "relative_run_path": manifest["expected_jobs"][0][
                                "relative_run_path"
                            ],
                        },
                    ],
                },
                {
                    **manifest,
                    "expected_jobs": [
                        {**manifest["expected_jobs"][0], "eval_id": True},
                        manifest["expected_jobs"][1],
                    ],
                },
                {**manifest, "expected_jobs": manifest["expected_jobs"][:1]},
            ]:
                manifest_path.write_text(json.dumps(invalid_manifest))
                with self.assertRaises(ValueError):
                    generate_benchmark(root, None)
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                benchmark_output_paths(Path("report.md"), root)
            if hasattr(os, "symlink"):
                workspace_alias = Path(temp) / "workspace-alias"
                workspace_alias.symlink_to(root, target_is_directory=True)
                with mock.patch(
                    "sys.argv", ["aggregate_benchmark.py", str(workspace_alias)]
                ):
                    with self.assertRaises(SystemExit):
                        aggregate_main()

            baseline_dir = root / "eval-1-x" / "arm-baseline" / "run-1"
            (baseline_dir / "timing.json").write_text(
                '{"total_duration_seconds": NaN, "total_tokens": -1}'
            )
            benchmark = generate_benchmark(root, None)
            baseline_run = next(
                run for run in benchmark["runs"] if run["configuration"] == "baseline"
            )
            self.assertEqual(baseline_run["status"], "invalid_artifact")
            (baseline_dir / "timing.json").write_text(
                json.dumps({"total_duration_seconds": 1, "total_tokens": 10})
            )
            (baseline_dir / "grading.json").write_text(
                json.dumps(
                    {
                        "expectations": [
                            {"text": "x", "critical": "false", "passed": True}
                        ]
                    }
                )
            )
            benchmark = generate_benchmark(root, None)
            baseline_run = next(
                run for run in benchmark["runs"] if run["configuration"] == "baseline"
            )
            self.assertEqual(baseline_run["status"], "invalid_artifact")

            (baseline_dir / "run.json").unlink()
            benchmark = generate_benchmark(root, None)
            self.assertIsNone(benchmark["run_summary"]["delta"]["pass_rate"])
            self.assertEqual(len(benchmark["unmatched_pairs"]), 1)

    def test_metadata_default_is_neutral(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "pdf-tools"
            root.mkdir()
            write_openai_yaml(root, "pdf-tools", [])
            text = (root / "agents" / "openai.yaml").read_text()
            self.assertIn("$pdf-tools", text)
            self.assertNotIn("create or improve", text)
            self.assertIsNone(
                write_openai_yaml(
                    root, "pdf-tools", ["default_prompt=Use another tool"]
                )
            )
            self.assertIsNone(
                write_openai_yaml(
                    root, "pdf-tools", ["default_prompt=Use $pdf-tools-extra"]
                )
            )
            self.assertEqual((root / "agents" / "openai.yaml").read_text(), text)
            if hasattr(os, "symlink"):
                unsafe = Path(temp) / "unsafe-skill"
                unsafe.mkdir()
                outside = Path(temp) / "outside-agents"
                outside.mkdir()
                sentinel = outside / "openai.yaml"
                sentinel.write_text("sentinel")
                (unsafe / "agents").symlink_to(outside, target_is_directory=True)
                with self.assertRaises(ValueError):
                    write_openai_yaml(unsafe, "unsafe-skill", [])
                self.assertEqual(sentinel.read_text(), "sentinel")
                root_alias = Path(temp) / "pdf-tools-alias"
                root_alias.symlink_to(root, target_is_directory=True)
                with mock.patch(
                    "sys.argv",
                    [
                        "generate_openai_yaml.py",
                        str(root_alias),
                        "--name",
                        "pdf-tools",
                    ],
                ):
                    with self.assertRaises(SystemExit):
                        openai_yaml_main()
                self.assertEqual((root / "agents" / "openai.yaml").read_text(), text)

    def test_trigger_ids_and_even_runs_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "queries.json"
            path.write_text(
                json.dumps(
                    [
                        {"id": 1, "query": "a", "should_trigger": True},
                        {"id": "1", "query": "b", "should_trigger": False},
                    ]
                )
            )
            with self.assertRaises(ValueError):
                load_queries(path)
        for count in [0, 2, 4]:
            with self.assertRaises(ValueError):
                validate_run_count(count)
        validate_run_count(1)
        validate_run_count(3)
        ensure_unique_skill_names(["a", "b"])
        with self.assertRaises(ValueError):
            ensure_unique_skill_names(["same", "same"])
        orders = counterbalanced_registry_orders(3, 7, random.Random(4))
        for position in range(3):
            counts = [
                sum(order[position] == skill for order in orders) for skill in range(3)
            ]
            self.assertLessEqual(max(counts) - min(counts), 1)
        item = {"id": 1, "query": "x", "should_trigger": False}
        trigger_runs = [
            {**item, "status": "completed", "triggered": True},
            {**item, "status": "completed", "triggered": False},
            {**item, "status": "timed_out", "triggered": None},
        ]
        trigger_result = aggregate_triggers([item], trigger_runs)
        self.assertIsNone(trigger_result["results"][0]["passed"])
        self.assertEqual(trigger_result["summary"]["unscored_due_to_errors"], 1)

    def test_validator_inline_code_exact_token_and_portable_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "sample-skill"
            (root / "agents").mkdir(parents=True)
            (root / "SKILL.md").write_text(
                "---\nname: sample-skill\ndescription: A useful sample skill.\n---\n\n"
                "# Sample\n\nInline example `[missing](nope.md)` is not a real link.\n"
            )
            (root / "agents" / "openai.yaml").write_text(
                "interface:\n  display_name: Sample Skill\n"
                "  short_description: Help with sample skill workflows\n"
                "  default_prompt: Use $sample-skill-extra incorrectly.\n"
            )
            valid, message = validate_skill(root)
            self.assertFalse(valid)
            self.assertIn("exact token", message)
            for suffix in ["X", "_extra"]:
                (root / "agents" / "openai.yaml").write_text(
                    "interface:\n  display_name: Sample Skill\n"
                    "  short_description: Help with sample skill workflows\n"
                    f"  default_prompt: Use $sample-skill{suffix} incorrectly.\n"
                )
                self.assertFalse(validate_skill(root)[0])
            (root / "agents" / "openai.yaml").write_text(
                "interface:\n  display_name: Sample Skill\n"
                "  short_description: Help with sample skill workflows\n"
                "  default_prompt: Use $sample-skill correctly.\n"
            )
            self.assertTrue(validate_skill(root)[0])
            if hasattr(os, "mkfifo"):
                fifo = root / "blocked.md"
                os.mkfifo(fifo)
                valid, message = validate_skill(root)
                self.assertFalse(valid)
                self.assertIn("regular file", message)
                fifo.unlink()
            if hasattr(os, "symlink"):
                real_reference = Path(temp) / "real-reference.md"
                real_reference.write_text("reference")
                linked_reference = Path(temp) / "linked-reference.md"
                linked_reference.symlink_to(real_reference)
                original_skill = (root / "SKILL.md").read_text()
                (root / "SKILL.md").write_text(
                    original_skill + "\n[linked](../linked-reference.md)\n"
                )
                valid, message = validate_skill(root)
                self.assertFalse(valid)
                self.assertIn("escapes allowed local roots", message)
                (root / "SKILL.md").write_text(original_skill)
                root_alias = Path(temp) / "root-alias"
                root_alias.symlink_to(root, target_is_directory=True)
                self.assertFalse(validate_skill(root_alias)[0])
                linked_agents_skill = Path(temp) / "linked-agents-skill"
                linked_agents_skill.mkdir()
                (linked_agents_skill / "SKILL.md").write_text(
                    "---\nname: linked-agents-skill\ndescription: A linked metadata test skill.\n---\nBody\n"
                )
                outside_agents = Path(temp) / "outside-agents-validator"
                outside_agents.mkdir()
                (outside_agents / "openai.yaml").write_text(
                    "interface:\n  display_name: Linked Agents\n"
                    "  short_description: Help with linked agents metadata\n"
                    "  default_prompt: Use $linked-agents-skill correctly.\n"
                )
                (linked_agents_skill / "agents").symlink_to(
                    outside_agents, target_is_directory=True
                )
                self.assertFalse(validate_skill(linked_agents_skill)[0])

            other = Path(temp) / "wrong-folder"
            other.mkdir()
            (other / "SKILL.md").write_text(
                "---\nname: sample-skill\ndescription: Portable test skill.\nmetadata:\n  a: 1\n---\nBody\n"
            )
            valid, message = validate_skill(other, "portable")
            self.assertFalse(valid)
            self.assertIn("folder name", message)
            self.assertIn("map strings", message)

            portable = Path(temp) / "portable-skill"
            portable.mkdir()
            (portable / "SKILL.md").write_text(
                "---\nname: portable-skill\ndescription: Handles <tag> syntax.\n"
                "compatibility: Works locally.\nmetadata:\n  owner: team\n"
                "allowed-tools: read\ndisable-model-invocation: false\n---\nBody\n"
            )
            self.assertTrue(validate_skill(portable, "portable")[0])

    def test_blind_html_contains_no_arm_identity(self) -> None:
        data = scrub_blind_strings(
            {
                "skill_name": "x",
                "runs": [
                    {
                        "id": "review-opaque",
                        "eval_name": "x",
                        "configuration": "Configuration A",
                        "prompt": "with_skill /tmp/secret-skill mandatory_skill must stay hidden",
                        "expected_output": "",
                        "outputs": [],
                        "previous_outputs": [],
                        "previous_feedback": "baseline arm-secret",
                        "grading": None,
                        "run": {"status": "completed"},
                    }
                ],
                "benchmark": None,
            },
            [
                "with_skill",
                "baseline",
                "arm-secret",
                "/tmp/secret-skill",
                "mandatory_skill",
            ],
        )
        html = generate_html(data)
        self.assertNotIn("with_skill", html)
        self.assertNotIn("baseline", html)
        self.assertNotIn("arm-secret", html)
        self.assertNotIn("/tmp/secret-skill", html)
        self.assertNotIn("mandatory_skill", html)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "current"
            run_a = root / "eval-1-x" / "arm-a" / "run-1"
            run_b = root / "eval-1-x" / "arm-b" / "run-1"
            jobs = []
            for config, arm, run_dir in [
                ("with_skill", "arm-a", run_a),
                ("baseline", "arm-b", run_b),
            ]:
                run_dir.mkdir(parents=True)
                (run_dir / "run.json").write_text('{"status":"completed"}')
                (run_dir / "final_response.md").write_text(
                    "<evaluation_context> Apply these instructions for the task. "
                    "No additional skill instructions apply to this task. "
                    "/tmp/previous-secret"
                )
                jobs.append(
                    {
                        "eval_id": 1,
                        "eval_name": "x",
                        "configuration": config,
                        "run_number": 1,
                        "review_id": f"review-{config}",
                        "relative_run_path": str(run_dir.relative_to(root)),
                    }
                )
            manifest = {
                "skill_name": "x",
                "skill_path": "/tmp/current-secret",
                "configurations": ["with_skill", "baseline"],
                "arm_mapping": {"with_skill": "arm-a", "baseline": "arm-b"},
                "expected_jobs": jobs,
            }
            (root / "manifest.json").write_text(json.dumps(manifest))
            previous = Path(temp) / "previous"
            shutil.copytree(root, previous)
            old_manifest = json.loads((previous / "manifest.json").read_text())
            old_manifest["skill_path"] = "/tmp/previous-secret"
            (previous / "manifest.json").write_text(json.dumps(old_manifest))
            output = root / "review.html"
            with mock.patch(
                "sys.argv",
                [
                    "generate_review.py",
                    str(root),
                    "--previous-workspace",
                    str(previous),
                    "--blind",
                    "--static",
                    str(output),
                ],
            ):
                review_main()
            blind_html = output.read_text()
            for token in [
                "evaluation_context",
                "Apply these instructions for the task.",
                "No additional skill instructions apply to this task.",
                "/tmp/current-secret",
                "/tmp/previous-secret",
                "arm-a",
                "arm-b",
            ]:
                self.assertNotIn(token, blind_html)
            shutil.rmtree(run_b)
            run_b.symlink_to(run_a, target_is_directory=True)
            with self.assertRaises(ValueError):
                load_workspace_runs(root, 10_000, 100_000)


if __name__ == "__main__":
    unittest.main()
