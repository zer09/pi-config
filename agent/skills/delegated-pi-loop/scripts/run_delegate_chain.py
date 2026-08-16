#!/usr/bin/env python3
"""Run a Pi delegate through an ordered, mutation-safe model fallback chain."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.dont_write_bytecode = True

import run_delegate as supervisor

EXIT_ROUTES_UNAVAILABLE = 80
ROUTE_PATTERN = re.compile(
    r"^(?P<provider>[A-Za-z0-9._-]+)/(?P<model>[A-Za-z0-9._-]+):"
    r"(?P<thinking>off|minimal|low|medium|high|xhigh|max)$"
)


@dataclass(frozen=True)
class Route:
    provider: str
    model: str
    thinking: str

    @property
    def key(self) -> str:
        return f"{self.provider}/{self.model}:{self.thinking}"


def parse_route(value: str) -> Route:
    match = ROUTE_PATTERN.fullmatch(value)
    if not match:
        raise argparse.ArgumentTypeError(
            "route must be PROVIDER/MODEL:THINKING with a supported thinking level"
        )
    return Route(**match.groupdict())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run a Pi JSON delegate through fresh ordered model routes. "
            "Fallback stops after any tool execution or terminal delegate result."
        )
    )
    parser.add_argument(
        "--fallback-route",
        action="append",
        default=[],
        type=parse_route,
        help="Fallback PROVIDER/MODEL:THINKING route (repeat in priority order)",
    )
    parser.add_argument(
        "--label", default="delegate-chain", help="Short role label for diagnostics"
    )
    parser.add_argument(
        "--timeout-seconds",
        type=supervisor.positive_number,
        default=supervisor.DEFAULT_TIMEOUT_SECONDS,
        help="Total wall-clock deadline shared by all routes",
    )
    parser.add_argument(
        "--allow-extended-timeout",
        action="store_true",
        help="Permit a total deadline above the default after user authorization",
    )
    parser.add_argument(
        "--grace-seconds",
        type=supervisor.positive_number,
        default=supervisor.DEFAULT_GRACE_SECONDS,
    )
    parser.add_argument(
        "--idle-warning-seconds",
        type=supervisor.positive_number,
        default=supervisor.DEFAULT_IDLE_WARNING_SECONDS,
    )
    parser.add_argument(
        "--idle-timeout-seconds",
        type=supervisor.positive_number,
        default=supervisor.DEFAULT_IDLE_TIMEOUT_SECONDS,
    )
    parser.add_argument(
        "--allow-extended-idle",
        action="store_true",
        help="Permit a Pi event-idle deadline above the default for a silent tool",
    )
    parser.add_argument(
        "--max-output-bytes",
        type=supervisor.positive_integer,
        default=supervisor.DEFAULT_MAX_OUTPUT_BYTES,
    )
    parser.add_argument(
        "--artifact-dir",
        help="Create this new private chain directory instead of a random one",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER, help="Pi command after --")
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("a Pi delegate command is required after --")
    if args.idle_warning_seconds >= args.idle_timeout_seconds:
        parser.error("--idle-warning-seconds must be less than --idle-timeout-seconds")
    if (
        args.timeout_seconds > supervisor.DEFAULT_TIMEOUT_SECONDS
        and not args.allow_extended_timeout
    ):
        parser.error(
            "a total wall deadline above the default requires --allow-extended-timeout"
        )
    if (
        args.idle_timeout_seconds > supervisor.DEFAULT_IDLE_TIMEOUT_SECONDS
        and not args.allow_extended_idle
    ):
        parser.error(
            "an event-idle deadline above the default requires --allow-extended-idle"
        )
    return args


def option_value(command: list[str], option: str) -> str:
    indices = [index for index, value in enumerate(command) if value == option]
    if len(indices) != 1 or indices[0] + 1 >= len(command):
        raise ValueError(f"Pi command must contain exactly one {option} VALUE pair")
    return command[indices[0] + 1]


def primary_route(command: list[str]) -> Route:
    value = (
        f"{option_value(command, '--provider')}/"
        f"{option_value(command, '--model')}:"
        f"{option_value(command, '--thinking')}"
    )
    try:
        return parse_route(value)
    except argparse.ArgumentTypeError as error:
        raise ValueError(f"invalid primary route: {error}") from error


def command_for_route(command: list[str], route: Route) -> list[str]:
    updated = list(command)
    for option, value in (
        ("--provider", route.provider),
        ("--model", route.model),
        ("--thinking", route.thinking),
    ):
        index = updated.index(option)
        updated[index + 1] = value
    return updated


def pi_prefix(command: list[str]) -> list[str]:
    indices = [
        index
        for index, value in enumerate(command)
        if Path(value).name in {"pi", "pi.exe"}
    ]
    if len(indices) != 1:
        raise ValueError("Pi command must contain exactly one pi executable")
    return command[: indices[0] + 1]


def route_is_catalogued(command: list[str], route: Route, timeout: float) -> bool:
    check_command = [
        *pi_prefix(command),
        "--list-models",
        f"{route.provider}/{route.model}",
    ]
    try:
        result = subprocess.run(
            check_command,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=min(15, timeout),
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if len(result.stdout) + len(result.stderr) > 1024 * 1024:
        return False
    for raw_line in result.stdout.decode("utf-8", errors="replace").splitlines():
        fields = raw_line.split()
        if (
            len(fields) >= 2
            and fields[0] == route.provider
            and fields[1] == route.model
        ):
            return True
    return False


def inner_command(
    args: argparse.Namespace,
    route: Route,
    attempt_dir: Path,
    remaining_seconds: float,
) -> list[str]:
    command = [
        sys.executable,
        str(Path(supervisor.__file__).resolve()),
        "--protocol",
        "pi-json",
        "--require-result",
        "--label",
        f"{supervisor.safe_label(args.label)}-{route.provider}-{route.model}",
        "--artifact-dir",
        str(attempt_dir),
        "--timeout-seconds",
        str(remaining_seconds),
        "--grace-seconds",
        str(args.grace_seconds),
        "--idle-warning-seconds",
        str(args.idle_warning_seconds),
        "--idle-timeout-seconds",
        str(args.idle_timeout_seconds),
        "--max-output-bytes",
        str(args.max_output_bytes),
    ]
    if remaining_seconds > supervisor.DEFAULT_TIMEOUT_SECONDS:
        command.append("--allow-extended-timeout")
    if args.idle_timeout_seconds > supervisor.DEFAULT_IDLE_TIMEOUT_SECONDS:
        command.append("--allow-extended-idle")
    command.extend(["--", *command_for_route(args.command, route)])
    return command


def read_private_text(path: Path) -> str:
    if supervisor.has_symlink_component(path) or not path.is_file():
        raise ValueError(f"delegate attempt did not produce a safe file: {path}")
    return path.read_text(encoding="utf-8")


def read_status(path: Path) -> dict[str, object]:
    value = json.loads(read_private_text(path))
    if not isinstance(value, dict):
        raise TypeError("delegate attempt status must be a JSON object")
    return value


def fallback_is_safe(status: dict[str, object]) -> tuple[bool, str | None]:
    if status.get("delegate_outcome") is not None:
        return False, None
    if status.get("tool_execution_count") != 0:
        return False, None
    state = status.get("state")
    if state == "stalled":
        return True, "event_idle_before_tools"
    if status.get("route_unavailable_seen") is True and state not in {
        "completed",
        "blocked",
        "delegate_failed",
        "timed_out",
        "output_limit",
        "interrupted",
    }:
        return True, "provider_unavailable_before_tools"
    return False, None


def write_chain_status(
    path: Path,
    *,
    label: str,
    state: str,
    started_at: str,
    started: float,
    attempts: list[dict[str, object]],
    selected_route: str | None,
    report_path: Path,
) -> None:
    supervisor.atomic_write_json(
        path,
        {
            "schema_version": 1,
            "label": label,
            "state": state,
            "started_at": started_at,
            "ended_at": supervisor.iso_now(),
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "selected_route": selected_route,
            "attempts": attempts,
            "report_path": str(report_path),
        },
    )


def replay_bytes(value: bytes, stream: object) -> None:
    if not value:
        return
    target = stream.buffer
    target.write(value[-64 * 1024 :])
    if not value.endswith(b"\n"):
        target.write(b"\n")
    target.flush()


def run() -> int:
    args = parse_args()
    supervisor.configure_supervisor_lifecycle()
    label = supervisor.safe_label(args.label)
    artifact_dir = supervisor.create_artifact_dir(args.artifact_dir, label)
    report_path = artifact_dir / "report.md"
    status_path = artifact_dir / "status.json"
    started = time.monotonic()
    started_at = supervisor.iso_now()

    first_route = primary_route(args.command)
    routes = [first_route, *args.fallback_route]
    if len({route.key for route in routes}) != len(routes):
        raise ValueError("fallback routes must be unique")

    print(
        f"[delegate-chain] started label={label} routes={len(routes)} "
        f"timeout={args.timeout_seconds:.1f}s artifacts={artifact_dir}",
        file=sys.stderr,
        flush=True,
    )
    attempts: list[dict[str, object]] = []

    for index, route in enumerate(routes, start=1):
        elapsed = time.monotonic() - started
        remaining = args.timeout_seconds - elapsed
        if remaining <= 0:
            write_chain_status(
                status_path,
                label=label,
                state="timed_out",
                started_at=started_at,
                started=started,
                attempts=attempts,
                selected_route=None,
                report_path=report_path,
            )
            return supervisor.EXIT_TIMEOUT

        catalog_started = time.monotonic()
        if not route_is_catalogued(args.command, route, remaining):
            attempts.append(
                {
                    "route": route.key,
                    "state": "catalog_unavailable",
                    "elapsed_seconds": round(time.monotonic() - catalog_started, 3),
                }
            )
            print(
                f"[delegate-chain] unavailable route={route.key}; trying next route",
                file=sys.stderr,
                flush=True,
            )
            if time.monotonic() - started >= args.timeout_seconds:
                write_chain_status(
                    status_path,
                    label=label,
                    state="timed_out",
                    started_at=started_at,
                    started=started,
                    attempts=attempts,
                    selected_route=None,
                    report_path=report_path,
                )
                return supervisor.EXIT_TIMEOUT
            continue

        remaining = args.timeout_seconds - (time.monotonic() - started)
        if remaining <= 0:
            write_chain_status(
                status_path,
                label=label,
                state="timed_out",
                started_at=started_at,
                started=started,
                attempts=attempts,
                selected_route=None,
                report_path=report_path,
            )
            return supervisor.EXIT_TIMEOUT

        attempt_dir = artifact_dir / f"attempt-{index:02d}"
        process = subprocess.Popen(
            inner_command(args, route, attempt_dir, remaining),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(
                timeout=remaining + args.grace_seconds + 5
            )
        except subprocess.TimeoutExpired:
            supervisor.terminate_process_group(process, process.pid, args.grace_seconds)
            stdout, stderr = process.communicate()

        try:
            attempt_status = read_status(attempt_dir / "status.json")
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            attempts.append(
                {
                    "route": route.key,
                    "state": "invalid_attempt",
                    "elapsed_seconds": round(time.monotonic() - started, 3),
                }
            )
            write_chain_status(
                status_path,
                label=label,
                state="invalid_attempt",
                started_at=started_at,
                started=started,
                attempts=attempts,
                selected_route=route.key,
                report_path=report_path,
            )
            replay_bytes(stdout, sys.stdout)
            replay_bytes(stderr, sys.stderr)
            print(
                f"[delegate-chain] invalid attempt route={route.key}: {error}",
                file=sys.stderr,
                flush=True,
            )
            return process.returncode or 1
        attempt_state = str(attempt_status.get("state", "invalid_status"))
        attempts.append(
            {
                "route": route.key,
                "state": attempt_state,
                "elapsed_seconds": attempt_status.get("elapsed_seconds"),
                "artifact_dir": str(attempt_dir),
            }
        )

        if attempt_state == "completed" and process.returncode == 0:
            attempt_report = attempt_dir / "report.md"
            supervisor.atomic_write_text(report_path, read_private_text(attempt_report))
            write_chain_status(
                status_path,
                label=label,
                state="completed",
                started_at=started_at,
                started=started,
                attempts=attempts,
                selected_route=route.key,
                report_path=report_path,
            )
            supervisor.replay(report_path, sys.stdout.buffer)
            if not supervisor.ends_with_newline(report_path):
                sys.stdout.write("\n")
                sys.stdout.flush()
            print(
                f"[delegate-chain] state=completed label={label} "
                f"selected={route.key} attempts={len(attempts)} status={status_path}",
                file=sys.stderr,
                flush=True,
            )
            return 0

        safe, reason = fallback_is_safe(attempt_status)
        if safe:
            attempts[-1]["fallback_reason"] = reason
            if index < len(routes):
                print(
                    f"[delegate-chain] fallback route={route.key} reason={reason}; "
                    "starting fresh route",
                    file=sys.stderr,
                    flush=True,
                )
                continue
            write_chain_status(
                status_path,
                label=label,
                state="routes_unavailable",
                started_at=started_at,
                started=started,
                attempts=attempts,
                selected_route=None,
                report_path=report_path,
            )
            print(
                f"[delegate-chain] state=routes_unavailable label={label} "
                f"attempts={len(attempts)} status={status_path}",
                file=sys.stderr,
                flush=True,
            )
            return EXIT_ROUTES_UNAVAILABLE

        attempt_report = attempt_dir / "report.md"
        if attempt_report.exists():
            supervisor.atomic_write_text(report_path, read_private_text(attempt_report))
        write_chain_status(
            status_path,
            label=label,
            state=attempt_state,
            started_at=started_at,
            started=started,
            attempts=attempts,
            selected_route=route.key,
            report_path=report_path,
        )
        replay_bytes(stdout, sys.stdout)
        replay_bytes(stderr, sys.stderr)
        print(
            f"[delegate-chain] state={attempt_state} label={label} "
            f"selected={route.key} attempts={len(attempts)} status={status_path}",
            file=sys.stderr,
            flush=True,
        )
        return process.returncode or 1

    write_chain_status(
        status_path,
        label=label,
        state="routes_unavailable",
        started_at=started_at,
        started=started,
        attempts=attempts,
        selected_route=None,
        report_path=report_path,
    )
    print(
        f"[delegate-chain] state=routes_unavailable label={label} "
        f"attempts={len(attempts)} status={status_path}",
        file=sys.stderr,
        flush=True,
    )
    return EXIT_ROUTES_UNAVAILABLE


def main() -> None:
    try:
        raise SystemExit(run())
    except (TypeError, ValueError, OSError, json.JSONDecodeError) as error:
        print(f"[delegate-chain] configuration error: {error}", file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
