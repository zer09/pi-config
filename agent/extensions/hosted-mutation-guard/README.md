# Hosted Mutation Guard

Blocks hosted-service mutations at Pi `tool_call` time unless the current user prompt or a one-time command authorizes the exact operation.

Context Mode tools are excluded from this guard because they are part of the default agent execution path. The excluded tools are `ctx_execute`, `context_mode_ctx_execute`, `ctx_batch_execute`, `context_mode_ctx_batch_execute`, `ctx_execute_file`, and `context_mode_ctx_execute_file`. Local filesystem tools (`read`, `write`, and `edit`) are treated as local operations, even when their file content mentions hosted services.

## Exact prompt authorization

Tier 1 comment/message mutations can be authorized by exact prompt text.

Examples:

```text
Post this exact GitHub PR comment on PR #123:
"Fixed in 98fb768."
```

```text
Create a Linear comment on ENG-123 with exactly:
"Root cause documented."
```

Only one matching tool call is allowed. Target and body must match exactly. Broad prompts like "handle this PR" or "update Linear" do not authorize mutation.

## One-time authorization command

High-risk mutations such as merge, deploy, delete, workflow dispatch, or git push require a one-time authorization:

```text
/authorize-hosted-mutation github pr-merge 123
```

The authorization expires after one matching call or 10 minutes.

## Status and audit

```text
/hosted-mutation-guard status
/hosted-mutation-guard audit
/hosted-mutation-guard clear
```

Audit entries intentionally omit full command bodies and secret-bearing values.
