#!/usr/bin/env python3
"""Run comparative skill evaluations in isolated Pi subprocess contexts."""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import secrets
import shutil
import stat
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from eval_utils import (
    parse_pi_jsonl,
    run_bounded_process,
    text_from_message,
    validate_pi_args,
)

WORKSPACE_MARKER = ".skill-eval-workspace.json"
WORKSPACE_MAGIC = "pi-skill-eval-workspace"
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:64] or "eval"


def normalized_id(value: Any) -> str:
    if isinstance(value, bool):
        raise ValueError("Eval IDs cannot be booleans")
    if isinstance(value, int):
        if value < 0:
            raise ValueError("Eval integer IDs must be non-negative")
        return str(value)
    if isinstance(value, str) and ID_PATTERN.fullmatch(value):
        return value
    raise ValueError(
        f"Invalid eval ID {value!r}; use a non-negative integer or a 1-64 character slug"
    )


def normalize_assertions(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise ValueError("Eval assertions must be an array")
    assertions = []
    for item in raw:
        if isinstance(item, str):
            assertions.append({"text": item, "critical": False})
            continue
        if not isinstance(item, dict) or not isinstance(item.get("text"), str):
            raise ValueError(f"Invalid assertion: {item!r}")
        critical = item.get("critical", False)
        if not isinstance(critical, bool):
            raise ValueError("Assertion critical must be a boolean")
        assertions.append({"text": item["text"], "critical": critical})
    return assertions


def read_skill(skill_path: Path) -> tuple[str, str]:
    content = (skill_path / "SKILL.md").read_text()
    match = re.search(r"^name:\s*['\"]?([^'\"\n]+)", content, re.MULTILINE)
    if not match:
        raise ValueError(f"Could not read skill name from {skill_path / 'SKILL.md'}")
    return match.group(1).strip(), content


def validate_eval_set(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or not isinstance(data.get("evals"), list):
        raise ValueError("Eval set must be an object with an 'evals' array")
    if not data["evals"]:
        raise ValueError("Eval set contains no evals")

    seen_ids: set[str] = set()
    normalized = []
    for index, item in enumerate(data["evals"], start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Eval {index} must be an object")
        eval_id = item.get("id", index)
        id_component = normalized_id(eval_id)
        id_key = str(eval_id)
        if id_key in seen_ids:
            raise ValueError(f"Duplicate eval id: {eval_id!r}")
        seen_ids.add(id_key)
        prompt = item.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(f"Eval {eval_id} has an empty prompt")
        name = item.get("name") or f"eval-{id_component}"
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"Eval {eval_id} has an invalid name")
        files = item.get("files", [])
        if not isinstance(files, list) or not all(
            isinstance(path, str) for path in files
        ):
            raise ValueError(f"Eval {eval_id} files must be strings")
        normalized.append(
            {
                "id": eval_id,
                "id_component": id_component,
                "name": slugify(name),
                "prompt": prompt.strip(),
                "expected_output": str(item.get("expected_output", "")).strip(),
                "files": files,
                "assertions": normalize_assertions(item.get("assertions", [])),
            }
        )
    return normalized


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            return True
    return False


def _assert_no_symlink_tree(path: Path) -> None:
    if path.is_symlink():
        raise ValueError(f"Fixture symlink is not allowed: {path}")
    if path.is_file():
        if not stat.S_ISREG(path.lstat().st_mode):
            raise ValueError(f"Fixture must be a regular file or directory: {path}")
        return
    if not path.is_dir():
        raise ValueError(f"Fixture must be a regular file or directory: {path}")
    for root, directories, files in os.walk(path, followlinks=False):
        root_path = Path(root)
        for name in [*directories, *files]:
            child = root_path / name
            if child.is_symlink():
                raise ValueError(f"Fixture tree contains a symlink: {child}")
            mode = child.lstat().st_mode
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise ValueError(f"Fixture tree contains a non-regular entry: {child}")


def resolve_inputs(files: list[str], fixture_root: Path) -> list[dict[str, str | Path]]:
    resolved_inputs = []
    for index, raw_path in enumerate(files, start=1):
        raw = Path(raw_path)
        if raw.is_absolute() or ".." in raw.parts:
            raise ValueError(f"Fixture path must be relative and contained: {raw_path}")
        source = fixture_root / raw
        current = fixture_root
        for part in raw.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError(f"Fixture path contains a symlink: {raw_path}")
        source_resolved = source.resolve(strict=True)
        if not _is_relative_to(source_resolved, fixture_root):
            raise ValueError(f"Fixture path escapes fixture root: {raw_path}")
        _assert_no_symlink_tree(source)
        destination_name = f"{index:03d}-{source.name}"
        resolved_inputs.append(
            {
                "source": source_resolved,
                "source_label": raw_path,
                "destination_name": destination_name,
            }
        )
    return resolved_inputs


def copy_inputs(
    resolved_inputs: list[dict[str, str | Path]], inputs_dir: Path
) -> list[dict[str, str]]:
    copied = []
    for item in resolved_inputs:
        source = Path(item["source"])
        destination = inputs_dir / str(item["destination_name"])
        if source.is_dir():
            shutil.copytree(source, destination, symlinks=True)
        else:
            shutil.copy2(source, destination, follow_symlinks=False)
        copied.append(
            {
                "source": str(item["source_label"]),
                "sandbox_path": f"inputs/{destination.name}",
            }
        )
    return copied


def _find_repo_root(path: Path) -> Path | None:
    for candidate in [path, *path.parents]:
        if (candidate / ".git").exists():
            return candidate
    return None


def _protected_workspace(workspace: Path, protected: list[Path]) -> str | None:
    root = Path(workspace.anchor)
    if workspace == root:
        return "filesystem root"
    home = Path.home().resolve()
    if workspace == home or _is_relative_to(home, workspace):
        return "home directory or its ancestor"
    for path in protected:
        resolved = path.resolve()
        if workspace == resolved or _is_relative_to(resolved, workspace):
            return f"protected path or ancestor: {resolved}"
    repo_root = _find_repo_root(Path.cwd().resolve())
    if repo_root and workspace == repo_root:
        return f"repository root: {repo_root}"
    return None


def prepare_workspace(
    raw_workspace: Path,
    *,
    overwrite: bool,
    protected: list[Path],
) -> Path:
    lexical = Path(os.path.abspath(raw_workspace.expanduser()))
    if _has_symlink_component(lexical):
        raise ValueError(f"Workspace path cannot contain symlink components: {lexical}")
    workspace = lexical.resolve()
    reason = _protected_workspace(workspace, protected)
    if reason:
        raise ValueError(f"Refusing unsafe workspace {workspace}: {reason}")

    marker_path = workspace / WORKSPACE_MARKER
    if workspace.exists():
        if not overwrite:
            raise ValueError(f"Workspace already exists: {workspace}; use --overwrite")
        if marker_path.is_symlink() or not marker_path.is_file():
            raise ValueError(
                "Refusing to overwrite a directory without a regular runner marker"
            )
        marker = json.loads(marker_path.read_text())
        if marker.get("magic") != WORKSPACE_MAGIC or marker.get("workspace") != str(
            workspace
        ):
            raise ValueError(
                "Refusing to overwrite a directory with an invalid runner marker"
            )
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True, exist_ok=False)
    marker_path.write_text(
        json.dumps(
            {
                "magic": WORKSPACE_MAGIC,
                "schema_version": 1,
                "workspace": str(workspace),
                "created_at": utc_now(),
            },
            indent=2,
        )
        + "\n"
    )
    return workspace


def configuration_order(pair_index: int, initial_primary_first: bool) -> list[str]:
    order = ["with_skill", "baseline"]
    primary_first = (pair_index % 2 == 0) == initial_primary_first
    if not primary_first:
        order.reverse()
    return order


def build_prompt(eval_item: dict[str, Any], copied_inputs: list[dict[str, str]]) -> str:
    input_lines = [
        f"- {item['source']} -> {item['sandbox_path']}" for item in copied_inputs
    ] or ["- none"]
    return f"""Work only inside the current evaluation directory.
Do not mutate external hosted services, production systems, accounts, or remote repositories.
Treat inputs/ as read-only fixtures and save user-relevant generated files under outputs/.

Input mapping:
{chr(10).join(input_lines)}

{eval_item["prompt"]}
"""


def forced_skill_context(skill_path: Path | None, skill_content: str | None) -> str:
    if skill_path is not None and skill_content is not None:
        details = (
            f"Apply these instructions for the task. Relative resources are rooted at "
            f"{skill_path}.\n\n{skill_content}"
        )
    else:
        details = "No additional skill instructions apply to this task."
    return f"""Use the following evaluation context as system guidance.

<evaluation_context>
{details}
</evaluation_context>
"""


def render_transcript(parsed: dict[str, Any]) -> str:
    lines = ["# Evaluation transcript", ""]
    for event in parsed["events"]:
        event_type = event.get("type")
        if event_type == "message_end" and isinstance(event.get("message"), dict):
            message = event["message"]
            if message.get("role") == "assistant":
                text = text_from_message(message)
                if text:
                    lines.extend(["## Assistant", "", text, ""])
        elif event_type == "tool_execution_start":
            lines.extend(
                [
                    f"## Tool: {event.get('toolName', 'unknown')}",
                    "",
                    "```json",
                    json.dumps(event.get("args", {}), indent=2, ensure_ascii=False),
                    "```",
                    "",
                ]
            )
        elif event_type == "tool_execution_end" and event.get("isError"):
            lines.extend(["**Tool error recorded.**", ""])
    if parsed["errors"]:
        lines.extend(
            ["> Stream validation errors:", *[f"> - {e}" for e in parsed["errors"]]]
        )
    return "\n".join(lines).rstrip() + "\n"


def run_one(
    *,
    pi_command: str,
    skill_context: str | None,
    eval_item: dict[str, Any],
    run_dir: Path,
    run_number: int,
    provider: str | None,
    model: str | None,
    thinking: str | None,
    tools: str,
    timeout: int,
    max_output_bytes: int,
    pi_args: list[str],
) -> dict[str, Any]:
    run_dir.mkdir(parents=True, exist_ok=False)
    inputs_dir = run_dir / "inputs"
    outputs_dir = run_dir / "outputs"
    inputs_dir.mkdir()
    outputs_dir.mkdir()
    copied_inputs = copy_inputs(eval_item["resolved_inputs"], inputs_dir)
    prompt = build_prompt(eval_item, copied_inputs)

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
        tools,
    ]
    if skill_context:
        command.extend(["--append-system-prompt", skill_context])
    if provider:
        command.extend(["--provider", provider])
    if model:
        command.extend(["--model", model])
    if thinking:
        command.extend(["--thinking", thinking])
    command.extend(pi_args)
    command.append(prompt)

    started_at = utc_now()
    process_result = run_bounded_process(
        command,
        cwd=run_dir,
        stdout_path=run_dir / "events.jsonl",
        stderr_path=run_dir / "stderr.txt",
        timeout=timeout,
        max_output_bytes=max_output_bytes,
    )
    parsed = parse_pi_jsonl(run_dir / "events.jsonl")
    status = process_result.status
    error = process_result.error
    if status == "completed" and not parsed["valid"]:
        status = "invalid_stream"
        error = "; ".join(parsed["errors"]) or "Invalid Pi event stream"

    (run_dir / "transcript.md").write_text(render_transcript(parsed))
    (outputs_dir / "final_response.md").write_text(
        (parsed["final_response"] or "(No valid final assistant response captured.)")
        + "\n"
    )
    timing = {
        "duration_ms": process_result.duration_ms,
        "total_duration_seconds": round(process_result.duration_ms / 1000, 3),
        **parsed["usage"],
    }
    (run_dir / "timing.json").write_text(json.dumps(timing, indent=2) + "\n")
    run_data = {
        "schema_version": 2,
        "status": status,
        "run_number": run_number,
        "exit_code": process_result.exit_code,
        "started_at": started_at,
        "ended_at": utc_now(),
        "error": error,
        "stop_reason": parsed["stop_reason"],
        "tool_calls": parsed["tool_calls"],
        "tool_errors": parsed["tool_errors"],
        "stream_errors": parsed["errors"],
        "inputs": copied_inputs,
    }
    (run_dir / "run.json").write_text(json.dumps(run_data, indent=2) + "\n")
    return {"run_dir": str(run_dir), "status": status, "error": error}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run comparative skill evals with Pi")
    parser.add_argument("skill_path", type=Path)
    parser.add_argument("--eval-set", type=Path, required=True)
    parser.add_argument("--fixture-root", type=Path)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--baseline-skill", type=Path)
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--max-workers", type=int, default=1)
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--thinking")
    parser.add_argument("--tools", default="read,write,edit")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--max-output-mb", type=int, default=10)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--pi-command", default="pi")
    parser.add_argument("--pi-arg", action="append", default=[])
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    if (
        args.runs < 1
        or args.max_workers < 1
        or args.timeout < 1
        or args.max_output_mb < 1
    ):
        parser.error("run, worker, timeout, and output limits must be positive")
    try:
        pi_args = validate_pi_args(args.pi_arg)
    except ValueError as exc:
        parser.error(str(exc))

    skill_path = args.skill_path.expanduser().resolve()
    eval_set_path = args.eval_set.expanduser().resolve()
    baseline_skill = (
        args.baseline_skill.expanduser().resolve() if args.baseline_skill else None
    )
    for path in [skill_path, baseline_skill]:
        if path and not (path / "SKILL.md").is_file():
            parser.error(f"No SKILL.md found at {path}")
    if not eval_set_path.is_file():
        parser.error(f"Eval set not found: {eval_set_path}")
    fixture_lexical = Path(
        os.path.abspath(
            args.fixture_root.expanduser()
            if args.fixture_root
            else eval_set_path.parent
        )
    )
    if _has_symlink_component(fixture_lexical) or not fixture_lexical.is_dir():
        parser.error(
            f"Fixture root must not contain symlink components: {fixture_lexical}"
        )
    fixture_root = fixture_lexical.resolve()

    eval_data = json.loads(eval_set_path.read_text())
    try:
        evals = validate_eval_set(eval_data)
        for eval_item in evals:
            eval_item["resolved_inputs"] = resolve_inputs(
                eval_item["files"], fixture_root
            )
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    skill_name, skill_content = read_skill(skill_path)
    baseline_content = read_skill(baseline_skill)[1] if baseline_skill else None
    if eval_data.get("skill_name") and eval_data["skill_name"] != skill_name:
        parser.error("eval skill_name does not match the target SKILL.md")

    protected = [Path.cwd(), skill_path, eval_set_path]
    if baseline_skill:
        protected.append(baseline_skill)
    try:
        workspace = prepare_workspace(
            args.workspace, overwrite=args.overwrite, protected=protected
        )
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))

    seed = args.seed if args.seed is not None else secrets.randbits(63)
    rng = random.Random(seed)
    arm_mapping = {
        "with_skill": f"arm-{rng.getrandbits(48):012x}",
        "baseline": f"arm-{rng.getrandbits(48):012x}",
    }
    jobs = []
    expected_jobs = []
    eval_directories: dict[str, Path] = {}
    pair_index = 0
    initial_primary_first = bool(rng.getrandbits(1))
    scheduled_order = []
    for eval_item in evals:
        eval_dir = workspace / f"eval-{eval_item['id_component']}-{eval_item['name']}"
        if eval_dir.resolve().parent != workspace:
            parser.error(f"Unsafe eval directory: {eval_dir}")
        eval_dir.mkdir()
        eval_directories[str(eval_item["id"])] = eval_dir
        for run_number in range(1, args.runs + 1):
            order = configuration_order(pair_index, initial_primary_first)
            pair_index += 1
            scheduled_order.append(
                {"eval_id": eval_item["id"], "run_number": run_number, "order": order}
            )
            for configuration in order:
                arm_dir = eval_dir / arm_mapping[configuration]
                arm_dir.mkdir(exist_ok=True)
                run_dir = arm_dir / f"run-{run_number}"
                context = (
                    forced_skill_context(skill_path, skill_content)
                    if configuration == "with_skill"
                    else forced_skill_context(baseline_skill, baseline_content)
                )
                job = {
                    "pi_command": args.pi_command,
                    "skill_context": context,
                    "eval_item": eval_item,
                    "run_dir": run_dir,
                    "run_number": run_number,
                    "provider": args.provider,
                    "model": args.model,
                    "thinking": args.thinking,
                    "tools": args.tools,
                    "timeout": args.timeout,
                    "max_output_bytes": args.max_output_mb * 1024 * 1024,
                    "pi_args": pi_args,
                }
                jobs.append(job)
                expected_jobs.append(
                    {
                        "eval_id": eval_item["id"],
                        "eval_name": eval_item["name"],
                        "configuration": configuration,
                        "run_number": run_number,
                        "relative_run_path": str(run_dir.relative_to(workspace)),
                        "review_id": f"review-{rng.getrandbits(96):024x}",
                    }
                )

    failures = 0
    with ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        futures = {executor.submit(run_one, **job): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            try:
                result = future.result()
            except Exception as exc:
                result = {
                    "run_dir": str(job["run_dir"]),
                    "status": "runner_error",
                    "error": str(exc),
                }
            print(f"[{result['status'].upper()}] {result['run_dir']}")
            if result["status"] != "completed":
                failures += 1
                if result["error"]:
                    print(f"  {result['error']}", file=sys.stderr)

    for eval_item in evals:
        metadata = {
            "eval_id": eval_item["id"],
            "eval_name": eval_item["name"],
            "prompt": eval_item["prompt"],
            "expected_output": eval_item["expected_output"],
            "assertions": eval_item["assertions"],
        }
        (eval_directories[str(eval_item["id"])] / "eval_metadata.json").write_text(
            json.dumps(metadata, indent=2) + "\n"
        )

    manifest = {
        "schema_version": 2,
        "skill_name": skill_name,
        "skill_path": str(skill_path),
        "baseline_kind": "old_skill" if baseline_skill else "without_skill",
        "baseline_skill_path": str(baseline_skill) if baseline_skill else None,
        "primary_configuration": "with_skill",
        "baseline_configuration": "baseline",
        "configurations": ["with_skill", "baseline"],
        "arm_mapping": arm_mapping,
        "runs_per_configuration": args.runs,
        "expected_jobs": expected_jobs,
        "scheduled_order": scheduled_order,
        "seed": seed,
        "created_at": utc_now(),
        "runner": "pi",
        "provider": args.provider,
        "model": args.model,
        "thinking": args.thinking,
        "tools": args.tools,
        "max_output_bytes": args.max_output_mb * 1024 * 1024,
    }
    (workspace / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Workspace: {workspace}")
    if failures:
        print(f"Completed with {failures} failed run events", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
