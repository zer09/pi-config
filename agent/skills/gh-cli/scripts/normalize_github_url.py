#!/usr/bin/env python3
"""Normalize GitHub HTTPS and SSH URLs into command-ready gh metadata.

The script is intentionally network-free. It parses one URL and prints compact JSON
that points agents to the relevant gh-cli reference files before they run gh.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from urllib.parse import unquote, urlparse

COMMENT_PATTERNS = [
    ("issue_comment", re.compile(r"(?:^|-)issuecomment-(\d+)$"), "issues/comments"),
    ("pull_request_review_comment", re.compile(r"(?:^|-)discussion_r(\d+)$"), "pulls/comments"),
    ("commit_comment", re.compile(r"(?:^|-)commitcomment-(\d+)$"), "comments"),
    ("pull_request_review", re.compile(r"(?:^|-)pullrequestreview-(\d+)$"), None),
]

CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
SSH_RE = re.compile(r"^git@github\.com:(?P<owner>[^/\s]+)/(?P<repo>[^/\s]+?)(?:\.git)?/?$")
OWNER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def compact_json(payload: dict, pretty: bool) -> str:
    if pretty:
        return json.dumps(payload, indent=2)
    return json.dumps(payload, separators=(",", ":"))


def route(references: list[str], argv: list[str]) -> dict:
    return {"references": references, "gh": {"argv": argv}}


def unsupported(error: str) -> dict:
    return {"error": error, "kind": "unsupported"}


def clean_repo(value: str) -> str:
    if value.endswith(".git"):
        return value[:-4]
    return value


def parse_int(value: str | None) -> int | None:
    if value is None or not value.isdigit():
        return None
    return int(value)


def validate_repo(owner: str, repo: str) -> bool:
    return bool(OWNER_RE.match(owner) and REPO_RE.match(repo))


def repo_view_route(slug: str) -> dict:
    return route(["references/repo/view.md"], ["gh", "repo", "view", slug])


def comment_route(slug: str, fragment: str, parent_number: int | None, parent_kind: str | None) -> dict | None:
    for _kind, pattern, api_segment in COMMENT_PATTERNS:
        match = pattern.search(fragment)
        if not match:
            continue
        comment_id = int(match.group(1))
        references = ["references/api.md"]
        if parent_kind == "pull_request":
            references.append("references/pr/view.md")
        elif parent_kind == "issue":
            references.append("references/issue/view.md")
        if api_segment is None:
            if parent_number is None:
                return None
            return route(references, ["gh", "api", f"repos/{slug}/pulls/{parent_number}/reviews/{comment_id}"])
        return route(references, ["gh", "api", f"repos/{slug}/{api_segment}/{comment_id}"])
    return None


def parse_url(url: str) -> dict:
    if CONTROL_RE.search(url):
        return unsupported("URL contains control characters")

    ssh_match = SSH_RE.match(url)
    if ssh_match:
        owner = ssh_match.group("owner")
        repo = clean_repo(ssh_match.group("repo"))
        if not validate_repo(owner, repo):
            return unsupported("invalid OWNER/REPO path segments")
        return repo_view_route(f"{owner}/{repo}")

    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]

    if parsed.scheme == "ssh" and host == "git@github.com":
        segments = [unquote(part) for part in parsed.path.split("/") if part]
        if len(segments) != 2 or any(CONTROL_RE.search(part) for part in segments):
            return unsupported("expected OWNER/REPO path segments")
        owner = segments[0]
        repo = clean_repo(segments[1])
        if not validate_repo(owner, repo):
            return unsupported("invalid OWNER/REPO path segments")
        return repo_view_route(f"{owner}/{repo}")

    if parsed.scheme != "https" or host != "github.com":
        return unsupported("expected a GitHub HTTPS URL or GitHub SSH repository URL")

    segments = [unquote(part) for part in parsed.path.split("/") if part]
    fragment = unquote(parsed.fragment or "")
    query = unquote(parsed.query or "")
    if any(CONTROL_RE.search(part) for part in segments) or CONTROL_RE.search(fragment) or CONTROL_RE.search(query):
        return unsupported("URL path, query, or fragment contains control characters")
    if len(segments) < 2:
        return unsupported("expected OWNER/REPO path segments")

    owner = segments[0]
    repo = clean_repo(segments[1])
    if not validate_repo(owner, repo):
        return unsupported("invalid OWNER/REPO path segments")

    rest = segments[2:]
    slug = f"{owner}/{repo}"

    if not rest:
        return repo_view_route(slug)

    head = rest[0]

    if head == "pull" and len(rest) >= 2:
        number = parse_int(rest[1])
        if number is not None:
            comment = comment_route(slug, fragment, number, "pull_request") if fragment else None
            if comment:
                return comment
            return route(["references/pr/view.md"], ["gh", "pr", "view", str(number), "--repo", slug])

    if head == "issues" and len(rest) >= 2:
        number = parse_int(rest[1])
        if number is not None:
            comment = comment_route(slug, fragment, number, "issue") if fragment else None
            if comment:
                return comment
            return route(["references/issue/view.md"], ["gh", "issue", "view", str(number), "--repo", slug])

    if head == "commit" and len(rest) >= 2:
        comment = comment_route(slug, fragment, None, "commit") if fragment else None
        if comment:
            return comment
        return route(["references/api.md"], ["gh", "api", f"repos/{slug}/commits/{rest[1]}"])

    if head == "actions" and len(rest) >= 3 and rest[1] == "runs":
        run_id = parse_int(rest[2])
        if run_id is not None:
            return route(["references/run/view.md"], ["gh", "run", "view", str(run_id), "--repo", slug])

    if head == "releases" and len(rest) >= 3 and rest[1] == "tag":
        tag = "/".join(rest[2:])
        return route(["references/release/view.md"], ["gh", "release", "view", tag, "--repo", slug])

    if head == "blob" and len(rest) >= 3:
        ref = rest[1]
        file_path = "/".join(rest[2:])
        return route(
            ["references/api.md"],
            ["gh", "api", "--method", "GET", f"repos/{slug}/contents/{file_path}", "-f", f"ref={ref}"],
        )

    if head == "tree" and len(rest) >= 2:
        ref = "/".join(rest[1:])
        return route(["references/api.md"], ["gh", "api", f"repos/{slug}/git/trees/{ref}", "--paginate"])

    if head == "compare" and len(rest) >= 2:
        return route(["references/api.md"], ["gh", "api", f"repos/{slug}/compare/{rest[1]}"])

    comment = comment_route(slug, fragment, None, None) if fragment else None
    if comment:
        return comment

    return repo_view_route(slug)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Normalize one GitHub URL into gh routing metadata.")
    parser.add_argument("url", help="GitHub HTTPS or SSH URL to normalize")
    parser.add_argument("--pretty", action="store_true", help="Print indented JSON instead of compact JSON")
    args = parser.parse_args(argv)
    payload = parse_url(args.url)
    print(compact_json(payload, args.pretty))
    return 0 if payload.get("kind") != "unsupported" else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
