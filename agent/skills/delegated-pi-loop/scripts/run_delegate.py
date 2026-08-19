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
DEFAULT_IDLE_WARNING_SECONDS = 5 * 60
DEFAULT_IDLE_TIMEOUT_SECONDS = 10 * 60
DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024
EXIT_MISSING_REPORT = 70
EXIT_OUTPUT_LIMIT = 74
EXIT_STALLED = 75
EXIT_BLOCKED = 76
EXIT_DELEGATE_FAILED = 77
EXIT_INVALID_RESULT = 78
EXIT_INVALID_STREAM = 79
EXIT_TIMEOUT = 124
RESULT_LINE_PATTERN = re.compile(
    r"^DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*$", re.MULTILINE
)
RESULT_PATTERN = re.compile(
    r"(?:^|\n)DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*\Z"
)
ROUTE_UNAVAILABLE_PATTERN = re.compile(
    r"(?:\b(?:401|403|408|429|500|502|503|504|524|529)\b|"
    r"no models? match|model[^\n]{0,80}(?:not found|unavailable)|"
    r"rate[ -]?limit|overload|(?:service|provider) unavailable|"
    r"temporarily unavailable|internal server error|gateway timeout|"
    r"connection (?:reset|refused)|network error|fetch failed|"
    r"client[_ -]?gone|context cancel(?:ed|led)|"
    r"scanner[_ -]?error|unexpected eof|"
    r"request (?:timed out|timeout)|unauthorized|invalid api key)",
    re.IGNORECASE,
)
MACHINE_ERROR_PREFIX = "[error]"

PI_CORE_ACTIVITY_EVENTS = {
    "turn_start",
    "turn_end",
    "message_start",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
}
PI_SESSION_ACTIVITY_EVENTS = {
    "agent_start",
    "agent_end",
    "agent_settled",
    "compaction_start",
    "compaction_end",
    "auto_retry_start",
    "auto_retry_end",
    "summarization_retry_scheduled",
    "summarization_retry_attempt_start",
    "summarization_retry_finished",
    "bash_execution_update",
    "entry_appended",
}
PI_ACTIVITY_EVENTS = PI_CORE_ACTIVITY_EVENTS | PI_SESSION_ACTIVITY_EVENTS
PI_MESSAGE_ACTIVITY_EVENTS = {
    "start",
    "text_start",
    "text_delta",
    "text_end",
    "thinking_start",
    "thinking_delta",
    "thinking_end",
    "toolcall_start",
    "toolcall_delta",
    "toolcall_end",
    "done",
    "error",
}


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
            "Run one delegate in a new process group, enforce lifecycle bounds, "
            "and preserve private diagnostics."
        )
    )
    parser.add_argument(
        "--label", default="delegate", help="Short role label for diagnostics"
    )
    parser.add_argument(
        "--protocol",
        choices=("plain", "pi-json"),
        default="plain",
        help="Child output protocol (default: plain)",
    )
    parser.add_argument(
        "--require-result",
        action="store_true",
        help="Require a terminal DELEGATE_RESULT marker",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=positive_number,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Wall-clock deadline (default: {DEFAULT_TIMEOUT_SECONDS})",
    )
    parser.add_argument(
        "--allow-extended-timeout",
        action="store_true",
        help="Permit a wall deadline above the default after explicit user authorization",
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
        help=f"Plain-protocol heartbeat interval (default: {DEFAULT_HEARTBEAT_SECONDS})",
    )
    parser.add_argument(
        "--idle-warning-seconds",
        type=positive_number,
        default=DEFAULT_IDLE_WARNING_SECONDS,
        help=(
            "Pi JSON event-idle warning interval "
            f"(default: {DEFAULT_IDLE_WARNING_SECONDS})"
        ),
    )
    parser.add_argument(
        "--idle-timeout-seconds",
        type=positive_number,
        default=DEFAULT_IDLE_TIMEOUT_SECONDS,
        help=(
            "Pi JSON event-idle termination interval "
            f"(default: {DEFAULT_IDLE_TIMEOUT_SECONDS})"
        ),
    )
    parser.add_argument(
        "--allow-extended-idle",
        action="store_true",
        help="Permit a Pi event-idle deadline above the default for a known silent tool",
    )
    parser.add_argument(
        "--max-output-bytes",
        type=positive_integer,
        default=DEFAULT_MAX_OUTPUT_BYTES,
        help=f"Combined child output limit (default: {DEFAULT_MAX_OUTPUT_BYTES})",
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
    if args.idle_warning_seconds >= args.idle_timeout_seconds:
        parser.error("--idle-warning-seconds must be less than --idle-timeout-seconds")
    if (
        args.timeout_seconds > DEFAULT_TIMEOUT_SECONDS
        and not args.allow_extended_timeout
    ):
        parser.error(
            "a wall deadline above the default requires --allow-extended-timeout"
        )
    if (
        args.idle_timeout_seconds > DEFAULT_IDLE_TIMEOUT_SECONDS
        and not args.allow_extended_idle
    ):
        parser.error(
            "an event-idle deadline above the default requires --allow-extended-idle"
        )
    if args.protocol == "pi-json":
        args.require_result = True
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


def atomic_write_text(path: Path, content: str) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            if content and not content.endswith("\n"):
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


def parse_delegate_outcome(report: str) -> str | None:
    markers = RESULT_LINE_PATTERN.findall(report)
    if len(markers) != 1:
        return None
    match = RESULT_PATTERN.search(report.rstrip())
    return match.group(1).lower() if match else None


def route_unavailable_error(value: object) -> bool:
    return isinstance(value, str) and bool(ROUTE_UNAVAILABLE_PATTERN.search(value))


def machine_error_envelope(report: str) -> bool:
    # A provider can render its outage as a one-line machine envelope instead
    # of a typed error. Only that single prefixed line counts, so multi-section
    # reports and prose that merely mentions an outage never match.
    stripped = report.strip()
    if "\n" in stripped or "\r" in stripped:
        return False
    if not stripped.startswith(MACHINE_ERROR_PREFIX):
        return False
    body = stripped[len(MACHINE_ERROR_PREFIX) :].lstrip()
    return route_unavailable_error(body)


def assistant_text(message: object) -> str | None:
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return None
    if message.get("stopReason") not in {"stop", "length"}:
        return None
    content = message.get("content")
    if not isinstance(content, list):
        return None
    text = "".join(
        item.get("text", "")
        for item in content
        if isinstance(item, dict)
        and item.get("type") == "text"
        and isinstance(item.get("text"), str)
    )
    return text if text.strip() else None


class PiJsonMonitor:
    """Track Pi JSON activity without forwarding event content to the orchestrator."""

    def __init__(self, started: float) -> None:
        self.offset = 0
        self.buffer = b""
        self.last_activity = started
        self.last_event: str | None = None
        self.phase = "starting"
        self.activity_event_count = 0
        self.warning_count = 0
        self.warning_issued = False
        self.final_report: str | None = None
        self.outcome: str | None = None
        self.session_seen = False
        self.agent_running = False
        self.agent_start_count = 0
        self.agent_end_count = 0
        self.agent_end_seen = False
        self.agent_settled_seen = False
        self.tool_execution_count = 0
        self.route_unavailable_seen = False
        self.errors: list[str] = []

    def drain(self, path: Path) -> None:
        if not path.exists():
            return
        with path.open("rb") as handle:
            handle.seek(self.offset)
            data = handle.read(256 * 1024)
        if not data:
            return
        self.offset += len(data)
        self.buffer += data
        while b"\n" in self.buffer:
            raw_line, self.buffer = self.buffer.split(b"\n", 1)
            if raw_line.strip():
                self._consume_line(raw_line)

    def finish(self, path: Path) -> None:
        while path.exists() and self.offset < path.stat().st_size:
            self.drain(path)
        if self.buffer.strip():
            self.errors.append("Pi JSON stream ended with a partial line")
        self.buffer = b""

    def _consume_line(self, raw_line: bytes) -> None:
        try:
            event = json.loads(raw_line)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self.errors.append(f"Invalid Pi JSON event: {error}")
            return
        if not isinstance(event, dict):
            self.errors.append("Pi JSON event must be an object")
            return

        event_type = event.get("type")
        if event_type == "session":
            if self.session_seen or self.activity_event_count:
                self.errors.append(
                    "Pi JSON session event must appear exactly once first"
                )
                return
            self.session_seen = True
            self._record_activity("session", "starting")
            return
        if not self.session_seen:
            self.errors.append("Pi JSON activity appeared before the session event")
            return
        if event_type == "agent_start":
            if self.agent_running or self.agent_end_seen:
                self.errors.append("Pi JSON agent_start lifecycle is invalid")
                return
            self.agent_running = True
            self.agent_start_count += 1
        elif event_type == "agent_end":
            if not self.agent_running:
                self.errors.append("Pi JSON agent_end lifecycle is invalid")
                return
            self.agent_running = False
            self.agent_end_count += 1
            self.agent_end_seen = event.get("willRetry") is not True
        elif event_type == "agent_settled":
            if not self.agent_end_seen or self.agent_running:
                self.errors.append(
                    "Pi JSON agent_settled appeared before final agent_end"
                )
                return
            self.agent_settled_seen = True
        elif event_type in PI_CORE_ACTIVITY_EVENTS:
            if not self.agent_running:
                self.errors.append(
                    f"Pi JSON {event_type} is outside the agent lifecycle"
                )
                return
        if event_type == "message_update":
            if not self.agent_running:
                self.errors.append(
                    "Pi JSON message_update is outside the agent lifecycle"
                )
                return
            update = event.get("assistantMessageEvent")
            if not isinstance(update, dict):
                self.errors.append("message_update lacks assistantMessageEvent")
                return
            update_type = update.get("type")
            if update_type not in PI_MESSAGE_ACTIVITY_EVENTS:
                return
            if update_type == "error":
                self.route_unavailable_seen |= route_unavailable_error(
                    update.get("errorMessage") or update.get("error")
                )
            if update_type.endswith("_delta") and not update.get("delta"):
                return
            phase = "thinking" if update_type.startswith("thinking_") else "responding"
            if update_type.startswith("toolcall_"):
                phase = "tool_selection"
            self._record_activity(str(update_type), phase)
            return
        if event_type not in PI_ACTIVITY_EVENTS:
            return
        if event_type == "bash_execution_update" and not event.get("delta"):
            return
        if event_type == "tool_execution_start":
            self.tool_execution_count += 1
        if event_type == "auto_retry_start":
            self.route_unavailable_seen |= route_unavailable_error(
                event.get("errorMessage")
            )
        elif event_type == "auto_retry_end":
            self.route_unavailable_seen |= route_unavailable_error(
                event.get("finalError")
            )

        phase = self.phase
        if event_type in {"agent_start", "turn_start", "message_start"}:
            phase = "provider"
        elif (
            event_type.startswith("tool_execution_")
            or event_type == "bash_execution_update"
        ):
            phase = "tool"
        elif event_type in {"turn_end", "message_end"}:
            phase = "turn_complete"
        elif event_type in {"auto_retry_start", "auto_retry_end"}:
            phase = "retry"
        elif event_type.startswith(("compaction_", "summarization_retry_")):
            phase = "compaction"
        elif event_type in {"agent_end", "agent_settled"}:
            phase = "complete"
        self._record_activity(str(event_type), phase)

        if event_type == "message_end":
            message = event.get("message")
            if isinstance(message, dict):
                self.route_unavailable_seen |= route_unavailable_error(
                    message.get("errorMessage")
                )
            report = assistant_text(message)
            if report is not None:
                self.final_report = report
                self.outcome = parse_delegate_outcome(report)
                # Error text delivered as the report itself is unstructured, so
                # it can only ever mark the route unavailable, never succeed.
                if self.outcome is None:
                    self.route_unavailable_seen |= machine_error_envelope(report)

    def _record_activity(self, event_name: str, phase: str) -> None:
        self.last_activity = time.monotonic()
        self.last_event = event_name
        self.phase = phase
        self.activity_event_count += 1
        self.warning_issued = False


def child_output_bytes(stream_path: Path, stderr_path: Path) -> int:
    return sum(
        path.stat().st_size for path in (stream_path, stderr_path) if path.exists()
    )


def run() -> int:
    args = parse_args()
    configure_supervisor_lifecycle()
    label = safe_label(args.label)
    artifact_dir = create_artifact_dir(args.artifact_dir, label)
    report_path = artifact_dir / "report.md"
    stderr_path = artifact_dir / "stderr.log"
    status_path = artifact_dir / "status.json"
    events_path = artifact_dir / "events.jsonl"
    stream_path = events_path if args.protocol == "pi-json" else report_path

    started_at = iso_now()
    started = time.monotonic()
    print(
        f"[delegate-supervisor] started label={label} protocol={args.protocol} "
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

    monitor = PiJsonMonitor(started) if args.protocol == "pi-json" else None
    process: subprocess.Popen[bytes] | None = None
    state = "spawn_failed"
    return_code: int | None = None
    completion_cleanup_performed = False

    try:
        with (
            open_private_binary(stream_path) as stream_handle,
            open_private_binary(stderr_path) as stderr_handle,
        ):
            process = subprocess.Popen(
                args.command,
                stdin=None,
                stdout=stream_handle,
                stderr=stderr_handle,
                start_new_session=True,
            )
            process_group_id = process.pid
            state = "running"
            next_heartbeat = started + args.heartbeat_seconds

            while True:
                now = time.monotonic()
                if monitor is not None:
                    monitor.drain(events_path)
                    if monitor.outcome in {"blocked", "failed"}:
                        state = (
                            "blocked"
                            if monitor.outcome == "blocked"
                            else "delegate_failed"
                        )
                        print(
                            f"[delegate-supervisor] terminal result label={label} "
                            f"outcome={monitor.outcome}; terminating process group",
                            file=sys.stderr,
                            flush=True,
                        )
                        terminate_process_group(
                            process, process_group_id, args.grace_seconds
                        )
                        return_code = process.poll()
                        break

                return_code = process.poll()
                if return_code is not None:
                    break

                elapsed = now - started
                output_bytes = child_output_bytes(stream_path, stderr_path)
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
                if monitor is not None:
                    if (
                        monitor.outcome == "completed"
                        and monitor.agent_end_seen
                        and monitor.agent_settled_seen
                        and not monitor.errors
                    ):
                        state = "completed"
                        completion_cleanup_performed = True
                        print(
                            f"[delegate-supervisor] terminal result label={label} "
                            "outcome=completed; cleaning up process group",
                            file=sys.stderr,
                            flush=True,
                        )
                        terminate_process_group(
                            process, process_group_id, args.grace_seconds
                        )
                        return_code = process.poll()
                        break
                    idle_seconds = now - monitor.last_activity
                    if (
                        idle_seconds >= args.idle_warning_seconds
                        and not monitor.warning_issued
                    ):
                        monitor.warning_issued = True
                        monitor.warning_count += 1
                        print(
                            f"[delegate-supervisor] idle warning label={label} "
                            f"phase={monitor.phase} last_event={monitor.last_event} "
                            f"idle={idle_seconds:.1f}s",
                            file=sys.stderr,
                            flush=True,
                        )
                    if idle_seconds >= args.idle_timeout_seconds:
                        state = "stalled"
                        print(
                            f"[delegate-supervisor] stalled label={label} "
                            f"phase={monitor.phase} last_event={monitor.last_event} "
                            f"idle={idle_seconds:.1f}s; terminating process group",
                            file=sys.stderr,
                            flush=True,
                        )
                        terminate_process_group(
                            process, process_group_id, args.grace_seconds
                        )
                        return_code = process.poll()
                        break
                elif now >= next_heartbeat:
                    print(
                        f"[delegate-supervisor] running label={label} "
                        f"pid={process.pid} elapsed={elapsed:.1f}s",
                        file=sys.stderr,
                        flush=True,
                    )
                    next_heartbeat = now + args.heartbeat_seconds
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
                time.sleep(0.1)

            if state == "running":
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

    output_bytes = child_output_bytes(stream_path, stderr_path)
    if state == "running" and output_bytes > args.max_output_bytes:
        state = "output_limit"
    if monitor is not None and state != "output_limit":
        monitor.finish(events_path)
    if monitor is not None:
        if monitor.final_report is not None:
            atomic_write_text(report_path, monitor.final_report)
        # Raw thinking, text deltas, and tool payloads are runtime-only inputs.
        events_path.unlink(missing_ok=True)
    if state == "completed" and monitor is not None and monitor.errors:
        state = "invalid_stream"
    if state == "running":
        if return_code != 0:
            state = "child_failed"
        elif monitor is not None and (monitor.errors or not monitor.agent_end_seen):
            state = "invalid_stream"
        else:
            state = "completed"

    elapsed_seconds = time.monotonic() - started
    report_present = report_path.exists() and contains_non_whitespace(report_path)
    delegate_outcome = (
        monitor.outcome
        if monitor is not None
        else (
            parse_delegate_outcome(report_path.read_text(encoding="utf-8"))
            if report_present
            else None
        )
    )
    if state == "completed" and not report_present:
        state = "missing_report"
    elif state == "completed" and args.require_result:
        if delegate_outcome == "blocked":
            state = "blocked"
        elif delegate_outcome == "failed":
            state = "delegate_failed"
        elif delegate_outcome != "completed":
            state = "invalid_result"

    final_now = time.monotonic()
    status: dict[str, object] = {
        "schema_version": 2,
        "label": label,
        "protocol": args.protocol,
        "state": state,
        "delegate_outcome": delegate_outcome,
        "started_at": started_at,
        "ended_at": iso_now(),
        "elapsed_seconds": round(elapsed_seconds, 3),
        "exit_code": return_code,
        "completion_cleanup_performed": completion_cleanup_performed,
        "output_bytes": output_bytes,
        "report_present": report_present,
        "report_path": str(report_path),
        "stderr_path": str(stderr_path),
    }
    if monitor is not None:
        status.update(
            {
                "activity_event_count": monitor.activity_event_count,
                "last_event": monitor.last_event,
                "phase": monitor.phase,
                "idle_seconds": round(final_now - monitor.last_activity, 3),
                "idle_warning_count": monitor.warning_count,
                "session_seen": monitor.session_seen,
                "agent_start_count": monitor.agent_start_count,
                "agent_end_count": monitor.agent_end_count,
                "agent_end_seen": monitor.agent_end_seen,
                "agent_settled_seen": monitor.agent_settled_seen,
                "tool_execution_count": monitor.tool_execution_count,
                "route_unavailable_seen": monitor.route_unavailable_seen,
                "stream_errors": monitor.errors,
            }
        )
    atomic_write_json(status_path, status)

    replay_tail_bytes = 64 * 1024 if state == "output_limit" else None
    if report_present:
        replay(report_path, sys.stdout.buffer, tail_bytes=replay_tail_bytes)
        if not ends_with_newline(report_path):
            sys.stdout.write("\n")
            sys.stdout.flush()
    if state != "completed" and stderr_path.exists() and stderr_path.stat().st_size:
        replay(stderr_path, sys.stderr.buffer, tail_bytes=64 * 1024)
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
    if state == "missing_report":
        print(
            "[delegate-supervisor] delegate exited successfully but produced no report",
            file=sys.stderr,
            flush=True,
        )
        return EXIT_MISSING_REPORT
    if state == "output_limit":
        return EXIT_OUTPUT_LIMIT
    if state == "stalled":
        return EXIT_STALLED
    if state == "blocked":
        return EXIT_BLOCKED
    if state == "delegate_failed":
        return EXIT_DELEGATE_FAILED
    if state == "invalid_result":
        return EXIT_INVALID_RESULT
    if state == "invalid_stream":
        return EXIT_INVALID_STREAM
    if state == "timed_out":
        return EXIT_TIMEOUT
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
