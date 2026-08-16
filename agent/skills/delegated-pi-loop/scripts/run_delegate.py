#!/usr/bin/env python3
"""Run one delegated CLI process with bounded lifetime and durable diagnostics."""

from __future__ import annotations

import argparse
import ctypes
import errno
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO

DEFAULT_TIMEOUT_SECONDS = 45 * 60
DEFAULT_GRACE_SECONDS = 15
DEFAULT_HEARTBEAT_SECONDS = 60
DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024
EXIT_TIMEOUT = 124
EXIT_MISSING_REPORT = 70
EXIT_OUTPUT_LIMIT = 74


def positive_number(value: str) -> float:
    number = float(value)
    if not 0 < number:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return number


def positive_integer(value: str) -> int:
    number = int(value)
    if not 0 < number:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return number


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run one delegate in a new process group, enforce a deadline, and "
            "preserve its report and stderr under a temporary directory."
        )
    )
    parser.add_argument(
        "--label", default="delegate", help="Short role label for diagnostics"
    )
    parser.add_argument(
        "--timeout-seconds",
        type=positive_number,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Wall-clock deadline (default: {DEFAULT_TIMEOUT_SECONDS})",
    )
    parser.add_argument(
        "--grace-seconds",
        type=positive_number,
        default=DEFAULT_GRACE_SECONDS,
        help=f"SIGTERM grace period before SIGKILL (default: {DEFAULT_GRACE_SECONDS})",
    )
    parser.add_argument(
        "--heartbeat-seconds",
        type=positive_number,
        default=DEFAULT_HEARTBEAT_SECONDS,
        help=f"Heartbeat interval (default: {DEFAULT_HEARTBEAT_SECONDS})",
    )
    parser.add_argument(
        "--max-output-bytes",
        type=positive_integer,
        default=DEFAULT_MAX_OUTPUT_BYTES,
        help=f"Combined stdout/stderr limit (default: {DEFAULT_MAX_OUTPUT_BYTES})",
    )
    parser.add_argument(
        "--artifact-dir",
        help="Create this new directory instead of a random directory under the system temp path",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER, help="Command after --")
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("a delegate command is required after --")
    return args


def safe_label(label: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", label).strip("-.")
    return normalized[:64] or "delegate"


def configure_supervisor_lifecycle() -> None:
    """Keep outer aborts from orphaning the separately grouped delegate."""
    try:
        os.setsid()
    except OSError as error:
        # A process-group leader is already isolated from its parent's group.
        if error.errno != errno.EPERM:
            raise

    if not sys.platform.startswith("linux"):
        return

    parent_process_id = os.getppid()
    libc = ctypes.CDLL(None, use_errno=True)
    parent_death_signal = 1  # Linux PR_SET_PDEATHSIG
    if libc.prctl(parent_death_signal, signal.SIGTERM, 0, 0, 0) != 0:
        error_number = ctypes.get_errno()
        raise OSError(error_number, os.strerror(error_number))
    # Close the race where the parent exits before PR_SET_PDEATHSIG is set.
    if os.getppid() != parent_process_id:
        os.kill(os.getpid(), signal.SIGTERM)


def has_symlink_component(path: Path) -> bool:
    absolute = Path(os.path.abspath(path))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        if current.is_symlink():
            return True
        if not current.exists():
            break
    return False


def create_artifact_dir(requested: str | None, label: str) -> Path:
    if requested is None:
        path = Path(tempfile.mkdtemp(prefix=f"delegated-pi-{safe_label(label)}-"))
    else:
        path = Path(os.path.abspath(os.path.expanduser(requested)))
        if has_symlink_component(path):
            raise ValueError(f"artifact path contains a symlink component: {path}")
        path.mkdir(mode=0o700, parents=False, exist_ok=False)
    path.chmod(0o700)
    return path


def open_private_binary(path: Path) -> BinaryIO:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(descriptor, "wb")


def atomic_write_json(path: Path, payload: dict[str, object]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def process_group_exists(process_group_id: int) -> bool:
    try:
        os.killpg(process_group_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def signal_process_group(process_group_id: int, signal_number: int) -> None:
    try:
        os.killpg(process_group_id, signal_number)
    except ProcessLookupError:
        pass


def terminate_process_group(
    process: subprocess.Popen[bytes], process_group_id: int, grace_seconds: float
) -> None:
    if process_group_exists(process_group_id):
        signal_process_group(process_group_id, signal.SIGTERM)

    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        process.poll()
        if not process_group_exists(process_group_id):
            break
        time.sleep(0.05)

    if process_group_exists(process_group_id):
        signal_process_group(process_group_id, signal.SIGKILL)

    try:
        process.wait(timeout=max(1.0, grace_seconds))
    except subprocess.TimeoutExpired:
        signal_process_group(process_group_id, signal.SIGKILL)
        process.wait()


def contains_non_whitespace(path: Path) -> bool:
    with path.open("rb") as handle:
        while chunk := handle.read(64 * 1024):
            if chunk.strip():
                return True
    return False


def replay(path: Path, stream: BinaryIO, *, tail_bytes: int | None = None) -> None:
    with path.open("rb") as handle:
        if tail_bytes is not None and path.stat().st_size > tail_bytes:
            handle.seek(-tail_bytes, os.SEEK_END)
            stream.write(b"[delegate-supervisor] output truncated to final bytes\n")
        while chunk := handle.read(64 * 1024):
            stream.write(chunk)
    stream.flush()


def ends_with_newline(path: Path) -> bool:
    if path.stat().st_size == 0:
        return True
    with path.open("rb") as handle:
        handle.seek(-1, os.SEEK_END)
        return handle.read(1) == b"\n"


def normalized_exit_code(return_code: int | None) -> int:
    if return_code is None:
        return 1
    if return_code < 0:
        return 128 + abs(return_code)
    if return_code > 255:
        return 1
    return return_code


def iso_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def run() -> int:
    args = parse_args()
    configure_supervisor_lifecycle()
    label = safe_label(args.label)
    artifact_dir = create_artifact_dir(args.artifact_dir, label)
    report_path = artifact_dir / "report.md"
    stderr_path = artifact_dir / "stderr.log"
    status_path = artifact_dir / "status.json"

    started_at = iso_now()
    started = time.monotonic()
    print(
        f"[delegate-supervisor] started label={label} "
        f"timeout={args.timeout_seconds:.1f}s max_output={args.max_output_bytes} "
        f"artifacts={artifact_dir}",
        file=sys.stderr,
        flush=True,
    )
    received_signal: list[int | None] = [None]

    def remember_signal(signal_number: int, _frame: object) -> None:
        received_signal[0] = signal_number

    previous_handlers = {
        signal_number: signal.getsignal(signal_number)
        for signal_number in (signal.SIGINT, signal.SIGTERM)
    }
    for signal_number in previous_handlers:
        signal.signal(signal_number, remember_signal)

    process: subprocess.Popen[bytes] | None = None
    state = "spawn_failed"
    return_code: int | None = None

    try:
        with (
            open_private_binary(report_path) as report_handle,
            open_private_binary(stderr_path) as stderr_handle,
        ):
            process = subprocess.Popen(
                args.command,
                stdin=None,
                stdout=report_handle,
                stderr=stderr_handle,
                start_new_session=True,
            )
            process_group_id = process.pid
            state = "running"
            next_heartbeat = started + args.heartbeat_seconds

            while True:
                return_code = process.poll()
                if return_code is not None:
                    break

                now = time.monotonic()
                elapsed = now - started
                output_bytes = report_path.stat().st_size + stderr_path.stat().st_size
                if received_signal[0] is not None:
                    state = "interrupted"
                    terminate_process_group(
                        process, process_group_id, args.grace_seconds
                    )
                    return_code = process.poll()
                    break
                if output_bytes > args.max_output_bytes:
                    state = "output_limit"
                    print(
                        f"[delegate-supervisor] output limit label={label} "
                        f"bytes={output_bytes}; terminating process group",
                        file=sys.stderr,
                        flush=True,
                    )
                    terminate_process_group(
                        process, process_group_id, args.grace_seconds
                    )
                    return_code = process.poll()
                    break
                if elapsed >= args.timeout_seconds:
                    state = "timed_out"
                    print(
                        f"[delegate-supervisor] timeout label={label} "
                        f"elapsed={elapsed:.1f}s; terminating process group",
                        file=sys.stderr,
                        flush=True,
                    )
                    terminate_process_group(
                        process, process_group_id, args.grace_seconds
                    )
                    return_code = process.poll()
                    break
                if now >= next_heartbeat:
                    print(
                        f"[delegate-supervisor] running label={label} "
                        f"pid={process.pid} elapsed={elapsed:.1f}s",
                        file=sys.stderr,
                        flush=True,
                    )
                    next_heartbeat = now + args.heartbeat_seconds
                time.sleep(0.1)

            if state == "running":
                output_bytes = report_path.stat().st_size + stderr_path.stat().st_size
                if output_bytes > args.max_output_bytes:
                    state = "output_limit"
                else:
                    state = "completed" if return_code == 0 else "child_failed"
                # Delegates must not leave servers or other descendants behind.
                terminate_process_group(process, process_group_id, args.grace_seconds)
                return_code = process.poll()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        state = "spawn_failed"
        print(
            f"[delegate-supervisor] spawn failure: {error}", file=sys.stderr, flush=True
        )
        if process is not None:
            terminate_process_group(process, process.pid, args.grace_seconds)
            return_code = process.poll()
    finally:
        for signal_number, previous_handler in previous_handlers.items():
            signal.signal(signal_number, previous_handler)

    elapsed_seconds = time.monotonic() - started
    report_present = report_path.exists() and contains_non_whitespace(report_path)
    if state == "completed" and not report_present:
        state = "missing_report"

    status = {
        "schema_version": 1,
        "label": label,
        "state": state,
        "started_at": started_at,
        "ended_at": iso_now(),
        "elapsed_seconds": round(elapsed_seconds, 3),
        "exit_code": return_code,
        "output_bytes": report_path.stat().st_size + stderr_path.stat().st_size,
        "report_present": report_present,
        "report_path": str(report_path),
        "stderr_path": str(stderr_path),
    }
    atomic_write_json(status_path, status)

    replay_tail_bytes = 64 * 1024 if state == "output_limit" else None
    if report_path.exists() and report_path.stat().st_size:
        replay(report_path, sys.stdout.buffer, tail_bytes=replay_tail_bytes)
        if not ends_with_newline(report_path):
            sys.stdout.write("\n")
            sys.stdout.flush()
    if stderr_path.exists() and stderr_path.stat().st_size:
        replay(stderr_path, sys.stderr.buffer, tail_bytes=replay_tail_bytes)
        if not ends_with_newline(stderr_path):
            sys.stderr.write("\n")

    print(
        f"[delegate-supervisor] state={state} label={label} "
        f"elapsed={elapsed_seconds:.1f}s report={report_path} "
        f"stderr={stderr_path} status={status_path}",
        file=sys.stderr,
        flush=True,
    )

    if state == "completed":
        return 0
    if state == "timed_out":
        return EXIT_TIMEOUT
    if state == "output_limit":
        return EXIT_OUTPUT_LIMIT
    if state == "missing_report":
        print(
            "[delegate-supervisor] delegate exited successfully but produced no report",
            file=sys.stderr,
            flush=True,
        )
        return EXIT_MISSING_REPORT
    if state == "interrupted":
        return 128 + (received_signal[0] or signal.SIGTERM)
    return normalized_exit_code(return_code)


def main() -> None:
    try:
        raise SystemExit(run())
    except (ValueError, OSError) as error:
        print(f"[delegate-supervisor] configuration error: {error}", file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
