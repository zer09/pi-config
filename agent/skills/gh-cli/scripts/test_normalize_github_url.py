#!/usr/bin/env python3
"""Offline regression checks for the GitHub URL routing contract."""

import contextlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import normalize_github_url as normalizer


BASE = "https://github.com/OWNER/REPO"
SKILL = Path(__file__).resolve().parents[1]


class NormalizeGithubUrlTests(unittest.TestCase):
    def setUp(self):
        # A parser test must not execute the returned command or contact GitHub.
        for target in ("socket.socket", "socket.create_connection", "subprocess.Popen", "os.system"):
            self.enterContext(patch(target, side_effect=AssertionError("network/process call in URL parser")))

    def invoke(self, url, pretty=False):
        output = io.StringIO()
        args = [url]
        if pretty:
            args.append("--pretty")
        with contextlib.redirect_stdout(output):
            status = normalizer.main(args)
        text = output.getvalue()
        payload = json.loads(text)
        if not pretty:
            self.assertEqual(text, json.dumps(payload, separators=(",", ":")) + "\n")
        return status, payload

    def assert_route(self, url, argv, references):
        status, payload = self.invoke(url)
        self.assertEqual(status, 0)
        self.assertEqual(payload, {"references": references, "gh": {"argv": argv}})
        for reference in references:
            self.assertTrue(reference.startswith("references/"))
            self.assertTrue((SKILL / reference).is_file(), reference)

    def assert_unsupported(self, url):
        status, payload = self.invoke(url)
        self.assertEqual(status, 2)
        self.assertEqual(set(payload), {"kind", "error"})
        self.assertEqual(payload["kind"], "unsupported")
        self.assertTrue(payload["error"])

    def test_repository_url_families(self):
        for url in (
            BASE, BASE + "/", BASE + ".git", BASE + ".git/",
            "https://www.github.com/OWNER/REPO", "https://GITHUB.COM/OWNER/REPO",
            "git@github.com:OWNER/REPO", "git@github.com:OWNER/REPO.git/",
            "ssh://git@github.com/OWNER/REPO", "ssh://git@github.com/OWNER/REPO.git",
        ):
            with self.subTest(url=url):
                self.assert_route(url, ["gh", "repo", "view", "OWNER/REPO"], ["references/repo/view.md"])

    def test_documented_routes(self):
        cases = [
            ("/pull/12", ["pr", "view", "12", "--repo", "OWNER/REPO"], ["pr/view"]),
            ("/pull/012/files", ["pr", "view", "12", "--repo", "OWNER/REPO"], ["pr/view"]),
            ("/issues/34", ["issue", "view", "34", "--repo", "OWNER/REPO"], ["issue/view"]),
            ("/discussions/56", ["discussion", "view", "56", "--repo", "OWNER/REPO"], ["discussion/view"]),
            ("/discussions/56#discussioncomment-78", ["discussion", "view", "56", "--repo", "OWNER/REPO"], ["discussion/view", "discussion/comment"]),
            ("/issues/34#issuecomment-78", ["api", "repos/OWNER/REPO/issues/comments/78"], ["api", "issue/view"]),
            ("/pull/12#issuecomment-78", ["api", "repos/OWNER/REPO/issues/comments/78"], ["api", "pr/view"]),
            ("/pull/12/files#r78-discussion_r78", ["api", "repos/OWNER/REPO/pulls/comments/78"], ["api", "pr/view"]),
            ("/pull/12#discussion_r78", ["api", "repos/OWNER/REPO/pulls/comments/78"], ["api", "pr/view"]),
            ("/pull/12#pullrequestreview-78", ["api", "repos/OWNER/REPO/pulls/12/reviews/78"], ["api", "pr/view"]),
            ("/commit/abcdef1", ["api", "repos/OWNER/REPO/commits/abcdef1"], ["api"]),
            ("/commit/abcdef1#commitcomment-78", ["api", "repos/OWNER/REPO/comments/78"], ["api"]),
            ("/actions/runs/90", ["run", "view", "90", "--repo", "OWNER/REPO"], ["run/view"]),
            ("/actions/runs/90/job/123", ["run", "view", "90", "--repo", "OWNER/REPO"], ["run/view"]),
            ("/releases/tag/v1.2.3", ["release", "view", "--repo", "OWNER/REPO", "--", "v1.2.3"], ["release/view"]),
            ("/releases/tag/release/v1", ["release", "view", "--repo", "OWNER/REPO", "--", "release/v1"], ["release/view"]),
            ("/blob/main/README.md#L10-L20", ["repo", "read-file", "--repo", "OWNER/REPO", "--ref", "main", "--", "README.md"], ["repo/read-file"]),
            ("/blob/main/docs/a%20b.md", ["repo", "read-file", "--repo", "OWNER/REPO", "--ref", "main", "--", "docs/a b.md"], ["repo/read-file"]),
            ("/tree/main/docs", ["repo", "read-dir", "--repo", "OWNER/REPO", "--ref", "main", "--", "docs"], ["repo/read-dir"]),
            ("/tree/main", ["repo", "read-dir", "--repo", "OWNER/REPO", "--ref", "main"], ["repo/read-dir"]),
            ("/compare/main...dev", ["api", "repos/OWNER/REPO/compare/main...dev"], ["api"]),
            ("/unknown#issuecomment-78", ["api", "repos/OWNER/REPO/issues/comments/78"], ["api"]),
            ("/settings", ["repo", "view", "OWNER/REPO"], ["repo/view"]),
        ]
        for suffix, argv, references in cases:
            with self.subTest(suffix=suffix):
                self.assert_route(BASE + suffix, ["gh", *argv], [f"references/{name}.md" for name in references])

    def test_option_like_positionals(self):
        for encoded, value in (
            ("--flag", "--flag"), ("-x", "-x"), ("--flag=value", "--flag=value"),
            ("--web", "--web"), ("--repo", "--repo"), ("--json", "--json"),
            ("-w", "-w"), ("-R", "-R"), ("--", "--"),
            ("--repo=OTHER/REPO", "--repo=OTHER/REPO"), ("--json=name", "--json=name"),
            ("%2D%2Dweb", "--web"), ("--flag%3Dspace%20value%2Fchild", "--flag=space value/child"),
        ):
            cases = (
                (f"/releases/tag/{encoded}", ["gh", "release", "view", "--repo", "OWNER/REPO", "--", value], "release/view"),
                (f"/blob/main/{encoded}", ["gh", "repo", "read-file", "--repo", "OWNER/REPO", "--ref", "main", "--", value], "repo/read-file"),
                (f"/tree/main/{encoded}", ["gh", "repo", "read-dir", "--repo", "OWNER/REPO", "--ref", "main", "--", value], "repo/read-dir"),
            )
            for suffix, argv, reference in cases:
                with self.subTest(suffix=suffix):
                    self.assert_route(BASE + suffix, argv, [f"references/{reference}.md"])

    def test_content_ref_values(self):
        for encoded, ref in (
            ("--repo", "--repo"), ("-R", "-R"), ("--flag%3Dvalue", "--flag=value"),
            ("feature%2Flogin", "feature/login"),
        ):
            with self.subTest(ref=ref):
                self.assert_route(f"{BASE}/blob/{encoded}/--json", ["gh", "repo", "read-file", "--repo", "OWNER/REPO", "--ref", ref, "--", "--json"], ["references/repo/read-file.md"])
                for trailing in ("", "/"):
                    self.assert_route(f"{BASE}/tree/{encoded}{trailing}", ["gh", "repo", "read-dir", "--repo", "OWNER/REPO", "--ref", ref], ["references/repo/read-dir.md"])
                self.assert_unsupported(f"{BASE}/blob/{encoded}/docs/--json")
                self.assert_unsupported(f"{BASE}/tree/{encoded}/--json")

    def test_ref_ambiguity(self):
        for suffix in (
            "/blob/feature/login/README.md", "/blob/topic/src/main.py",
            "/tree/feature/login", "/tree/topic/src", "/tree/feature/login/docs",
        ):
            with self.subTest(suffix=suffix):
                self.assert_unsupported(BASE + suffix)
                self.assertIn("explicit --ref", normalizer.parse_url(BASE + suffix)["error"])
        for ref in ("HEAD", "dev", "develop", "gh-pages", "main", "master", "trunk", "abcdef1", "a" * 40, "v1.2.3", "1.2.3-rc.1"):
            for kind, command, path in (("blob", "read-file", "docs/file.md"), ("tree", "read-dir", "docs")):
                with self.subTest(ref=ref, kind=kind):
                    self.assert_route(f"{BASE}/{kind}/{ref}/{path}", ["gh", "repo", command, "--repo", "OWNER/REPO", "--ref", ref, "--", path], [f"references/repo/{command}.md"])
        self.assert_route(BASE + "/blob/topic/README.md", ["gh", "repo", "read-file", "--repo", "OWNER/REPO", "--ref", "topic", "--", "README.md"], ["references/repo/read-file.md"])
        self.assert_route(BASE + "/tree/topic", ["gh", "repo", "read-dir", "--repo", "OWNER/REPO", "--ref", "topic"], ["references/repo/read-dir.md"])

    def test_invalid_urls(self):
        for url in (
            "", "OWNER/REPO", "http://github.com/OWNER/REPO", "ftp://github.com/OWNER/REPO",
            "https://example.com/OWNER/REPO", "https://github.com.example.com/OWNER/REPO",
            "https://github.com@evil.example/OWNER/REPO", "https://github.com/OWNER",
            "https://github.com/OWNER/.git", "https://github.com/bad_owner/REPO",
            "https://github.com/OWNER/bad%2Frepo", "https://github.com:443/OWNER/REPO",
            "git@elsewhere:OWNER/REPO.git", "ssh://git@github.com/OWNER/REPO/extra",
            "https://[github.com/OWNER/REPO", "https://github.com\uff0f.example/OWNER/REPO",
        ):
            with self.subTest(url=url):
                self.assert_unsupported(url)

    def test_control_characters(self):
        for code in (*range(32), 127):
            raw = chr(code)
            encoded = f"%{code:02x}"
            for url in (
                BASE + raw, BASE + "?x=" + raw, BASE + "#" + raw,
                BASE + "/" + encoded, BASE + ";" + encoded, BASE + "?x=" + encoded, BASE + "#" + encoded,
                "ssh://git@github.com/OWNER/REPO" + raw,
                "ssh://git@github.com/OWNER/REPO" + encoded,
                "ssh://git@github.com/OWNER/REPO?x=" + encoded,
                "ssh://git@github.com/OWNER/REPO#" + encoded,
                "git@github.com:OWNER/REPO" + raw,
            ):
                with self.subTest(code=code, url=repr(url)):
                    self.assert_unsupported(url)

    def test_pretty_output_matches_compact(self):
        self.assertEqual(self.invoke(BASE), self.invoke(BASE, pretty=True))
        self.assertEqual(self.invoke("http://github.com/OWNER/REPO"), self.invoke("http://github.com/OWNER/REPO", pretty=True))


if __name__ == "__main__":
    unittest.main()
