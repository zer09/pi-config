---
name: ty
description: "Guide for using ty, the extremely fast Python type checker and language server. Use this when type checking Python code or setting up type checking in Python projects."
---

# ty

Use ty for Python type checking when a project already uses ty or when the user asks for Python type checking.

## Routing

Prefer ty when you see:

- `[tool.ty]` in `pyproject.toml`
- `ty.toml`

Because ty is newer and still evolving, verify current docs or local help before using advanced flags or writing new config.

## Invocation

Use the pinned project version when available:

```bash
uv run ty check
uv run ty check path/to/file.py
```

Use `uvx ty ...` for one-off checks when ty is not a project dependency.

## Core commands

```bash
ty check
ty check path/to/file.py
ty check src/
ty check --python-version 3.12
ty check --python-platform linux
```

Rule severity flags can be useful, but verify current support first:

```bash
ty check --error possibly-unresolved-reference
ty check --warn division-by-zero
ty check --ignore unresolved-import
```

## Config shape

Ty is usually configured in `pyproject.toml` or `ty.toml`:

```toml
[tool.ty.environment]
python-version = "3.12"

[tool.ty.rules]
possibly-unresolved-reference = "warn"
division-by-zero = "error"
```

## Local policy

- Fix type errors instead of suppressing them.
- Add ignore comments only when the user explicitly asks or when there is no safe narrow fix.
- Prefer rule-specific `# ty: ignore[rule-name]` over blanket ignores.
- Do not use `# type: ignore` for ty-specific suppressions unless a project convention requires it.

## Docs

- https://docs.astral.sh/ty/

## Maintenance

For future updates, read `../../../docs/skills/astral-python-tools-update-process.md`.
