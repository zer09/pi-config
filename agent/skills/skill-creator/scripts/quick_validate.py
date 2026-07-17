#!/usr/bin/env python3
"""Validate Agent Skills, with a strict local Pi profile by default."""

from __future__ import annotations

import argparse
import os
import re
import stat
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import yaml

LOCAL_FRONTMATTER_KEYS = {"name", "description"}
PORTABLE_FRONTMATTER_KEYS = {
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
    "disable-model-invocation",
}
NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LINK_PATTERN = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
PLACEHOLDER_PATTERN = re.compile(
    r"^\s*(?:#+\s*)?\[TODO(?:\s|:|\])", re.IGNORECASE | re.MULTILINE
)


def split_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    match = re.match(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", content, re.DOTALL)
    if not match:
        raise ValueError("Invalid or missing YAML frontmatter")
    try:
        frontmatter = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid YAML frontmatter: {exc}") from exc
    if not isinstance(frontmatter, dict):
        raise ValueError("Frontmatter must be a YAML mapping")
    return frontmatter, content[match.end() :]


def markdown_without_code(content: str) -> str:
    lines = []
    in_fence = False
    fence_marker = ""
    for line in content.splitlines():
        stripped = line.lstrip()
        if not in_fence and (stripped.startswith("```") or stripped.startswith("~~~")):
            in_fence = True
            fence_marker = stripped[:3]
            continue
        if in_fence and stripped.startswith(fence_marker):
            in_fence = False
            fence_marker = ""
            continue
        if not in_fence:
            lines.append(re.sub(r"`[^`\n]*`", "", line))
    return "\n".join(lines)


def link_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and ">" in target:
        target = target[1 : target.index(">")]
    elif " " in target:
        target = target.split(" ", 1)[0]
    return unquote(target.split("#", 1)[0])


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def has_any_symlink_component(path: Path) -> bool:
    lexical = Path(os.path.abspath(path.expanduser()))
    current = Path(lexical.anchor)
    for part in lexical.parts[1:]:
        current = current / part
        if current.is_symlink():
            return True
    return False


def has_symlink_component(path: Path, root: Path) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        return True
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            return True
    return False


def validate_links(skill_path: Path, profile: str) -> list[str]:
    errors = []
    root = skill_path.resolve()
    maintenance_root = (
        root.parents[2] / "docs" / "skills" if len(root.parents) >= 3 else None
    )
    local_skills_root = root.parent
    for markdown_path in sorted(skill_path.rglob("*.md")):
        if markdown_path.is_symlink():
            errors.append(f"Symlinked Markdown file is not allowed: {markdown_path}")
            continue
        if any(part in {".git", "__pycache__"} for part in markdown_path.parts):
            continue
        if not stat.S_ISREG(markdown_path.lstat().st_mode):
            errors.append(f"Markdown path must be a regular file: {markdown_path}")
            continue
        content = markdown_without_code(markdown_path.read_text(errors="replace"))
        for match in LINK_PATTERN.finditer(content):
            raw = match.group(1)
            if raw.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = link_target(raw)
            if not target or any(marker in target for marker in ("<", ">", "{", "}")):
                continue
            target_path = Path(target)
            relative_md = markdown_path.relative_to(skill_path)
            if target_path.is_absolute():
                errors.append(f"Absolute local link in {relative_md}: {raw}")
                continue
            lexical = Path(os.path.abspath(markdown_path.parent / target_path))
            resolved = lexical.resolve()
            if is_relative_to(resolved, root):
                if has_symlink_component(lexical, root):
                    errors.append(f"Symlinked local link in {relative_md}: {raw}")
                elif not resolved.exists():
                    errors.append(f"Broken local link in {relative_md}: {raw}")
                continue
            maintenance_allowed = (
                profile == "local"
                and maintenance_root is not None
                and is_relative_to(resolved, maintenance_root.resolve())
                and resolved.exists()
                and stat.S_ISREG(resolved.lstat().st_mode)
                and not has_symlink_component(lexical, maintenance_root.resolve())
            )
            cross_skill_allowed = (
                profile == "local"
                and is_relative_to(resolved, local_skills_root.resolve())
                and resolved.exists()
                and stat.S_ISREG(resolved.lstat().st_mode)
                and not has_symlink_component(lexical, local_skills_root.resolve())
            )
            if not (maintenance_allowed or cross_skill_allowed):
                errors.append(
                    f"Local link escapes allowed local roots in {relative_md}: {raw}"
                )
    return errors


def validate_openai_yaml(skill_path: Path, skill_name: str) -> list[str]:
    path = skill_path / "agents" / "openai.yaml"
    if has_any_symlink_component(path) or not path.is_file():
        return ["Missing regular agents/openai.yaml"]
    try:
        data = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        return [f"Invalid agents/openai.yaml: {exc}"]
    if not isinstance(data, dict) or not isinstance(data.get("interface"), dict):
        return ["agents/openai.yaml must contain an interface mapping"]
    interface = data["interface"]
    errors = []
    display_name = interface.get("display_name")
    short_description = interface.get("short_description")
    default_prompt = interface.get("default_prompt")
    if not isinstance(display_name, str) or not display_name.strip():
        errors.append("agents/openai.yaml requires a non-empty interface.display_name")
    if (
        not isinstance(short_description, str)
        or not 25 <= len(short_description.strip()) <= 64
    ):
        errors.append("interface.short_description must be 25-64 characters")
    token_pattern = re.compile(rf"\${re.escape(skill_name)}(?![A-Za-z0-9_-])")
    if not isinstance(default_prompt, str) or not token_pattern.search(default_prompt):
        errors.append(
            f"interface.default_prompt must mention exact token ${skill_name}"
        )
    for icon_key in ("icon_small", "icon_large"):
        value = interface.get(icon_key)
        if not value:
            continue
        if not isinstance(value, str):
            errors.append(f"interface.{icon_key} must be a string")
            continue
        icon = Path(value)
        if icon.is_absolute() or ".." in icon.parts:
            errors.append(f"interface.{icon_key} must be relative to the skill root")
            continue
        lexical = skill_path / icon
        try:
            resolved = lexical.resolve(strict=True)
        except OSError:
            errors.append(f"interface.{icon_key} points to a missing file: {value}")
            continue
        if (
            not is_relative_to(resolved, skill_path.resolve())
            or has_symlink_component(lexical, skill_path.resolve())
            or not stat.S_ISREG(lexical.lstat().st_mode)
        ):
            errors.append(
                f"interface.{icon_key} must point to a contained regular file"
            )
    return errors


def validate_portable_fields(
    frontmatter: dict[str, Any], folder_name: str
) -> list[str]:
    errors = []
    name = frontmatter.get("name")
    if isinstance(name, str) and name != folder_name:
        errors.append(
            "Portable profile requires frontmatter name to match the folder name"
        )
    license_value = frontmatter.get("license")
    if license_value is not None and not isinstance(license_value, str):
        errors.append("Portable field 'license' must be a string")
    compatibility = frontmatter.get("compatibility")
    if compatibility is not None:
        if not isinstance(compatibility, str):
            errors.append("Portable field 'compatibility' must be a string")
        elif len(compatibility) > 500:
            errors.append("Portable field 'compatibility' exceeds 500 characters")
    metadata = frontmatter.get("metadata")
    if metadata is not None and (
        not isinstance(metadata, dict)
        or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in metadata.items()
        )
    ):
        errors.append("Portable field 'metadata' must map strings to strings")
    allowed_tools = frontmatter.get("allowed-tools")
    if allowed_tools is not None and not isinstance(allowed_tools, str):
        errors.append("Portable field 'allowed-tools' must be a string")
    disable = frontmatter.get("disable-model-invocation")
    if disable is not None and not isinstance(disable, bool):
        errors.append("Portable field 'disable-model-invocation' must be boolean")
    return errors


def validate_skill(skill_path: str | Path, profile: str = "local") -> tuple[bool, str]:
    lexical = Path(skill_path).expanduser().absolute()
    if has_any_symlink_component(lexical):
        return False, f"Skill directory cannot contain symlink components: {lexical}"
    path = lexical.resolve()
    errors: list[str] = []
    warnings: list[str] = []
    if not path.is_dir():
        return False, f"Skill directory not found: {path}"
    skill_md = path / "SKILL.md"
    if skill_md.is_symlink() or not skill_md.is_file():
        return False, "Regular SKILL.md not found"

    content = skill_md.read_text(errors="replace")
    try:
        frontmatter, body = split_frontmatter(content)
    except ValueError as exc:
        return False, str(exc)
    allowed = (
        LOCAL_FRONTMATTER_KEYS if profile == "local" else PORTABLE_FRONTMATTER_KEYS
    )
    unexpected = sorted(set(frontmatter) - allowed)
    if unexpected:
        errors.append(
            f"Unexpected frontmatter key(s): {', '.join(unexpected)}; allowed: {', '.join(sorted(allowed))}"
        )

    name = frontmatter.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append("Frontmatter 'name' must be a non-empty string")
        normalized_name = ""
    else:
        normalized_name = name.strip()
        if len(normalized_name) > 64:
            errors.append(f"Name exceeds 64 characters ({len(normalized_name)})")
        if not NAME_PATTERN.fullmatch(normalized_name):
            errors.append(
                "Name must use lowercase letters, digits, and single interior hyphens"
            )

    description = frontmatter.get("description")
    if not isinstance(description, str) or not description.strip():
        errors.append("Frontmatter 'description' must be a non-empty string")
    else:
        clean_description = description.strip()
        if len(clean_description) > 1024:
            errors.append(
                f"Description exceeds 1024 characters ({len(clean_description)})"
            )
        if profile == "local" and (
            "<" in clean_description or ">" in clean_description
        ):
            errors.append("Local profile descriptions cannot contain angle brackets")
        if re.search(r"\[TODO(?:\s|:|\])", clean_description, re.IGNORECASE):
            errors.append("Description contains an unresolved TODO placeholder")

    if profile == "portable":
        errors.extend(validate_portable_fields(frontmatter, path.name))
    if not body.strip():
        errors.append("SKILL.md body is empty")
    if PLACEHOLDER_PATTERN.search(content):
        errors.append("SKILL.md contains an unresolved TODO placeholder")
    line_count = len(content.splitlines())
    if line_count > 500:
        warnings.append(
            f"SKILL.md is {line_count} lines; consider progressive disclosure"
        )

    errors.extend(validate_links(path, profile))
    if profile == "local" and normalized_name:
        errors.extend(validate_openai_yaml(path, normalized_name))

    if errors:
        details = "\n".join(f"- {error}" for error in errors)
        if warnings:
            details += "\nWarnings:\n" + "\n".join(
                f"- {warning}" for warning in warnings
            )
        return False, f"Skill validation failed:\n{details}"
    message = "Skill is valid"
    if warnings:
        message += "\nWarnings:\n" + "\n".join(f"- {warning}" for warning in warnings)
    return True, message


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate an Agent Skill")
    parser.add_argument("skill_directory")
    parser.add_argument("--profile", choices=["local", "portable"], default="local")
    args = parser.parse_args()
    valid, message = validate_skill(args.skill_directory, args.profile)
    print(message)
    raise SystemExit(0 if valid else 1)


if __name__ == "__main__":
    main()
