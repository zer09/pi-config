#!/usr/bin/env python3
"""Evaluate production-equivalent Pi routing for an explicit skill registry."""

from __future__ import annotations

import argparse
import json
import random
import re
import secrets
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from eval_utils import (
    atomic_write_json,
    parse_pi_jsonl,
    run_bounded_process,
    validate_pi_args,
)

ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def skill_name(path: Path) -> str:
    content = (path / "SKILL.md").read_text()
    match = re.search(r"^name:\s*['\"]?([^'\"\n]+)", content, re.MULTILINE)
    if not match:
        raise ValueError(f"Could not read skill name from {path / 'SKILL.md'}")
    return match.group(1).strip()


def normalized_id(value: Any) -> str:
    if isinstance(value, bool):
        raise ValueError("Trigger query IDs cannot be booleans")
    if isinstance(value, int) and value >= 0:
        return str(value)
    if isinstance(value, str) and ID_PATTERN.fullmatch(value):
        return value
    raise ValueError(f"Invalid trigger query ID: {value!r}")


def load_queries(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text())
    if isinstance(data, dict):
        data = data.get("queries")
    if not isinstance(data, list) or not data:
        raise ValueError(
            "Trigger eval must be a non-empty array or an object with a queries array"
        )
    queries = []
    seen_ids: set[str] = set()
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Query {index} must be an object")
        query = item.get("query")
        should_trigger = item.get("should_trigger")
        query_id = item.get("id", index)
        id_key = normalized_id(query_id)
        if id_key in seen_ids:
            raise ValueError(f"Duplicate trigger query ID: {query_id!r}")
        seen_ids.add(id_key)
        if not isinstance(query, str) or not query.strip():
            raise ValueError(f"Query {query_id} is empty")
        if not isinstance(should_trigger, bool):
            raise ValueError(f"Query {query_id} should_trigger must be boolean")
        queries.append(
            {"id": query_id, "query": query.strip(), "should_trigger": should_trigger}
        )
    return queries


def validate_run_count(runs: int) -> None:
    if runs < 1 or runs % 2 == 0:
        raise ValueError("Trigger --runs must be positive and odd")


def ensure_unique_skill_names(names: list[str]) -> None:
    if len(set(names)) != len(names):
        raise ValueError("Target and competing skills must have distinct names")


def counterbalanced_registry_orders(
    skill_count: int, runs: int, rng: random.Random
) -> list[list[int]]:
    base = list(range(skill_count))
    rng.shuffle(base)
    return [
        base[offset % skill_count :] + base[: offset % skill_count]
        for offset in range(runs)
    ]


def canonical_path(value: str | None, cwd: Path) -> Path | None:
    if not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = cwd / path
    try:
        return path.resolve()
    except OSError:
        return path.absolute()


def run_query(
    *,
    query_item: dict[str, Any],
    run_number: int,
    target_skill_md: Path,
    skill_paths: list[Path],
    registry_order: list[int],
    pi_command: str,
    provider: str | None,
    model: str | None,
    thinking: str | None,
    timeout: int,
    max_output_bytes: int,
    pi_args: list[str],
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="pi-trigger-eval-") as temp_dir:
        cwd = Path(temp_dir)
        command = [
            pi_command,
            "--mode",
            "json",
            "--no-session",
            "--no-skills",
            "--no-extensions",
            "--no-prompt-templates",
            "--no-context-files",
            "--no-approve",
            "--tools",
            "read",
        ]
        ordered_skills = [skill_paths[index] for index in registry_order]
        for path in ordered_skills:
            command.extend(["--skill", str(path)])
        if provider:
            command.extend(["--provider", provider])
        if model:
            command.extend(["--model", model])
        if thinking:
            command.extend(["--thinking", thinking])
        command.extend(pi_args)
        command.append(query_item["query"])

        events_path = cwd / "events.jsonl"
        process_result = run_bounded_process(
            command,
            cwd=cwd,
            stdout_path=events_path,
            stderr_path=cwd / "stderr.txt",
            timeout=timeout,
            max_output_bytes=max_output_bytes,
        )
        parsed = parse_pi_jsonl(events_path)
        status = process_result.status
        error = process_result.error
        if status == "completed" and not parsed["valid"]:
            status = "invalid_stream"
            error = "; ".join(parsed["errors"]) or "Invalid Pi event stream"

        read_paths = []
        for event in parsed["events"]:
            if (
                event.get("type") != "tool_execution_start"
                or event.get("toolName") != "read"
            ):
                continue
            tool_args = event.get("args", {})
            if not isinstance(tool_args, dict):
                continue
            raw_path = tool_args.get("path") or tool_args.get("file_path")
            resolved = canonical_path(raw_path, cwd)
            if resolved:
                read_paths.append(str(resolved))

        target = target_skill_md.resolve()
        triggered = (
            any(Path(path) == target for path in read_paths)
            if status == "completed"
            else None
        )
        return {
            **query_item,
            "run_number": run_number,
            "status": status,
            "triggered": triggered,
            "duration_seconds": round(process_result.duration_ms / 1000, 3),
            "error": error,
            "stop_reason": parsed["stop_reason"],
            "read_paths": read_paths,
            "registry_order": [str(path) for path in ordered_skills],
            "stream_errors": parsed["errors"],
        }


def aggregate(
    query_items: list[dict[str, Any]], runs: list[dict[str, Any]]
) -> dict[str, Any]:
    results = []
    for item in query_items:
        item_runs = [run for run in runs if str(run["id"]) == str(item["id"])]
        completed = [run for run in item_runs if run["status"] == "completed"]
        trigger_count = sum(run["triggered"] is True for run in completed)
        trigger_rate = trigger_count / len(completed) if completed else None
        passed = None
        if completed and len(completed) == len(item_runs):
            majority_triggered = trigger_count > len(completed) / 2
            passed = majority_triggered == item["should_trigger"]
        results.append(
            {
                **item,
                "trigger_rate": trigger_rate,
                "triggers": trigger_count,
                "completed_runs": len(completed),
                "error_runs": len(item_runs) - len(completed),
                "passed": passed,
                "runs": item_runs,
            }
        )
    scored = [result for result in results if result["passed"] is not None]
    return {
        "results": results,
        "summary": {
            "queries": len(results),
            "scored": len(scored),
            "passed": sum(result["passed"] is True for result in scored),
            "failed": sum(result["passed"] is False for result in scored),
            "unscored_due_to_errors": len(results) - len(scored),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate actual Pi skill routing")
    parser.add_argument("skill_path", type=Path)
    parser.add_argument("--eval-set", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--competing-skill", type=Path, action="append", default=[])
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--max-workers", type=int, default=1)
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--thinking")
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--max-output-mb", type=int, default=5)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--pi-command", default="pi")
    parser.add_argument("--pi-arg", action="append", default=[])
    args = parser.parse_args()

    try:
        validate_run_count(args.runs)
    except ValueError as exc:
        parser.error(str(exc))
    if args.max_workers < 1 or args.timeout < 1 or args.max_output_mb < 1:
        parser.error("worker, timeout, and output limits must be positive")
    try:
        pi_args = validate_pi_args(args.pi_arg)
    except ValueError as exc:
        parser.error(str(exc))

    target = args.skill_path.expanduser().resolve()
    target_skill_md = target / "SKILL.md"
    if not target_skill_md.is_file():
        parser.error(f"No SKILL.md found at {target}")
    eval_set = args.eval_set.expanduser().resolve()
    if not eval_set.is_file():
        parser.error(f"Eval set not found: {eval_set}")
    competing = [path.expanduser().resolve() for path in args.competing_skill]
    skill_paths = [target, *competing]
    try:
        names = [skill_name(path) for path in skill_paths]
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    try:
        ensure_unique_skill_names(names)
    except ValueError as exc:
        parser.error(str(exc))
    try:
        queries = load_queries(eval_set)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))

    seed = args.seed if args.seed is not None else secrets.randbits(63)
    rng = random.Random(seed)
    jobs = []
    for query in queries:
        orders = counterbalanced_registry_orders(len(skill_paths), args.runs, rng)
        for run_number, order in enumerate(orders, start=1):
            jobs.append(
                {
                    "query_item": query,
                    "run_number": run_number,
                    "target_skill_md": target_skill_md,
                    "skill_paths": skill_paths,
                    "registry_order": order,
                    "pi_command": args.pi_command,
                    "provider": args.provider,
                    "model": args.model,
                    "thinking": args.thinking,
                    "timeout": args.timeout,
                    "max_output_bytes": args.max_output_mb * 1024 * 1024,
                    "pi_args": pi_args,
                }
            )

    run_results = []
    with ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        futures = {executor.submit(run_query, **job): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            try:
                run_results.append(future.result())
            except Exception as exc:
                run_results.append(
                    {
                        **job["query_item"],
                        "run_number": job["run_number"],
                        "status": "runner_error",
                        "triggered": None,
                        "duration_seconds": None,
                        "error": str(exc),
                        "stop_reason": None,
                        "read_paths": [],
                        "registry_order": [],
                        "stream_errors": [],
                    }
                )

    output = {
        "schema_version": 2,
        "skill_path": str(target),
        "competing_skills": [str(path) for path in competing],
        "runs_per_query": args.runs,
        "seed": seed,
        **aggregate(queries, run_results),
    }
    text = json.dumps(output, indent=2) + "\n"
    if args.output:
        try:
            destination = atomic_write_json(args.output, output, create_parents=True)
        except (ValueError, OSError) as exc:
            parser.error(str(exc))
        print(f"Results written to: {destination}")
    else:
        print(text, end="")

    summary = output["summary"]
    if summary["failed"] or summary["unscored_due_to_errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
