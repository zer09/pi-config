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
    ) -> tuple[subprocess.CompletedProcess[str], Path]:
        artifact_dir = root / name
        command = [
            sys.executable,
            str(SCRIPT),
            "--label",
            name,
            "--artifact-dir",
            str(artifact_dir),
            "--timeout-seconds",
            str(timeout),
            "--heartbeat-seconds",
            str(heartbeat),
            "--grace-seconds",
            str(grace),
            "--max-output-bytes",
            str(max_output_bytes),
            "--",
            sys.executable,
            "-c",
            child_code,
        ]
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


if __name__ == "__main__":
    unittest.main()
