#!/usr/bin/env python3
"""Regression tests for the delegated process supervisor."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("run_delegate.py")
CHAIN_SCRIPT = Path(__file__).with_name("run_delegate_chain.py")


class DelegateSupervisorTests(unittest.TestCase):
    def run_supervisor(
        self,
        root: Path,
        name: str,
        child_code: str,
        *,
        timeout: float = 2,
        heartbeat: float = 0.1,
        grace: float = 0.2,
        max_output_bytes: int = 1024 * 1024,
        protocol: str = "plain",
        require_result: bool = False,
        idle_warning: float = 0.2,
        idle_timeout: float = 0.4,
    ) -> tuple[subprocess.CompletedProcess[str], Path]:
        artifact_dir = root / name
        command = [
            sys.executable,
            str(SCRIPT),
            "--label",
            name,
            "--artifact-dir",
            str(artifact_dir),
            "--protocol",
            protocol,
            "--idle-warning-seconds",
            str(idle_warning),
            "--idle-timeout-seconds",
            str(idle_timeout),
            "--timeout-seconds",
            str(timeout),
            "--heartbeat-seconds",
            str(heartbeat),
            "--grace-seconds",
            str(grace),
            "--max-output-bytes",
            str(max_output_bytes),
        ]
        if require_result:
            command.append("--require-result")
        command.extend(
            [
                "--",
                sys.executable,
                "-c",
                child_code,
            ]
        )
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=8, check=False
        )
        return result, artifact_dir

    def read_status(self, artifact_dir: Path) -> dict[str, object]:
        return json.loads((artifact_dir / "status.json").read_text(encoding="utf-8"))

    def process_is_active(self, process_id: int) -> bool:
        proc_stat = Path(f"/proc/{process_id}/stat")
        if proc_stat.exists():
            fields = proc_stat.read_text(encoding="utf-8").split()
            return len(fields) > 2 and fields[2] != "Z"
        try:
            os.kill(process_id, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def wait_for_process_exit(self, process_id: int) -> None:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if not self.process_is_active(process_id):
                return
            time.sleep(0.05)
        self.fail(f"process {process_id} remains active")

    def wait_for_path(self, path: Path) -> None:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if path.exists():
                return
            time.sleep(0.05)
        self.fail(f"path was not created: {path}")

    def test_extended_deadlines_require_explicit_flags(self) -> None:
        cases = [
            ("--timeout-seconds", "2701", "--allow-extended-timeout"),
            ("--idle-timeout-seconds", "601", "--allow-extended-idle"),
        ]
        for option, value, required_flag in cases:
            with self.subTest(option=option):
                result = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        option,
                        value,
                        "--",
                        sys.executable,
                        "-c",
                        "pass",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=3,
                    check=False,
                )
                self.assertEqual(result.returncode, 2)
                self.assertIn(required_flag, result.stderr)

    def test_success_preserves_and_replays_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, artifact_dir = self.run_supervisor(
                Path(temporary), "success", 'print("# Complete report")'
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("# Complete report", result.stdout)
            self.assertIn("state=completed", result.stderr)
            self.assertEqual(
                (artifact_dir / "report.md").read_text(encoding="utf-8"),
                "# Complete report\n",
            )
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "completed")
            self.assertTrue(status["report_present"])
            self.assertNotIn("command", status)

    def test_success_without_report_is_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, artifact_dir = self.run_supervisor(Path(temporary), "empty", "pass")

            self.assertEqual(result.returncode, 70)
            self.assertIn("produced no report", result.stderr)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "missing_report")
            self.assertFalse(status["report_present"])

    def test_pi_json_extracts_report_without_replaying_raw_events(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            events = [
                {"type": "session", "version": 3, "id": "test"},
                {"type": "agent_start"},
                {"type": "turn_start"},
                {
                    "type": "message_update",
                    "assistantMessageEvent": {
                        "type": "thinking_delta",
                        "contentIndex": 0,
                        "delta": "PRIVATE_THOUGHT",
                    },
                },
                {
                    "type": "tool_execution_start",
                    "toolCallId": "call-1",
                    "toolName": "read",
                    "args": {"path": "PRIVATE_TOOL_ARGUMENT"},
                },
                {
                    "type": "tool_execution_end",
                    "toolCallId": "call-1",
                    "toolName": "read",
                    "result": {"content": "PRIVATE_TOOL_RESULT"},
                    "isError": False,
                },
                {
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [
                            {
                                "type": "text",
                                "text": "# Final report\n\nDELEGATE_RESULT: COMPLETED",
                            }
                        ],
                    },
                },
                {"type": "turn_end", "message": {}, "toolResults": []},
                {"type": "agent_end", "messages": []},
            ]
            child_code = (
                "import json; "
                f"events={events!r}; "
                "[print(json.dumps(event), flush=True) for event in events]"
            )
            result, artifact_dir = self.run_supervisor(
                Path(temporary), "pi-json-success", child_code, protocol="pi-json"
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("# Final report", result.stdout)
            self.assertIn("DELEGATE_RESULT: COMPLETED", result.stdout)
            combined = result.stdout + result.stderr
            self.assertNotIn("PRIVATE_THOUGHT", combined)
            self.assertNotIn("PRIVATE_TOOL_ARGUMENT", combined)
            self.assertNotIn("PRIVATE_TOOL_RESULT", combined)
            status_text = (artifact_dir / "status.json").read_text(encoding="utf-8")
            self.assertNotIn("PRIVATE_THOUGHT", status_text)
            self.assertNotIn("PRIVATE_TOOL_ARGUMENT", status_text)
            self.assertNotIn("PRIVATE_TOOL_RESULT", status_text)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "completed")
            self.assertEqual(status["delegate_outcome"], "completed")
            self.assertEqual(status["protocol"], "pi-json")
            self.assertTrue(status["agent_end_seen"])
            self.assertGreater(status["activity_event_count"], 0)
            self.assertFalse((artifact_dir / "events.jsonl").exists())

    def test_pi_json_silent_delegate_stalls(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            child_code = (
                "import json,time; "
                "print(json.dumps({'type':'session','version':3,'id':'test'}), flush=True); "
                "print(json.dumps({'type':'agent_start'}), flush=True); "
                "time.sleep(30)"
            )
            result, artifact_dir = self.run_supervisor(
                Path(temporary),
                "pi-json-stalled",
                child_code,
                protocol="pi-json",
                timeout=2,
                idle_warning=0.1,
                idle_timeout=0.3,
            )

            self.assertEqual(result.returncode, 75, result.stderr)
            self.assertIn("idle warning", result.stderr)
            self.assertIn("stalled label=pi-json-stalled", result.stderr)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "stalled")
            self.assertGreaterEqual(status["idle_warning_count"], 1)
            self.assertGreaterEqual(status["idle_seconds"], 0.3)

    def test_pi_json_activity_reaches_wall_timeout_not_idle_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            child_code = """import json,time
print(json.dumps({'type':'session','version':3,'id':'test'}), flush=True)
print(json.dumps({'type':'agent_start'}), flush=True)
while True:
    print(json.dumps({'type':'message_update','assistantMessageEvent':{'type':'thinking_delta','contentIndex':0,'delta':'x'}}), flush=True)
    time.sleep(0.04)
"""
            result, artifact_dir = self.run_supervisor(
                Path(temporary),
                "pi-json-active-timeout",
                child_code,
                protocol="pi-json",
                timeout=0.4,
                idle_warning=0.1,
                idle_timeout=0.2,
            )

            self.assertEqual(result.returncode, 124, result.stderr)
            self.assertNotIn("stalled label=", result.stderr)
            self.assertEqual(self.read_status(artifact_dir)["state"], "timed_out")

    def test_pi_json_empty_deltas_do_not_fake_activity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            child_code = """import json,time
print(json.dumps({'type':'session','version':3,'id':'test'}), flush=True)
print(json.dumps({'type':'agent_start'}), flush=True)
while True:
    print(json.dumps({'type':'message_update','assistantMessageEvent':{'type':'thinking_delta','contentIndex':0,'delta':''}}), flush=True)
    time.sleep(0.04)
"""
            result, artifact_dir = self.run_supervisor(
                Path(temporary),
                "pi-json-empty-delta",
                child_code,
                protocol="pi-json",
                timeout=1,
                idle_warning=0.1,
                idle_timeout=0.3,
            )

            self.assertEqual(result.returncode, 75, result.stderr)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "stalled")
            self.assertEqual(status["last_event"], "agent_start")

    def test_pi_json_blocked_result_terminates_early(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            events = [
                {"type": "session", "version": 3, "id": "test"},
                {"type": "agent_start"},
                {
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [
                            {
                                "type": "text",
                                "text": "Cannot prove the gate.\n\nDELEGATE_RESULT: BLOCKED",
                            }
                        ],
                    },
                },
            ]
            child_code = (
                "import json,time; "
                f"events={events!r}; "
                "[print(json.dumps(event), flush=True) for event in events]; "
                "time.sleep(30)"
            )
            result, artifact_dir = self.run_supervisor(
                Path(temporary),
                "pi-json-blocked",
                child_code,
                protocol="pi-json",
                timeout=2,
            )

            self.assertEqual(result.returncode, 76, result.stderr)
            self.assertIn("DELEGATE_RESULT: BLOCKED", result.stdout)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "blocked")
            self.assertEqual(status["delegate_outcome"], "blocked")
            self.assertLess(status["elapsed_seconds"], 2)

    def test_pi_json_requires_structured_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            events = [
                {"type": "session", "version": 3, "id": "test"},
                {"type": "agent_start"},
                {
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "text", "text": "Unmarked report"}],
                    },
                },
                {"type": "agent_end", "messages": []},
            ]
            child_code = (
                "import json; "
                f"events={events!r}; "
                "[print(json.dumps(event), flush=True) for event in events]"
            )
            result, artifact_dir = self.run_supervisor(
                Path(temporary), "pi-json-unmarked", child_code, protocol="pi-json"
            )

            self.assertEqual(result.returncode, 78, result.stderr)
            self.assertEqual(self.read_status(artifact_dir)["state"], "invalid_result")

    def test_pi_json_failed_result_terminates_early(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            events = [
                {"type": "session", "version": 3, "id": "test"},
                {"type": "agent_start"},
                {
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [
                            {
                                "type": "text",
                                "text": "Execution failed.\n\nDELEGATE_RESULT: FAILED",
                            }
                        ],
                    },
                },
            ]
            child_code = (
                "import json,time; "
                f"events={events!r}; "
                "[print(json.dumps(event), flush=True) for event in events]; "
                "time.sleep(30)"
            )
            result, artifact_dir = self.run_supervisor(
                Path(temporary),
                "pi-json-failed",
                child_code,
                protocol="pi-json",
                timeout=2,
            )

            self.assertEqual(result.returncode, 77, result.stderr)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "delegate_failed")
            self.assertEqual(status["delegate_outcome"], "failed")

    def test_pi_json_auto_retry_lifecycle_can_complete(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            events = [
                {"type": "session", "version": 3, "id": "test"},
                {"type": "agent_start"},
                {"type": "agent_end", "messages": [], "willRetry": True},
                {
                    "type": "auto_retry_start",
                    "attempt": 1,
                    "maxAttempts": 3,
                    "delayMs": 1,
                    "errorMessage": "retry",
                },
                {"type": "auto_retry_end", "success": True, "attempt": 1},
                {"type": "agent_start"},
                {
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [
                            {
                                "type": "text",
                                "text": "Recovered.\n\nDELEGATE_RESULT: COMPLETED",
                            }
                        ],
                    },
                },
                {"type": "agent_end", "messages": [], "willRetry": False},
                {"type": "agent_settled"},
            ]
            child_code = (
                "import json; "
                f"events={events!r}; "
                "[print(json.dumps(event), flush=True) for event in events]"
            )
            result, artifact_dir = self.run_supervisor(
                Path(temporary), "pi-json-retry", child_code, protocol="pi-json"
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "completed")
            self.assertEqual(status["agent_start_count"], 2)
            self.assertEqual(status["agent_end_count"], 2)
            self.assertEqual(status["last_event"], "agent_settled")

    def test_pi_json_missing_agent_end_is_invalid_stream(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            events = [
                {"type": "session", "version": 3, "id": "test"},
                {"type": "agent_start"},
                {
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [
                            {
                                "type": "text",
                                "text": "Report\n\nDELEGATE_RESULT: COMPLETED",
                            }
                        ],
                    },
                },
            ]
            child_code = (
                "import json; "
                f"events={events!r}; "
                "[print(json.dumps(event), flush=True) for event in events]"
            )
            result, artifact_dir = self.run_supervisor(
                Path(temporary),
                "pi-json-invalid-stream",
                child_code,
                protocol="pi-json",
            )

            self.assertEqual(result.returncode, 79, result.stderr)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "invalid_stream")
            self.assertFalse(status["agent_end_seen"])
            self.assertFalse((artifact_dir / "events.jsonl").exists())

    def test_plain_protocol_can_require_blocked_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            child_code = 'print("Cannot continue\\n\\nDELEGATE_RESULT: BLOCKED")'
            result, artifact_dir = self.run_supervisor(
                Path(temporary),
                "plain-blocked",
                child_code,
                require_result=True,
            )

            self.assertEqual(result.returncode, 76, result.stderr)
            self.assertEqual(self.read_status(artifact_dir)["state"], "blocked")

    def test_output_limit_fails_and_preserves_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, artifact_dir = self.run_supervisor(
                Path(temporary),
                "output-limit",
                'print("x" * 5000)',
                max_output_bytes=100,
            )

            self.assertEqual(result.returncode, 74, result.stderr)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "output_limit")
            self.assertGreater(status["output_bytes"], 100)
            self.assertTrue((artifact_dir / "report.md").exists())

    @unittest.skipUnless(Path("/proc").is_dir(), "requires Linux process inspection")
    def test_timeout_kills_delegate_and_descendant(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process_id_path = root / "grandchild.pid"
            child_code = (
                "import pathlib,subprocess,time; "
                "p=subprocess.Popen(['sleep','30']); "
                f"pathlib.Path({str(process_id_path)!r}).write_text(str(p.pid)); "
                "time.sleep(30)"
            )
            result, artifact_dir = self.run_supervisor(
                root, "timeout", child_code, timeout=0.35
            )

            self.assertEqual(result.returncode, 124, result.stderr)
            self.assertIn("timeout label=timeout", result.stderr)
            self.assertIn("state=timed_out", result.stderr)
            status = self.read_status(artifact_dir)
            self.assertEqual(status["state"], "timed_out")
            self.wait_for_process_exit(int(process_id_path.read_text(encoding="utf-8")))

    @unittest.skipUnless(Path("/proc").is_dir(), "requires Linux process inspection")
    def test_parent_death_cleans_supervisor_and_delegate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact_dir = root / "parent-death"
            supervisor_id_path = root / "supervisor.pid"
            delegate_id_path = root / "delegate.pid"
            child_code = (
                "import os,pathlib,time; "
                f"pathlib.Path({str(delegate_id_path)!r}).write_text(str(os.getpid())); "
                "time.sleep(30)"
            )
            supervisor_command = [
                sys.executable,
                str(SCRIPT),
                "--artifact-dir",
                str(artifact_dir),
                "--timeout-seconds",
                "10",
                "--heartbeat-seconds",
                "1",
                "--grace-seconds",
                "0.2",
                "--",
                sys.executable,
                "-c",
                child_code,
            ]
            launcher_code = (
                "import pathlib,subprocess,time; "
                f"p=subprocess.Popen({supervisor_command!r}, "
                "stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); "
                f"pathlib.Path({str(supervisor_id_path)!r}).write_text(str(p.pid)); "
                "time.sleep(30)"
            )
            launcher = subprocess.Popen([sys.executable, "-c", launcher_code])
            self.wait_for_path(supervisor_id_path)
            self.wait_for_path(delegate_id_path)

            os.kill(launcher.pid, signal.SIGKILL)
            launcher.wait(timeout=2)

            supervisor_id = int(supervisor_id_path.read_text(encoding="utf-8"))
            delegate_id = int(delegate_id_path.read_text(encoding="utf-8"))
            self.wait_for_process_exit(supervisor_id)
            self.wait_for_process_exit(delegate_id)
            self.wait_for_path(artifact_dir / "status.json")
            self.assertEqual(self.read_status(artifact_dir)["state"], "interrupted")

    @unittest.skipUnless(Path("/proc").is_dir(), "requires Linux process inspection")
    def test_clean_exit_removes_leftover_descendant(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process_id_path = root / "leftover.pid"
            child_code = (
                "import pathlib,subprocess; "
                "p=subprocess.Popen(['sleep','30']); "
                f"pathlib.Path({str(process_id_path)!r}).write_text(str(p.pid)); "
                "print('# Report before exit')"
            )
            result, artifact_dir = self.run_supervisor(root, "cleanup", child_code)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.read_status(artifact_dir)["state"], "completed")
            self.wait_for_process_exit(int(process_id_path.read_text(encoding="utf-8")))


class DelegateFallbackChainTests(unittest.TestCase):
    def create_fake_pi(self, root: Path) -> Path:
        fake_pi = root / "pi"
        fake_pi.write_text(
            f"""#!{sys.executable}
import json
import os
import sys
import time

args = sys.argv[1:]
if "--list-models" in args:
    pattern = args[args.index("--list-models") + 1]
    if pattern in os.environ.get("FAKE_CATALOG", "").split(","):
        provider, model = pattern.split("/", 1)
        print("provider model context max-out thinking images")
        print(f"{{provider}} {{model}} 1M 128K yes no")
    raise SystemExit(0)

provider = args[args.index("--provider") + 1]
model = args[args.index("--model") + 1]
route = f"{{provider}}/{{model}}"
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as handle:
    handle.write(route + "\\n")
behavior = json.loads(os.environ["FAKE_BEHAVIORS"])[route]

def emit(event):
    print(json.dumps(event), flush=True)

emit({{"type": "session", "version": 3, "id": route}})
emit({{"type": "agent_start"}})
if behavior == "stall":
    time.sleep(30)
if behavior == "tool-error":
    emit({{
        "type": "tool_execution_start",
        "toolCallId": "call-1",
        "toolName": "read",
        "args": {{"path": "fixture"}},
    }})
if behavior in {{"unavailable", "tool-error"}}:
    emit({{
        "type": "message_end",
        "message": {{
            "role": "assistant",
            "content": [],
            "stopReason": "error",
            "errorMessage": "503 Service unavailable",
        }},
    }})
    emit({{"type": "agent_end", "messages": [], "willRetry": False}})
    raise SystemExit(1)
emit({{
    "type": "message_end",
    "message": {{
        "role": "assistant",
        "content": [{{
            "type": "text",
            "text": f"Completed with {{route}}.\\n\\nDELEGATE_RESULT: COMPLETED",
        }}],
        "stopReason": "stop",
    }},
}})
emit({{"type": "agent_end", "messages": [], "willRetry": False}})
""",
            encoding="utf-8",
        )
        fake_pi.chmod(0o700)
        return fake_pi

    def run_chain(
        self,
        root: Path,
        *,
        catalog: list[str],
        behaviors: dict[str, str],
        fallbacks: list[str],
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object], list[str]]:
        fake_pi = self.create_fake_pi(root)
        artifact_dir = root / "chain-artifacts"
        log_path = root / "invocations.log"
        command = [
            sys.executable,
            str(CHAIN_SCRIPT),
            "--label",
            "fallback-test",
            "--artifact-dir",
            str(artifact_dir),
            "--timeout-seconds",
            "4",
            "--grace-seconds",
            "0.1",
            "--idle-warning-seconds",
            "0.1",
            "--idle-timeout-seconds",
            "0.25",
        ]
        for route in fallbacks:
            command.extend(["--fallback-route", route])
        command.extend(
            [
                "--",
                str(fake_pi),
                "--mode",
                "json",
                "--no-session",
                "--approve",
                "--provider",
                "primary",
                "--model",
                "model-a",
                "--thinking",
                "xhigh",
                "@prompt.md",
            ]
        )
        environment = os.environ.copy()
        environment.update(
            {
                "FAKE_CATALOG": ",".join(catalog),
                "FAKE_BEHAVIORS": json.dumps(behaviors),
                "FAKE_LOG": str(log_path),
            }
        )
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
            env=environment,
        )
        status = json.loads((artifact_dir / "status.json").read_text(encoding="utf-8"))
        invocations = (
            log_path.read_text(encoding="utf-8").splitlines()
            if log_path.exists()
            else []
        )
        return result, status, invocations

    def test_catalog_absence_skips_to_next_route(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, status, invocations = self.run_chain(
                Path(temporary),
                catalog=["backup/model-b"],
                behaviors={"backup/model-b": "complete"},
                fallbacks=["backup/model-b:high"],
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(status["selected_route"], "backup/model-b:high")
            self.assertEqual(invocations, ["backup/model-b"])
            self.assertEqual(status["attempts"][0]["state"], "catalog_unavailable")

    def test_provider_error_falls_back_before_tools(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, status, invocations = self.run_chain(
                Path(temporary),
                catalog=["primary/model-a", "backup/model-b"],
                behaviors={
                    "primary/model-a": "unavailable",
                    "backup/model-b": "complete",
                },
                fallbacks=["backup/model-b:high"],
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(invocations, ["primary/model-a", "backup/model-b"])
            self.assertEqual(status["selected_route"], "backup/model-b:high")
            self.assertEqual(
                status["attempts"][0]["fallback_reason"],
                "provider_unavailable_before_tools",
            )
            status_text = json.dumps(status)
            self.assertNotIn("command", status_text)
            self.assertNotIn("@prompt.md", status_text)
            self.assertNotIn("503 Service unavailable", result.stdout + result.stderr)

    def test_event_idle_falls_back_before_tools(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, status, invocations = self.run_chain(
                Path(temporary),
                catalog=["primary/model-a", "backup/model-b"],
                behaviors={
                    "primary/model-a": "stall",
                    "backup/model-b": "complete",
                },
                fallbacks=["backup/model-b:high"],
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(invocations, ["primary/model-a", "backup/model-b"])
            self.assertEqual(
                status["attempts"][0]["fallback_reason"],
                "event_idle_before_tools",
            )

    def test_tool_execution_disables_automatic_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, status, invocations = self.run_chain(
                Path(temporary),
                catalog=["primary/model-a", "backup/model-b"],
                behaviors={
                    "primary/model-a": "tool-error",
                    "backup/model-b": "complete",
                },
                fallbacks=["backup/model-b:high"],
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(invocations, ["primary/model-a"])
            self.assertEqual(status["selected_route"], "primary/model-a:xhigh")
            self.assertNotIn("fallback_reason", status["attempts"][0])

    def test_all_uncatalogued_routes_fail_without_delegate_start(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, status, invocations = self.run_chain(
                Path(temporary),
                catalog=[],
                behaviors={},
                fallbacks=["backup/model-b:high"],
            )

            self.assertEqual(result.returncode, 80, result.stderr)
            self.assertEqual(status["state"], "routes_unavailable")
            self.assertIsNone(status["selected_route"])
            self.assertEqual(invocations, [])

    def test_single_guarded_route_can_fail_catalog_preflight(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, status, invocations = self.run_chain(
                Path(temporary),
                catalog=[],
                behaviors={},
                fallbacks=[],
            )

            self.assertEqual(result.returncode, 80, result.stderr)
            self.assertEqual(status["state"], "routes_unavailable")
            self.assertEqual(len(status["attempts"]), 1)
            self.assertEqual(invocations, [])

    def test_runtime_unavailability_can_exhaust_chain(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, status, invocations = self.run_chain(
                Path(temporary),
                catalog=["primary/model-a", "backup/model-b"],
                behaviors={
                    "primary/model-a": "unavailable",
                    "backup/model-b": "unavailable",
                },
                fallbacks=["backup/model-b:high"],
            )

            self.assertEqual(result.returncode, 80, result.stderr)
            self.assertEqual(status["state"], "routes_unavailable")
            self.assertIsNone(status["selected_route"])
            self.assertEqual(invocations, ["primary/model-a", "backup/model-b"])
            self.assertNotIn("503 Service unavailable", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
