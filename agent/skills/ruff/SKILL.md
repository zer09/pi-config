---
name: ruff
description: "Guide for using ruff, the extremely fast Python linter and formatter. Use this when linting, formatting, or fixing Python code."
---

# ruff

Use Ruff for Python linting and formatting when a project already uses Ruff or when the user asks for Python lint/format work.

## Routing

Prefer Ruff when you see:

- `[tool.ruff]` in `pyproject.toml`
- `ruff.toml`
- `.ruff.toml`

Do not create broad formatting churn. Preview formatting first and scope fixes to changed files unless the user asks for a repo-wide cleanup.

## Invocation

Use the pinned project version when available:

```bash
uv run ruff check path/to/file.py
uv run ruff format --diff path/to/file.py
```

Use `uvx ruff ...` for one-off checks when Ruff is not a project dependency. Use global `ruff ...` only when that is the repo convention.

## Core commands

```bash
ruff check .
ruff check path/to/file.py
ruff check --diff path/to/file.py
ruff check --fix path/to/file.py
ruff check --select I --fix path/to/file.py
ruff format --diff path/to/file.py
ruff format path/to/file.py
ruff format --check .
ruff rule E501
```

## Safe workflow

1. Run `ruff check --diff` on the changed files.
2. Apply safe lint fixes with `ruff check --fix` only on the intended files.
3. Preview formatting with `ruff format --diff`.
4. Format only the intended files if the diff is acceptable.
5. Use `--unsafe-fixes` only after previewing with `--diff` and reviewing the rule with `ruff rule <CODE>`.

Run lint fixes before formatting because fixes can reorder imports or change code structure.

## Config shape

Ruff is usually configured in `pyproject.toml` or `ruff.toml`:

```toml
[tool.ruff.lint]
select = ["E", "F", "I", "UP"]
ignore = ["E501"]
```

## Docs

- https://docs.astral.sh/ruff/

## Maintenance

For future updates, read `../../../docs/skills/astral-python-tools-update-process.md`.
