# Evaluation artifact schemas

These version-2 schemas define the interface between the Pi runners, graders, aggregator, and viewer.

## evals.json

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "name": "descriptive-kebab-name",
      "prompt": "A realistic user task",
      "expected_output": "Human-readable success description",
      "files": ["files/input.ext"],
      "assertions": [
        {"text": "A verifiable outcome", "critical": true}
      ]
    }
  ]
}
```

`assertions` may contain strings for compatibility; consumers normalize them to `{text, critical: false}`. IDs must be non-negative integers or strict slugs. Files are relative to the configured fixture root.

## trigger-evals.json

```json
{
  "queries": [
    {"id": 1, "query": "A realistic relevant request", "should_trigger": true},
    {"id": 2, "query": "A near-miss adjacent request", "should_trigger": false}
  ]
}
```

The root object is optional; the runner also accepts the array directly. IDs must be unique after string normalization. Trigger run counts are positive and odd. If any requested run for a query fails infrastructure validation, the entire query remains unscored.

## .skill-eval-workspace.json

The runner-owned overwrite marker:

```json
{
  "magic": "pi-skill-eval-workspace",
  "schema_version": 1,
  "workspace": "/exact/resolved/workspace/path",
  "created_at": "2026-01-01T00:00:00Z"
}
```

`--overwrite` refuses directories without a regular marker containing the exact resolved target path.

## manifest.json

Written only after model execution ends:

```json
{
  "schema_version": 2,
  "skill_name": "example-skill",
  "skill_path": "/resolved/path",
  "baseline_kind": "without_skill",
  "baseline_skill_path": null,
  "primary_configuration": "with_skill",
  "baseline_configuration": "baseline",
  "configurations": ["with_skill", "baseline"],
  "arm_mapping": {
    "with_skill": "arm-opaque-token",
    "baseline": "arm-other-token"
  },
  "runs_per_configuration": 1,
  "expected_jobs": [
    {
      "eval_id": 1,
      "eval_name": "descriptive-kebab-name",
      "configuration": "with_skill",
      "run_number": 1,
      "relative_run_path": "eval-1-name/arm-opaque-token/run-1",
      "review_id": "review-opaque-token"
    }
  ],
  "scheduled_order": [
    {"eval_id": 1, "run_number": 1, "order": ["baseline", "with_skill"]}
  ],
  "seed": 42,
  "created_at": "2026-01-01T00:00:00Z",
  "runner": "pi",
  "provider": null,
  "model": null,
  "thinking": null,
  "tools": "read,write,edit",
  "max_output_bytes": 10485760
}
```

The manifest is the expected-job contract. Aggregation does not infer jobs from whichever directories happen to exist. Run paths must be unique, and `expected_jobs` must contain exactly one entry for every declared eval × configuration × run number.

## eval_metadata.json

```json
{
  "eval_id": 1,
  "eval_name": "descriptive-kebab-name",
  "prompt": "A realistic user task",
  "expected_output": "Human-readable success description",
  "assertions": [
    {"text": "A verifiable outcome", "critical": true}
  ]
}
```

When present, an assertion's `critical` value must be a JSON boolean; strings, numbers, and null are invalid.

## run.json

```json
{
  "schema_version": 2,
  "status": "completed",
  "run_number": 1,
  "exit_code": 0,
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T00:01:00Z",
  "error": null,
  "stop_reason": "stop",
  "tool_calls": 4,
  "tool_errors": 0,
  "stream_errors": [],
  "inputs": []
}
```

Run identities and full command lines are intentionally absent. The post-run manifest owns configuration mapping, and the runner does not persist prompt- or credential-bearing CLI values.

Valid execution statuses include:

- `completed`
- `failed`
- `timed_out`
- `output_limit`
- `invalid_stream`
- `runner_error`
- `missing` and `invalid_artifact` when aggregation reconstructs expected jobs

Only `completed` runs can enter metrics.

## timing.json

```json
{
  "duration_ms": 60000,
  "total_duration_seconds": 60.0,
  "total_tokens": 12500,
  "input_tokens": 9000,
  "output_tokens": 1500,
  "cache_read_tokens": 2000,
  "cache_write_tokens": 0
}
```

Unavailable usage fields are `null`. Character counts are never labeled as tokens. Durations must be finite and non-negative; token, tool-call, and error counts must be non-negative integers. Invalid metrics mark the run artifact invalid rather than entering summaries.

## grading.json

```json
{
  "expectations": [
    {
      "text": "A verifiable outcome",
      "critical": true,
      "passed": true,
      "evidence": "Specific evidence from saved output"
    }
  ],
  "claims": [],
  "eval_feedback": {
    "suggestions": [],
    "overall": "Assertions are discriminating and verifiable."
  }
}
```

The aggregator derives passed, failed, total, pass rate, and critical failures from `expectations`. A supplied summary is informational and cannot override those verdicts.

## benchmark.json

```json
{
  "schema_version": 2,
  "metadata": {
    "skill_name": "example-skill",
    "primary_configuration": "with_skill",
    "baseline_configuration": "baseline",
    "configurations": ["with_skill", "baseline"],
    "runs_per_configuration": 1,
    "expected_jobs": 2,
    "observed_jobs": 2,
    "unmatched_pairs": 0
  },
  "runs": [],
  "run_summary": {
    "with_skill": {},
    "baseline": {},
    "delta": {
      "definition": "matched with_skill - baseline",
      "matched_pairs": 1,
      "pass_rate": {
        "count": 1,
        "mean": 1.0,
        "stddev": 0.0,
        "min": 1.0,
        "max": 1.0
      }
    }
  },
  "critical_failures": [],
  "unmatched_pairs": [],
  "notes": []
}
```

Each delta statistic is computed from matched `(eval_id, run_number)` pair differences. Missing, invalid, failed, timed-out, or ungraded pairs appear in `unmatched_pairs` instead of silently affecting means.

Pass-rate delta values in JSON are fractions. Markdown presents their means as percentage points.

## feedback.json

```json
{
  "reviews": [
    {
      "run_id": "review-opaque-token",
      "feedback": "Specific feedback or an empty string",
      "timestamp": "2026-01-01T00:02:00Z"
    }
  ],
  "status": "complete"
}
```

Review IDs are opaque and map to arms only in the server-side manifest. Empty feedback means inspected and accepted. Server mode writes a regular temporary file and atomically replaces `feedback.json`; it refuses symlink and non-regular targets.
