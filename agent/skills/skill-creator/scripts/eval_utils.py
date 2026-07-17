#!/usr/bin/env python3
"""Shared safety, subprocess, and Pi JSONL utilities for skill evaluations."""

from __future__ import annotations

import json
import os
import selectors
import signal
import stat
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ALLOWED_PI_ARGS = {"--offline", "--verbose"}
SUCCESS_STOP_REASONS = {"stop"}


@dataclass
class ProcessResult:
    status: str
    exit_code: int | None
    duration_ms: int
    error: str | None


def has_symlink_component(path: Path) -> bool:
    lexical = Path(os.path.abspath(path.expanduser()))
    current = Path(lexical.anchor)
    for part in lexical.parts[1:]:
        current = current / part
        if current.is_symlink():
            return True
    return False


def atomic_write_text(path: Path, text: str, *, create_parents: bool = False) -> Path:
    lexical = Path(os.path.abspath(path.expanduser()))
    if has_symlink_component(lexical):
        raise ValueError(f"Output path cannot contain symlinks: {lexical}")
    if create_parents:
        lexical.parent.mkdir(parents=True, exist_ok=True)
    if not lexical.parent.is_dir() or has_symlink_component(lexical.parent):
        raise ValueError(
            f"Output parent must be a non-symlink directory: {lexical.parent}"
        )
    if lexical.exists() and not stat.S_ISREG(lexical.lstat().st_mode):
        raise ValueError(f"Output must be a regular file: {lexical}")
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{lexical.name}.", suffix=".tmp", dir=lexical.parent
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, lexical)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return lexical


def atomic_write_json(path: Path, data: Any, *, create_parents: bool = False) -> Path:
    text = json.dumps(data, indent=2, allow_nan=False) + "\n"
    return atomic_write_text(path, text, create_parents=create_parents)


def validate_pi_args(args: list[str]) -> list[str]:
    rejected = [arg for arg in args if arg not in ALLOWED_PI_ARGS]
    if rejected:
        allowed = ", ".join(sorted(ALLOWED_PI_ARGS))
        raise ValueError(
            f"Unsupported --pi-arg value(s): {', '.join(rejected)}. Allowed: {allowed}"
        )
    return list(args)


def _terminate_process_tree(
    process: subprocess.Popen[Any], grace_seconds: float = 2.0
) -> None:
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        if process.poll() is None:
            try:
                process.wait(timeout=grace_seconds)
                return
            except subprocess.TimeoutExpired:
                pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
    else:
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                timeout=grace_seconds,
                check=False,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            if process.poll() is None:
                process.kill()
    if process.poll() is None:
        try:
            process.wait(timeout=grace_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def _truncate(path: Path, limit: int) -> None:
    try:
        if path.stat().st_size > limit:
            with path.open("r+b") as handle:
                handle.truncate(limit)
    except OSError:
        pass


def run_bounded_process(
    command: list[str],
    *,
    cwd: Path,
    stdout_path: Path,
    stderr_path: Path,
    timeout: int,
    max_output_bytes: int,
) -> ProcessResult:
    """Run a process group with bounded files and whole-group timeout cleanup."""
    if timeout < 1 or max_output_bytes < 1024:
        raise ValueError(
            "timeout must be positive and output limit must be at least 1024 bytes"
        )

    popen_kwargs: dict[str, Any] = {}
    if os.name == "posix":
        popen_kwargs["start_new_session"] = True
    elif hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

    start = time.monotonic()
    status = "completed"
    error = None
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        **popen_kwargs,
    )
    if process.stdout is None or process.stderr is None:
        raise RuntimeError("Failed to create subprocess output pipes")
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    total_output = 0
    deadline = start + timeout
    exit_drain_deadline: float | None = None
    with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
        output_files = {"stdout": stdout_file, "stderr": stderr_file}
        while selector.get_map():
            now = time.monotonic()
            if process.poll() is None and now >= deadline:
                status = "timed_out"
                error = f"Pi exceeded the {timeout}s timeout"
                _terminate_process_tree(process)
            elif process.poll() is not None and exit_drain_deadline is None:
                exit_drain_deadline = now + 1.0
            elif exit_drain_deadline is not None and now >= exit_drain_deadline:
                if status == "completed":
                    status = "failed"
                    error = "A descendant kept output pipes open after Pi exited"
                _terminate_process_tree(process)
                for selector_key in list(selector.get_map().values()):
                    selector.unregister(selector_key.fileobj)
                    selector_key.fileobj.close()
                break

            for key, _ in selector.select(timeout=0.05):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                remaining = max_output_bytes - total_output
                if remaining > 0:
                    output_files[key.data].write(chunk[:remaining])
                    total_output += min(len(chunk), remaining)
                if len(chunk) > remaining:
                    status = "output_limit"
                    error = f"Pi exceeded the {max_output_bytes}-byte output limit"
                    _terminate_process_tree(process)
            if status != "completed" and process.poll() is not None:
                exit_drain_deadline = min(exit_drain_deadline or now + 1.0, now + 1.0)
        exit_code = process.poll()
        if exit_code is None:
            _terminate_process_tree(process)
            exit_code = process.poll()

    _truncate(stdout_path, max_output_bytes)
    _truncate(stderr_path, max_output_bytes)
    duration_ms = round((time.monotonic() - start) * 1000)
    if status == "completed" and exit_code != 0:
        status = "failed"
        error = f"Pi exited with code {exit_code}"
    return ProcessResult(status, exit_code, duration_ms, error)


def text_from_message(message: dict[str, Any]) -> str:
    content = message.get("content", [])
    if isinstance(content, str):
        return content
    parts = []
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
    return "\n".join(parts).strip()


def _usage_number(usage: dict[str, Any], *names: str) -> int | None:
    for name in names:
        value = usage.get(name)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return int(value)
    return None


def parse_pi_jsonl(path: Path) -> dict[str, Any]:
    """Parse strict LF-delimited Pi events and require a successful terminal event."""
    raw = path.read_bytes()
    events: list[dict[str, Any]] = []
    errors = []
    if raw and not raw.endswith(b"\n"):
        errors.append("stream is not LF-terminated")
    for line_number, raw_line in enumerate(raw.split(b"\n"), start=1):
        if not raw_line.strip():
            continue
        try:
            line = raw_line.decode("utf-8", errors="strict")
            event = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            errors.append(f"line {line_number}: {exc}")
            continue
        if not isinstance(event, dict):
            errors.append(f"line {line_number}: event is not an object")
            continue
        events.append(event)

    event_types = [event.get("type") for event in events]
    session_indices = [
        index for index, value in enumerate(event_types) if value == "session"
    ]
    start_indices = [
        index for index, value in enumerate(event_types) if value == "agent_start"
    ]
    end_indices = [
        index for index, value in enumerate(event_types) if value == "agent_end"
    ]
    if session_indices != [0]:
        errors.append("stream requires exactly one leading session event")
    if len(start_indices) != 1:
        errors.append("stream requires exactly one agent_start event")
    if len(end_indices) != 1:
        errors.append("stream requires exactly one agent_end event")
    if session_indices and start_indices and session_indices[0] >= start_indices[0]:
        errors.append("agent_start must follow the session event")
    if start_indices and end_indices and start_indices[0] >= end_indices[0]:
        errors.append("agent_end must follow agent_start")
    if end_indices:
        allowed_tail = {"agent_settled"}
        unexpected_tail = [
            value
            for value in event_types[end_indices[0] + 1 :]
            if value not in allowed_tail
        ]
        if unexpected_tail:
            errors.append("unexpected lifecycle events after agent_end")

    final_agent_end = events[end_indices[0]] if len(end_indices) == 1 else None
    final_message = None
    if final_agent_end and isinstance(final_agent_end.get("messages"), list):
        for message in reversed(final_agent_end["messages"]):
            if isinstance(message, dict) and message.get("role") == "assistant":
                final_message = message
                break
    stop_reason = final_message.get("stopReason") if final_message else None
    if final_message is None:
        errors.append("terminal event has no assistant message")
    elif stop_reason not in SUCCESS_STOP_REASONS:
        errors.append(f"unsuccessful assistant stopReason: {stop_reason!r}")
    if final_agent_end and final_agent_end.get("willRetry", False):
        errors.append("terminal event indicates a pending retry")
    stream_complete = not errors

    usage_totals: dict[str, int | None] = {
        "input_tokens": None,
        "output_tokens": None,
        "cache_read_tokens": None,
        "cache_write_tokens": None,
        "total_tokens": None,
    }
    seen_messages: set[str] = set()
    usage_rows = []
    for event in events:
        if event.get("type") != "message_end":
            continue
        message = event.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        identity = message.get("responseId")
        if not identity:
            identity = json.dumps(
                [message.get("timestamp"), message.get("content")],
                sort_keys=True,
                ensure_ascii=False,
            )
        if identity in seen_messages:
            continue
        seen_messages.add(identity)
        usage = message.get("usage")
        if isinstance(usage, dict):
            usage_rows.append(usage)

    aliases = {
        "input_tokens": ("input", "inputTokens", "input_tokens"),
        "output_tokens": ("output", "outputTokens", "output_tokens"),
        "cache_read_tokens": ("cacheRead", "cacheReadTokens", "cache_read_tokens"),
        "cache_write_tokens": ("cacheWrite", "cacheWriteTokens", "cache_write_tokens"),
    }
    for output_name, names in aliases.items():
        values = [_usage_number(row, *names) for row in usage_rows]
        present = [value for value in values if value is not None]
        if present:
            usage_totals[output_name] = sum(present)

    explicit_totals = [
        _usage_number(row, "totalTokens", "total_tokens") for row in usage_rows
    ]
    present_totals = [value for value in explicit_totals if value is not None]
    if present_totals:
        usage_totals["total_tokens"] = sum(present_totals)
    elif any(usage_totals[name] is not None for name in aliases):
        usage_totals["total_tokens"] = sum(usage_totals[name] or 0 for name in aliases)

    tool_starts = [
        event for event in events if event.get("type") == "tool_execution_start"
    ]
    tool_ends = [event for event in events if event.get("type") == "tool_execution_end"]
    return {
        "events": events,
        "valid": stream_complete,
        "errors": errors,
        "final_response": text_from_message(final_message) if final_message else "",
        "stop_reason": stop_reason,
        "usage": usage_totals,
        "tool_calls": len(tool_starts),
        "tool_errors": sum(bool(event.get("isError")) for event in tool_ends),
    }


def ensure_regular_contained_file(path: Path, root: Path) -> Path:
    root_resolved = root.resolve(strict=True)
    if path.is_symlink():
        raise ValueError(f"Symlink is not allowed: {path}")
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"Path escapes allowed root: {path}") from exc
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode):
        raise ValueError(f"Regular file required: {path}")
    return resolved
