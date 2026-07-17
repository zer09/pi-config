#!/usr/bin/env python3
"""Aggregate matched, valid Pi skill-evaluation runs."""

from __future__ import annotations

import argparse
import json
import math
import re
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from eval_utils import atomic_write_json, atomic_write_text, has_symlink_component

ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def valid_eval_id(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return str(value)
    if isinstance(value, str) and ID_PATTERN.fullmatch(value):
        return value
    return None


def load_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    if path.is_symlink():
        return None, "symlink artifact rejected"
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return None, "missing artifact"
    if not stat.S_ISREG(mode):
        return None, "non-regular artifact rejected"
    try:
        value = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        return None, f"invalid JSON artifact: {exc}"
    if not isinstance(value, dict):
        return None, "artifact root is not an object"
    return value, None


def stats(values: list[float | int]) -> dict[str, float | int] | None:
    if not values:
        return None
    mean = sum(values) / len(values)
    stddev = 0.0
    if len(values) > 1:
        variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
        stddev = math.sqrt(variance)
    return {
        "count": len(values),
        "mean": round(mean, 4),
        "stddev": round(stddev, 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }


def normalize_expectations(
    grading: dict[str, Any],
) -> tuple[list[dict[str, Any]], str | None]:
    raw = grading.get("expectations")
    if not isinstance(raw, list) or not raw:
        return [], "grading has no expectations"
    normalized = []
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            return [], f"expectation {index} is not an object"
        text = item.get("text")
        passed = item.get("passed")
        critical = item.get("critical", False)
        if not isinstance(text, str) or not isinstance(passed, bool):
            return [], f"expectation {index} requires string text and boolean passed"
        if not isinstance(critical, bool):
            return [], f"expectation {index} critical must be boolean"
        normalized.append(
            {
                "text": text,
                "critical": critical,
                "passed": passed,
                "evidence": str(item.get("evidence", "")),
            }
        )
    return normalized, None


def contained_run_path(workspace: Path, relative_path: str) -> Path:
    relative = Path(relative_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Unsafe run path in manifest: {relative_path}")
    path = workspace / relative
    current = workspace
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"Run path contains a symlink: {relative_path}")
    if not path.resolve().is_relative_to(workspace):
        raise ValueError(f"Run path escapes workspace: {relative_path}")
    return path


def valid_metric(value: Any, *, integer: bool = False) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    if integer and not isinstance(value, int):
        return None
    return value


def load_expected_run(workspace: Path, job: dict[str, Any]) -> dict[str, Any]:
    required = {
        "eval_id",
        "eval_name",
        "configuration",
        "run_number",
        "relative_run_path",
    }
    if not required.issubset(job):
        raise ValueError(f"Manifest job missing fields: {sorted(required - set(job))}")
    run_dir = contained_run_path(workspace, str(job["relative_run_path"]))
    run_data, run_error = load_json(run_dir / "run.json")
    timing, timing_error = load_json(run_dir / "timing.json")
    grading, grading_error = load_json(run_dir / "grading.json")

    artifact_errors = []
    if run_error:
        artifact_errors.append(f"run.json: {run_error}")
    status = (
        "missing"
        if run_data is None
        else str(run_data.get("status", "invalid_artifact"))
    )
    if run_data is not None:
        if run_data.get("run_number") != job["run_number"]:
            artifact_errors.append("run.json run_number does not match manifest")
            status = "invalid_artifact"

    expectations: list[dict[str, Any]] = []
    grading_status = "missing"
    if grading is not None:
        expectations, expectation_error = normalize_expectations(grading)
        if expectation_error:
            grading_status = "invalid"
            artifact_errors.append(f"grading.json: {expectation_error}")
        else:
            grading_status = "valid"
    elif grading_error and grading_error != "missing artifact":
        grading_status = "invalid"
        artifact_errors.append(f"grading.json: {grading_error}")

    passed = sum(item["passed"] for item in expectations) if expectations else None
    failed = sum(not item["passed"] for item in expectations) if expectations else None
    total = len(expectations) if expectations else None
    pass_rate = passed / total if total else None
    critical_failed = (
        sum(item["critical"] and not item["passed"] for item in expectations)
        if expectations
        else None
    )

    if timing_error and timing_error != "missing artifact":
        artifact_errors.append(f"timing.json: {timing_error}")
        status = "invalid_artifact"
    if grading_status == "invalid":
        status = "invalid_artifact"
    timing = timing or {}
    raw_metrics = {
        "time_seconds": timing.get("total_duration_seconds"),
        "tokens": timing.get("total_tokens"),
        "tool_calls": run_data.get("tool_calls") if run_data else None,
        "errors": run_data.get("tool_errors") if run_data else None,
    }
    validated_metrics = {
        "time_seconds": valid_metric(raw_metrics["time_seconds"]),
        "tokens": valid_metric(raw_metrics["tokens"], integer=True),
        "tool_calls": valid_metric(raw_metrics["tool_calls"], integer=True),
        "errors": valid_metric(raw_metrics["errors"], integer=True),
    }
    for metric, raw_value in raw_metrics.items():
        if raw_value is not None and validated_metrics[metric] is None:
            artifact_errors.append(
                f"invalid non-negative metric {metric}: {raw_value!r}"
            )
            status = "invalid_artifact"
    if status != "completed":
        pass_rate = passed = failed = total = critical_failed = None
        validated_metrics = {key: None for key in validated_metrics}

    result = {
        "pass_rate": pass_rate,
        "passed": passed,
        "failed": failed,
        "total": total,
        "critical_failed": critical_failed,
        **validated_metrics,
    }

    return {
        "eval_id": job["eval_id"],
        "eval_name": job["eval_name"],
        "configuration": job["configuration"],
        "run_number": job["run_number"],
        "status": status,
        "grading_status": grading_status,
        "result": result,
        "expectations": expectations,
        "artifact_errors": artifact_errors,
        "run_path": str(run_dir),
    }


def summarize_configuration(
    runs: list[dict[str, Any]], configurations: list[str]
) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    metrics = ["pass_rate", "time_seconds", "tokens", "tool_calls", "errors"]
    for configuration in configurations:
        config_runs = [run for run in runs if run["configuration"] == configuration]
        completed = [run for run in config_runs if run["status"] == "completed"]
        config_summary: dict[str, Any] = {
            "expected_runs": len(config_runs),
            "completed_runs": len(completed),
            "graded_runs": sum(
                run["result"]["pass_rate"] is not None for run in completed
            ),
        }
        for metric in metrics:
            values = [
                run["result"][metric]
                for run in completed
                if isinstance(run["result"].get(metric), (int, float))
            ]
            config_summary[metric] = stats(values)
        config_summary["critical_failures"] = sum(
            run["result"]["critical_failed"] or 0 for run in completed
        )
        summary[configuration] = config_summary
    return summary


def matched_deltas(
    runs: list[dict[str, Any]], primary: str, baseline: str
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    groups: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}
    for run in runs:
        key = (str(run["eval_id"]), int(run["run_number"]))
        groups.setdefault(key, {})[run["configuration"]] = run

    metrics = ["pass_rate", "time_seconds", "tokens", "tool_calls", "errors"]
    metric_differences: dict[str, list[float]] = {metric: [] for metric in metrics}
    unmatched = []
    matched_pairs = 0
    for (eval_id, run_number), pair in groups.items():
        primary_run = pair.get(primary)
        baseline_run = pair.get(baseline)
        pair_valid = (
            primary_run is not None
            and baseline_run is not None
            and primary_run["status"] == "completed"
            and baseline_run["status"] == "completed"
            and primary_run["result"]["pass_rate"] is not None
            and baseline_run["result"]["pass_rate"] is not None
        )
        if not pair_valid:
            unmatched.append(
                {
                    "eval_id": eval_id,
                    "run_number": run_number,
                    "primary_status": primary_run["status"]
                    if primary_run
                    else "missing",
                    "baseline_status": baseline_run["status"]
                    if baseline_run
                    else "missing",
                    "reason": "both arms must be completed and graded",
                }
            )
            continue
        matched_pairs += 1
        for metric in metrics:
            primary_value = primary_run["result"].get(metric)
            baseline_value = baseline_run["result"].get(metric)
            if isinstance(primary_value, (int, float)) and isinstance(
                baseline_value, (int, float)
            ):
                metric_differences[metric].append(primary_value - baseline_value)

    delta = {
        "definition": f"matched {primary} - {baseline}",
        "matched_pairs": matched_pairs,
    }
    for metric in metrics:
        delta[metric] = stats(metric_differences[metric])
    return delta, unmatched


def generate_benchmark(
    workspace: Path, skill_name_override: str | None
) -> dict[str, Any]:
    manifest, manifest_error = load_json(workspace / "manifest.json")
    if manifest_error or manifest is None:
        raise ValueError(f"Invalid manifest.json: {manifest_error}")
    expected_jobs = manifest.get("expected_jobs")
    if not isinstance(expected_jobs, list) or not expected_jobs:
        raise ValueError("manifest.json has no expected_jobs")
    primary = manifest.get("primary_configuration")
    baseline = manifest.get("baseline_configuration")
    configurations = manifest.get("configurations")
    if (
        not isinstance(primary, str)
        or not primary
        or not isinstance(baseline, str)
        or not baseline
        or primary == baseline
    ):
        raise ValueError("manifest primary and baseline must be distinct strings")
    if (
        not isinstance(configurations, list)
        or len(configurations) != 2
        or not all(isinstance(item, str) for item in configurations)
        or len(set(configurations)) != 2
        or set(configurations) != {primary, baseline}
    ):
        raise ValueError(
            "manifest configurations must contain two distinct declared arms"
        )
    declared_runs = manifest.get("runs_per_configuration")
    if (
        isinstance(declared_runs, bool)
        or not isinstance(declared_runs, int)
        or declared_runs < 1
    ):
        raise ValueError("manifest runs_per_configuration must be a positive integer")
    job_keys = []
    run_paths = []
    eval_names: dict[str, str] = {}
    for job in expected_jobs:
        if not isinstance(job, dict):
            raise ValueError("manifest expected_jobs entries must be objects")
        eval_id = valid_eval_id(job.get("eval_id"))
        if eval_id is None:
            raise ValueError("manifest job eval_id is invalid")
        eval_name = job.get("eval_name")
        if not isinstance(eval_name, str) or not eval_name:
            raise ValueError("manifest job eval_name must be a non-empty string")
        if eval_id in eval_names and eval_names[eval_id] != eval_name:
            raise ValueError("manifest eval_id maps to multiple eval names")
        eval_names[eval_id] = eval_name
        configuration = job.get("configuration")
        if configuration not in configurations:
            raise ValueError("manifest job uses an unknown configuration")
        run_number = job.get("run_number")
        if (
            isinstance(run_number, bool)
            or not isinstance(run_number, int)
            or not 1 <= run_number <= declared_runs
        ):
            raise ValueError("manifest job run_number is outside the declared range")
        relative_path = job.get("relative_run_path")
        if not isinstance(relative_path, str) or not relative_path:
            raise ValueError(
                "manifest job relative_run_path must be a non-empty string"
            )
        job_keys.append((eval_id, configuration, run_number))
        run_paths.append(str(Path(relative_path)))
    if len(set(job_keys)) != len(job_keys):
        raise ValueError("manifest expected_jobs contains duplicate job identities")
    if len(set(run_paths)) != len(run_paths):
        raise ValueError("manifest expected_jobs contains duplicate run paths")
    expected_matrix = {
        (eval_id, configuration, run_number)
        for eval_id in eval_names
        for configuration in configurations
        for run_number in range(1, declared_runs + 1)
    }
    if set(job_keys) != expected_matrix:
        raise ValueError(
            "manifest expected_jobs does not match the declared run matrix"
        )
    runs = [load_expected_run(workspace, job) for job in expected_jobs]
    run_summary = summarize_configuration(runs, configurations)
    delta, unmatched = matched_deltas(runs, primary, baseline)
    run_summary["delta"] = delta

    critical_failures = [
        {
            "eval_id": run["eval_id"],
            "eval_name": run["eval_name"],
            "configuration": run["configuration"],
            "run_number": run["run_number"],
            "count": run["result"]["critical_failed"],
        }
        for run in runs
        if run["status"] == "completed" and (run["result"]["critical_failed"] or 0) > 0
    ]
    observed_jobs = sum((Path(run["run_path"]) / "run.json").is_file() for run in runs)
    unique_evals = []
    seen_evals = set()
    for run in runs:
        key = (str(run["eval_id"]), run["eval_name"])
        if key not in seen_evals:
            seen_evals.add(key)
            unique_evals.append({"id": run["eval_id"], "name": run["eval_name"]})

    return {
        "schema_version": 2,
        "metadata": {
            "skill_name": skill_name_override
            or manifest.get("skill_name", workspace.name),
            "primary_configuration": primary,
            "baseline_configuration": baseline,
            "configurations": configurations,
            "runs_per_configuration": declared_runs,
            "expected_jobs": len(expected_jobs),
            "observed_jobs": observed_jobs,
            "unmatched_pairs": len(unmatched),
            "provider": manifest.get("provider"),
            "model": manifest.get("model"),
            "thinking": manifest.get("thinking"),
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "evals_run": unique_evals,
        },
        "runs": runs,
        "run_summary": run_summary,
        "critical_failures": critical_failures,
        "unmatched_pairs": unmatched,
        "notes": [],
    }


def fmt_stat(value: dict[str, Any] | None, percent: bool = False) -> str:
    if not value:
        return "—"
    mean = value["mean"] * 100 if percent else value["mean"]
    stddev = value["stddev"] * 100 if percent else value["stddev"]
    suffix = "%" if percent else ""
    return f"{mean:.1f}{suffix} ± {stddev:.1f}{suffix} (n={value['count']})"


def generate_markdown(benchmark: dict[str, Any]) -> str:
    metadata = benchmark["metadata"]
    summary = benchmark["run_summary"]
    primary = metadata["primary_configuration"]
    baseline = metadata["baseline_configuration"]
    delta = summary["delta"]
    pass_delta = delta.get("pass_rate")
    pass_delta_text = "—"
    if pass_delta:
        pass_delta_text = f"{pass_delta['mean'] * 100:+.1f} percentage points (n={pass_delta['count']})"
    lines = [
        f"# Skill benchmark: {metadata['skill_name']}",
        "",
        f"**Comparison:** `{delta['definition']}`  ",
        f"**Matched pairs:** {delta['matched_pairs']}  ",
        f"**Unmatched pairs:** {metadata['unmatched_pairs']}",
        "",
    ]
    if benchmark["critical_failures"]:
        lines.extend(
            [
                "## ⛔ Critical assertion failures",
                "",
                "This benchmark is not releasable while critical assertions fail.",
                "",
            ]
        )
        for failure in benchmark["critical_failures"]:
            lines.append(
                f"- `{failure['eval_name']}` / `{failure['configuration']}` / run {failure['run_number']}: {failure['count']} critical failure(s)"
            )
        lines.append("")
    lines.extend(
        [
            f"| Metric | {primary} | {baseline} | Matched delta |",
            "| --- | ---: | ---: | ---: |",
            f"| Pass rate | {fmt_stat(summary[primary]['pass_rate'], True)} | {fmt_stat(summary[baseline]['pass_rate'], True)} | {pass_delta_text} |",
            f"| Time (s) | {fmt_stat(summary[primary]['time_seconds'])} | {fmt_stat(summary[baseline]['time_seconds'])} | {fmt_stat(delta.get('time_seconds'))} |",
            f"| Tokens | {fmt_stat(summary[primary]['tokens'])} | {fmt_stat(summary[baseline]['tokens'])} | {fmt_stat(delta.get('tokens'))} |",
            f"| Tool calls | {fmt_stat(summary[primary]['tool_calls'])} | {fmt_stat(summary[baseline]['tool_calls'])} | {fmt_stat(delta.get('tool_calls'))} |",
            "",
            "Missing, invalid, ungraded, failed, or timed-out runs do not enter comparative deltas.",
        ]
    )
    incomplete = [run for run in benchmark["runs"] if run["status"] != "completed"]
    if incomplete or benchmark["unmatched_pairs"]:
        lines.extend(["", "## Incomplete data", ""])
        if incomplete:
            lines.append(
                f"- {len(incomplete)} expected run(s) were not completed validly."
            )
        if benchmark["unmatched_pairs"]:
            lines.append(
                f"- {len(benchmark['unmatched_pairs'])} comparison pair(s) were excluded."
            )
    return "\n".join(lines) + "\n"


def benchmark_output_paths(
    requested: Path | None, workspace: Path
) -> tuple[Path, Path]:
    output = requested if requested is not None else workspace / "benchmark.json"
    if output.suffix.lower() == ".md":
        raise ValueError("--output is the JSON path and cannot use a .md suffix")
    return output, output.with_suffix(".md")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Aggregate a Pi skill-evaluation workspace"
    )
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--skill-name")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    lexical_workspace = args.workspace.expanduser().absolute()
    if has_symlink_component(lexical_workspace):
        parser.error(
            f"Workspace cannot contain symlink components: {lexical_workspace}"
        )
    workspace = lexical_workspace.resolve()
    if not workspace.is_dir():
        parser.error(f"Workspace not found: {workspace}")
    try:
        benchmark = generate_benchmark(workspace, args.skill_name)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))

    try:
        output, markdown_path = benchmark_output_paths(args.output, workspace)
        output = atomic_write_json(output, benchmark, create_parents=True)
        markdown_path = atomic_write_text(
            markdown_path, generate_markdown(benchmark), create_parents=True
        )
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"Generated: {output}")
    print(f"Generated: {markdown_path}")


if __name__ == "__main__":
    main()
